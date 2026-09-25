"""Host repeater settings, API, shadow runtime and RF-safety boundary (plan 29, Phases 1-2)."""

import ast
import asyncio
import hashlib
import hmac
import importlib
import inspect
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from Crypto.Cipher import AES
from fastapi import HTTPException
from pydantic import ValidationError

from app.decoder import derive_public_key, derive_shared_secret
from app.routers import host_repeater as router_module
from app.services import dm_ack_tracker
from app.services.host_repeater import HostRepeaterRuntime, PreFacts
from app.services.host_repeater_engine import RadioParams
from app.services.host_repeater_link import RadioSnapshot
from app.services.host_repeater_settings import HostRepeaterSettings, sub_band_duty_limit

RADIO = RadioParams(freq_mhz=869.618, bw_khz=62.5, sf=8, cr=8)


def snapshot(
    public_key: bytes | None, *, model: str | None = "T-Echo", name: str = "me"
) -> RadioSnapshot:
    return RadioSnapshot(
        connected=True,
        public_key=public_key,
        name=name,
        radio=RADIO,
        firmware_ver_code=13,
        device_model=model,
        client_repeat=False,
        lock_busy=False,
    )


# ── settings model ──────────────────────────────────────────────────────


def test_defaults_are_all_off():
    s = HostRepeaterSettings()
    assert (s.admin_enabled, s.shadow_enabled, s.filter_enabled, s.policy.enabled) == (
        False,
        False,
        False,
        False,
    )
    assert s.tx_delay_factor == 1.0 and s.direct_tx_delay_factor == 0.5
    assert s.max_airtime_per_minute_ms == 3600
    assert s.rx_delay_base == 0.0 and not s.use_score_for_tx and not s.advert_limiter_enabled
    assert (s.advert_bucket_capacity, s.advert_refill_tokens) == (2, 1)
    assert (s.advert_refill_interval_seconds, s.advert_min_interval_seconds) == (36000, 3600)
    assert s.filter_types["GRP_TXT"].hops_max == 32 and s.filter_types["ADVERT"].rate_limit == 10


@pytest.mark.parametrize(
    "doc",
    [
        {"unknown": 1},
        {"flood_max": 65},
        {"rx_delay_base": 20.5},
        {"advert_bucket_capacity": 0},
        {"advert_refill_interval_seconds": 59},
        {"loop_detect": "sometimes"},
        {"filter_types": {"NOPE": {"hops_max": 1, "rate_limit": 1, "rate_secs": 1}}},
        {"filter_channels": [{"hash": "zz"}]},
        {
            "policy": {
                "rules": [
                    {
                        "id": "a",
                        "if": {"field": "x", "op": "equals", "value": 1},
                        "then": {"action": "drop"},
                    }
                ]
            }
        },
        {
            "policy": {
                "rules": [
                    {
                        "id": "a",
                        "if": {"field": "hop_count", "op": "eq", "value": 1},
                        "then": {"action": "drop"},
                    }
                ]
            }
        },
        {
            "policy": {
                "rules": [
                    {
                        "id": "a",
                        "if": {"field": "hop_count", "op": "equals", "value": 1},
                        "then": {"action": "block"},
                    }
                ]
            }
        },
        {
            "policy": {
                "rules": [
                    {
                        "id": "a",
                        "if": {
                            "field": "channel_hash",
                            "op": "in",
                            "value": "@channel_hash_groups.none",
                        },
                        "then": {"action": "drop"},
                    }
                ]
            }
        },
        {
            "policy": {
                "rules": [
                    {
                        "id": "a",
                        "if": {"field": "hop_count", "op": "equals", "value": 1},
                        "then": {"action": "drop"},
                    },
                    {
                        "id": "a",
                        "if": {"field": "hop_count", "op": "equals", "value": 2},
                        "then": {"action": "drop"},
                    },
                ]
            }
        },
    ],
)
def test_strict_validation_rejects(doc):
    with pytest.raises(ValidationError):
        HostRepeaterSettings.model_validate(doc)


def test_rule_round_trips_with_if_alias():
    doc = {
        "policy": {
            "enabled": True,
            "rules": [
                {
                    "id": "r1",
                    "name": "no far adverts",
                    "if": {
                        "all": [
                            {"field": "payload_type", "op": "equals", "value": 4},
                            {"field": "hop_count", "op": "greater_than", "value": 3},
                        ]
                    },
                    "then": {"action": "drop"},
                }
            ],
        }
    }
    dumped = HostRepeaterSettings.model_validate(doc).model_dump(mode="json", by_alias=True)
    assert dumped["policy"]["rules"][0]["if"]["all"][1]["value"] == 3
    assert HostRepeaterSettings.model_validate(dumped).policy.rules[0].id == "r1"


def test_sub_band_table():
    assert sub_band_duty_limit(869.618) == 10.0
    assert sub_band_duty_limit(868.1) == 1.0
    assert sub_band_duty_limit(869.3) == 0.1  # gap inside the SRD band
    assert sub_band_duty_limit(915.0) is None


# ── API ─────────────────────────────────────────────────────────────────


@pytest.fixture
def runtime():
    rt = HostRepeaterRuntime()
    with (
        patch.object(router_module, "host_repeater", rt),
        patch.object(router_module, "radio_snapshot", lambda: snapshot(bytes(32))),
        patch("app.services.host_repeater.broadcast_event") as bc,
    ):
        rt.broadcast_mock = bc  # type: ignore[attr-defined]
        yield rt


@pytest.mark.asyncio
async def test_get_defaults_version_zero(test_db, runtime):
    resp = await router_module.get_host_repeater()
    assert resp.version == 0 and resp.state == "off"
    assert resp.capabilities.arm_blockers == ["env_switch_off", "admin_switch_off"]
    assert resp.disarm_reason is None and resp.armed_since is None
    assert resp.capabilities.sub_band_limit_percent == 10.0


@pytest.mark.asyncio
async def test_save_bumps_version_broadcasts_and_rejects_stale(test_db, runtime):
    req = router_module.HostRepeaterSaveRequest(
        version=0, settings=HostRepeaterSettings(shadow_enabled=True)
    )
    resp = await router_module.save_host_repeater_settings(req)
    assert resp.version == 1 and resp.state == "shadow"
    runtime.broadcast_mock.assert_called_once()
    event, payload = runtime.broadcast_mock.call_args.args
    assert event == "host_repeater" and payload["version"] == 1

    stale = router_module.HostRepeaterSaveRequest(version=0, settings=HostRepeaterSettings())
    with pytest.raises(HTTPException) as exc:
        await router_module.save_host_repeater_settings(stale)
    assert exc.value.status_code == 409

    # A fresh runtime (restart) reads the stored document back.
    fresh = HostRepeaterRuntime()
    await fresh.load()
    assert fresh.version == 1 and fresh.settings.shadow_enabled


@pytest.mark.asyncio
async def test_openhop_radio_cannot_enable_shadow(test_db, runtime):
    with patch.object(
        router_module,
        "radio_snapshot",
        lambda: snapshot(bytes(32), model="openHop-Repeater-Companion"),
    ):
        get = await router_module.get_host_repeater()
        assert get.capabilities.openhop and "openhop" in get.capabilities.arm_blockers
        req = router_module.HostRepeaterSaveRequest(
            version=0, settings=HostRepeaterSettings(shadow_enabled=True)
        )
        with pytest.raises(HTTPException) as exc:
            await router_module.save_host_repeater_settings(req)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_validate_reports_errors_without_saving(test_db, runtime):
    bad = await router_module.validate_host_repeater_settings(
        router_module.HostRepeaterValidateRequest(settings={"flood_max": 99, "x": 1})
    )
    assert not bad.valid and {e.loc for e in bad.errors} == {"flood_max", "x"}
    ok = await router_module.validate_host_repeater_settings(
        router_module.HostRepeaterValidateRequest(settings={"flood_max": 10})
    )
    assert ok.valid and ok.errors == []


# ── shadow runtime ──────────────────────────────────────────────────────


def _grp(n: int) -> bytes:
    return bytes([(0x05 << 2) | 1, 0x00, 0x42, 1, 2]) + bytes([n]) * 16


@pytest.mark.asyncio
async def test_shadow_off_observes_nothing(test_db):
    rt = HostRepeaterRuntime()
    assert rt.pre_observe(_grp(1)) is None
    out = await rt.observe(
        _grp(1),
        snr=5.0,
        rssi=-80,
        arrival=time.monotonic(),
        result={},
        pre=None,
        radio=snapshot(bytes(32)),
    )
    assert out is None and rt.stats.observed == 0


@pytest.mark.asyncio
async def test_shadow_counts_forward_duplicate_and_echo_gap(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    rt.engine.configure(settings=rt.settings)
    radio = snapshot(bytes([0xAB]) + bytes(31))
    t0 = time.monotonic()
    first = await rt.observe(
        _grp(1), snr=5.0, rssi=-80, arrival=t0, result={}, pre=PreFacts(), radio=radio
    )
    assert first is not None and first.forward
    relayed = bytes([(0x05 << 2) | 1, 0x01, 0x77, 0x42, 1, 2]) + bytes([1]) * 16
    second = await rt.observe(
        relayed, snr=5.0, rssi=-80, arrival=t0 + 0.2, result={}, pre=PreFacts(), radio=radio
    )
    assert second is not None and second.reason == "duplicate"
    stats = rt.stats_snapshot(869.618)
    assert (stats["observed"], stats["would_forward"], stats["would_drop"]) == (2, 1, 1)
    assert stats["by_reason"] == {"forward:flood": 1, "duplicate": 1}
    assert stats["echo"]["gap_ms"]["count"] == 1
    assert stats["airtime"]["would_forward_total_ms"] > 0
    assert stats["recent"][0]["reason"] == "duplicate"


@pytest.mark.asyncio
async def test_shadow_skips_openhop_radio(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    out = await rt.observe(
        _grp(2),
        snr=1.0,
        rssi=-90,
        arrival=time.monotonic(),
        result={},
        pre=PreFacts(),
        radio=snapshot(bytes(32), model="openHop-Repeater-Companion"),
    )
    assert out is None and rt.stats.observed == 0


@pytest.mark.asyncio
async def test_too_late_when_pipeline_exceeds_latency_budget(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True, max_forward_latency_ms=100)
    rt.engine.configure(settings=rt.settings)
    out = await rt.observe(
        _grp(3),
        snr=1.0,
        rssi=-90,
        arrival=time.monotonic() - 1.0,
        result={},
        pre=PreFacts(),
        radio=snapshot(bytes(32)),
    )
    assert out is not None and out.reason == "too_late"


@pytest.mark.asyncio
async def test_expected_ack_is_for_us(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    rt.engine.configure(settings=rt.settings)
    ack = bytes([(0x03 << 2) | 1, 0x01, 0x55, 0xDE, 0xAD, 0xBE, 0xEF])
    dm_ack_tracker._pending_acks["deadbeef"] = (1, time.time(), 10000)
    try:
        pre = rt.pre_observe(ack)
        assert pre == PreFacts(ack_expected=True)
        out = await rt.observe(
            ack,
            snr=1.0,
            rssi=-90,
            arrival=time.monotonic(),
            result={},
            pre=pre,
            radio=snapshot(bytes(32)),
        )
    finally:
        dm_ack_tracker._pending_acks.pop("deadbeef", None)
    assert out is not None and out.reason == "for_us"


@pytest.mark.asyncio
async def test_peer_packet_for_us_and_own_detected_by_mac(test_db):
    from app.models import ContactUpsert
    from app.repository import ContactRepository

    our_priv = bytes([0x11] * 32) + bytes(32)
    their_priv = bytes([0x22] * 32) + bytes(32)
    our_pub = derive_public_key(our_priv)
    their_pub = derive_public_key(their_priv)
    await ContactRepository.upsert(ContactUpsert(public_key=their_pub.hex(), name="them", type=1))

    secret = derive_shared_secret(our_priv, their_pub)
    ct = AES.new(secret[:16], AES.MODE_ECB).encrypt(bytes(16))
    mac = hmac.new(secret, ct, hashlib.sha256).digest()[:2]
    to_us = bytes([(0x02 << 2) | 1, 0x00, our_pub[0], their_pub[0]]) + mac + ct
    from_us = bytes([(0x02 << 2) | 1, 0x00, their_pub[0], our_pub[0]]) + mac + ct

    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    rt.engine.configure(settings=rt.settings)
    radio = snapshot(our_pub)
    with patch("app.services.host_repeater.get_private_key", return_value=our_priv):
        a = await rt.observe(
            to_us,
            snr=1.0,
            rssi=-90,
            arrival=time.monotonic(),
            result={},
            pre=PreFacts(),
            radio=radio,
        )
        b = await rt.observe(
            from_us,
            snr=1.0,
            rssi=-90,
            arrival=time.monotonic(),
            result={},
            pre=PreFacts(),
            radio=radio,
        )
    assert a is not None and a.reason == "for_us"
    assert b is not None and b.reason == "own_origin"


def test_stats_sample_estimates_invisible_rx():
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    rt.on_stats_sample({"packets": {"recv": 100}, "rx_air_secs": 10, "tx_air_secs": 5})
    rt.stats.pushes = 7
    rt.on_stats_sample({"packets": {"recv": 110}, "rx_air_secs": 12, "tx_air_secs": 6})
    snapshot = rt.stats_snapshot(869.618)
    inv = snapshot["invisible_rx"]
    assert snapshot["region_gate"]["enabled"] is False
    assert inv == {"samples": 1, "radio_recv": 10, "pushes": 7, "estimate": 3}


# ── RF safety: shadow code cannot reach the send path ───────────────────

FORBIDDEN_IMPORTS = (
    "meshcore",
    "app.radio",
    "app.radio_sync",
    "app.services.radio_runtime",
    "app.services.radio_commands",
    "app.services.message_send",
)


@pytest.mark.parametrize(
    "module_name",
    [
        "app.services.host_repeater_engine",
        "app.services.host_repeater_policy",
        "app.services.host_repeater_settings",
        "app.services.host_repeater",
    ],
)
def test_shadow_modules_do_not_import_the_radio(module_name):
    module = importlib.import_module(module_name)
    source = Path(inspect.getfile(module)).read_text(encoding="utf-8")
    tree = ast.parse(source)
    runtime_imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and "TYPE_CHECKING" in ast.unparse(node.test):
            node.body = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            runtime_imports += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            runtime_imports.append(node.module)
    for name in runtime_imports:
        assert not any(name == f or name.startswith(f + ".") for f in FORBIDDEN_IMPORTS), name
    assert "host_repeater_link" not in [n.split(".")[-1] for n in runtime_imports]
    assert "send_raw_packet" not in source and "commands." not in source


def test_radio_snapshot_module_sends_nothing():
    from app.services import host_repeater_link

    source = Path(inspect.getfile(host_repeater_link)).read_text(encoding="utf-8")
    assert "commands." not in source and "send_raw_packet" not in source
    assert "radio_operation" not in source


def test_policy_string_values_are_coerced_and_empty_condition_never_matches():
    from app.services.host_repeater_policy import evaluate_policy
    from app.services.host_repeater_settings import PolicyConfig

    policy = PolicyConfig.model_validate(
        {
            "enabled": True,
            "rules": [
                {"id": "empty", "if": {}, "then": {"action": "drop"}},
                {
                    "id": "far",
                    "if": {"field": "hop_count", "op": "greater_than", "value": "3"},
                    "then": {"action": "drop"},
                },
                {
                    "id": "dec",
                    "if": {"field": "channel_decryptable", "op": "equals", "value": "true"},
                    "then": {"action": "log_only"},
                },
            ],
        }
    )
    assert evaluate_policy(policy, {"hop_count": 5}).rule_id == "far"
    assert evaluate_policy(policy, {"hop_count": 2, "channel_decryptable": True}).rule_id == "dec"
    assert not evaluate_policy(policy, {"hop_count": 2, "channel_decryptable": False}).matched


# ── Phase 4: score-based receive delay ──────────────────────────────────


@pytest.mark.asyncio
async def test_weak_flood_is_held_and_yields_to_a_neighbours_relay(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True, rx_delay_base=3.0)
    rt.engine.configure(settings=rt.settings)
    radio = snapshot(bytes([0xAB]) + bytes(31))
    t0 = time.monotonic()
    held = await rt.observe(
        _grp(7), snr=-10.0, rssi=-120, arrival=t0, result={}, pre=PreFacts(), radio=radio
    )
    assert held is None and len(rt._held) == 1 and rt.stats.observed == 0
    relayed = bytes([(0x05 << 2) | 1, 0x01, 0x77]) + _grp(7)[2:]
    relay = await rt.observe(
        relayed, snr=20.0, rssi=-60, arrival=t0 + 0.01, result={}, pre=PreFacts(), radio=radio
    )
    assert relay is not None and relay.forward  # strong copy judged at once
    await asyncio.gather(*rt._held)
    stats = rt.stats_snapshot(869.618)
    assert (stats["observed"], stats["would_forward"], stats["would_drop"]) == (2, 1, 1)
    assert stats["by_reason"] == {"forward:flood": 1, "duplicate": 1}
    assert stats["rx_delay"]["held"] == 1 and stats["rx_delay"]["yielded"] == 1
    assert stats["rx_delay"]["pending"] == 0 and stats["rx_delay"]["delay_ms"]["p50"] > 50
    hold_row = next(r for r in stats["recent"] if r["rx_delay_ms"] is not None)
    assert hold_row["reason"] == "duplicate" and hold_row["score"] == 0.0


@pytest.mark.asyncio
async def test_held_frame_is_judged_after_its_delay_when_nobody_relays(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True, rx_delay_base=3.0)
    rt.engine.configure(settings=rt.settings)
    radio = snapshot(bytes([0xAB]) + bytes(31))
    assert (
        await rt.observe(
            _grp(8),
            snr=-9.9,
            rssi=-120,
            arrival=time.monotonic(),
            result={},
            pre=PreFacts(),
            radio=radio,
        )
        is None
    )
    await asyncio.gather(*rt._held)
    stats = rt.stats_snapshot(869.618)
    assert stats["would_forward"] == 1 and stats["rx_delay"] == {
        "enabled": True,
        "held": 1,
        "yielded": 0,
        "pending": 0,
        "delay_ms": stats["rx_delay"]["delay_ms"],
    }
    assert stats["latency_ms"]["max"] < 1000  # the hold is not counted as pipeline latency
    await rt.stop()


@pytest.mark.asyncio
async def test_stop_drops_held_frames(test_db):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True, rx_delay_base=20.0)
    rt.engine.configure(settings=rt.settings)
    radio = snapshot(bytes([0xAB]) + bytes(31))
    await rt.observe(
        _grp(9),
        snr=-9.9,
        rssi=-120,
        arrival=time.monotonic(),
        result={},
        pre=PreFacts(),
        radio=radio,
    )
    assert len(rt._held) == 1
    await rt.stop()
    assert len(rt._held) == 0 and rt.stats.observed == 0


# ── Phase 4: lifetime totals survive a restart ──────────────────────────


@pytest.mark.asyncio
async def test_lifetime_totals_persist_across_runtimes(test_db):
    with patch("app.services.host_repeater.broadcast_event"):
        first = HostRepeaterRuntime()
        await first.load()
        assert first.lifetime.runs == 1 and first.stats_snapshot(None)["lifetime"]["persisted"]
        first.settings = HostRepeaterSettings(shadow_enabled=True)
        first.engine.configure(settings=first.settings)
        radio = snapshot(bytes([0xAB]) + bytes(31))
        await first.observe(
            _grp(11),
            snr=5.0,
            rssi=-80,
            arrival=time.monotonic(),
            result={},
            pre=PreFacts(),
            radio=radio,
        )
        first.reset_stats()  # session reset keeps the lifetime totals
        assert first.stats.observed == 0 and first.lifetime.observed == 1
        await first.stop()

        second = HostRepeaterRuntime()
        await second.load()
        life = second.stats_snapshot(None)["lifetime"]
        assert life["runs"] == 2 and life["observed"] == 1 and life["would_forward"] == 1
        assert life["by_reason"] == {"forward:flood": 1} and life["by_type"] == {
            "GRP_TXT": {"forward": 1}
        }
        assert life["since"] == first.lifetime.since

        await second.reset_lifetime()
        third = HostRepeaterRuntime()
        await third.load()
        assert third.lifetime.runs == 2 and third.lifetime.observed == 0


@pytest.mark.asyncio
async def test_stats_reset_endpoint_lifetime_flag(test_db, runtime):
    await runtime.load()
    runtime.lifetime.observed = 5
    runtime.stats.observed = 3
    assert await router_module.reset_host_repeater_stats(lifetime=False) == {"status": "ok"}
    assert runtime.stats.observed == 0 and runtime.lifetime.observed == 5
    assert await router_module.reset_host_repeater_stats(lifetime=True) == {"status": "ok"}
    assert runtime.lifetime.observed == 0
    stats = await router_module.get_host_repeater_stats()
    assert stats["lifetime"]["observed"] == 0 and stats["advert_limiter"]["enabled"] is False
