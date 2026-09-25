"""Golden vectors for the host repeater forwarding engine (plan 29, Phase 2).

Frames are built by hand from the MeshCore wire format; expected bytes follow
``src/Mesh.cpp`` (flood append, direct strip, routed ACK regeneration, multipart
ACK, TRACE SNR append) and the repeater / DMC / OpenHop gates.
"""

import hashlib
import hmac
import random
import time

import pytest
from Crypto.Cipher import AES
from nacl.signing import SigningKey

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.region_resolver import compute_transport_code
from app.services.host_repeater_engine import (
    AdvertLimiter,
    AirtimeBudget,
    DmcLimiter,
    ForwardingEngine,
    RadioParams,
    RxFacts,
    lora_airtime_ms,
    packet_hash,
    packet_score,
    rx_delay_ms,
)
from app.services.host_repeater_settings import (
    BlockedChannel,
    DmcTypeLimits,
    HostRepeaterSettings,
    PolicyConfig,
    PolicyRule,
    RegionConfig,
)

OUR_KEY = bytes([0xAB, 0xCD, 0xEF]) + bytes(range(29))
RADIO = RadioParams(freq_mhz=869.618, bw_khz=62.5, sf=8, cr=8)
NOW = 1000.0

FLOOD, TFLOOD, DIRECT, TDIRECT = 1, 0, 2, 3
REQ, TXT, ACK, ADVERT, GRP_TXT, TRACE, MULTIPART, CONTROL, RAW_CUSTOM = (
    0x00,
    0x02,
    0x03,
    0x04,
    0x05,
    0x09,
    0x0A,
    0x0B,
    0x0F,
)


def frame(
    route: int, ptype: int, path_byte: int, path: bytes, payload: bytes, codes: bytes = b""
) -> bytes:
    return bytes([(ptype << 2) | route]) + codes + bytes([path_byte]) + path + payload


def grp_payload(n: int = 0) -> bytes:
    # channel hash 0x42, 2-byte MAC, one 16-byte block; n makes payloads unique
    return bytes([0x42, 0x01, 0x02]) + bytes([n]) * 16


def engine(**overrides) -> ForwardingEngine:
    return ForwardingEngine(HostRepeaterSettings(**overrides), OUR_KEY, RADIO, rng=random.Random(1))


def decide(eng: ForwardingEngine, raw: bytes, now: float = NOW, **facts):
    return eng.decide(raw, RxFacts(**facts), now, wall_now=time.time())


# ── airtime / hash ──────────────────────────────────────────────────────


def test_airtime_matches_semtech_reference():
    # SF7 / 125 kHz / CR 4/5, 10 bytes, 8 preamble symbols: 41.216 ms (Semtech calculator)
    ms = lora_airtime_ms(10, RadioParams(868.0, 125.0, 7, 5), preamble_symbols=8)
    assert ms == pytest.approx(41.216, abs=0.001)


def test_airtime_accepts_cr_index_form():
    a = lora_airtime_ms(50, RadioParams(868.0, 62.5, 8, 8))
    b = lora_airtime_ms(50, RadioParams(868.0, 62.5, 8, 4))
    assert a == b


def test_trace_hash_includes_path_byte():
    payload = bytes(12)
    assert packet_hash(TRACE, payload, 1) != packet_hash(TRACE, payload, 2)
    assert packet_hash(GRP_TXT, payload, 1) == packet_hash(GRP_TXT, payload, 2)


# ── flood forwarding ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path_byte", "path", "new_path_byte", "ours"),
    [
        (0x02, bytes([0x11, 0x22]), 0x03, bytes([0xAB])),
        (0x41, bytes([0x11, 0x22]), 0x42, bytes([0xAB, 0xCD])),
        (0x81, bytes([0x11, 0x22, 0x33]), 0x82, bytes([0xAB, 0xCD, 0xEF])),
    ],
)
def test_flood_appends_our_hash_at_packet_hash_size(path_byte, path, new_path_byte, ours):
    payload = grp_payload()
    d = decide(engine(), frame(FLOOD, GRP_TXT, path_byte, path, payload))
    assert d.forward and d.reason == "flood"
    assert d.forwarded == frame(FLOOD, GRP_TXT, new_path_byte, path + ours, payload)
    assert d.priority == (new_path_byte & 0x3F)
    assert d.delay_ms is not None and 0 <= d.delay_ms <= 5000


def region_codes(name: str, ptype: int, payload: bytes) -> bytes:
    code = compute_transport_code(name, ptype, payload)
    assert code is not None
    return code.to_bytes(2, "little") + b"\x00\x00"


def scoped(name: str, n: int = 0, hops: int = 1) -> bytes:
    payload = grp_payload(n)
    path = bytes([0x11]) * hops
    return frame(TFLOOD, GRP_TXT, hops, path, payload, region_codes(name, GRP_TXT, payload))


def region(name: str, parent: str | None = None, deny: bool = False) -> RegionConfig:
    return RegionConfig(name=name, parent=parent, deny_flood=deny)


def test_transport_flood_keeps_codes_and_needs_a_listed_allowed_region():
    payload = grp_payload()
    codes = region_codes("nl", GRP_TXT, payload)
    raw = frame(TFLOOD, GRP_TXT, 0x01, b"\x11", payload, codes)
    # The host pipeline's known_regions match does not count: only the host list does.
    assert decide(engine(), raw, region="nl").reason == "unknown_region"
    d = decide(engine(regions=[region("nl")]), raw)
    assert d.forward
    assert d.forwarded == frame(TFLOOD, GRP_TXT, 0x02, b"\x11\xab", payload, codes)
    assert decide(engine(regions=[region("be")]), raw).reason == "unknown_region"
    denied = engine(regions=[region("nl", deny=True)])
    assert decide(denied, raw).reason == "region_denied"


def test_region_names_are_stored_without_hash_and_validated():
    settings = HostRepeaterSettings(regions=[{"name": "#nl"}, {"name": "nl-nh", "parent": "#nl"}])
    assert [(r.name, r.parent) for r in settings.regions] == [("nl", None), ("nl-nh", "nl")]
    bad = [
        {"regions": [{"name": "nl"}, {"name": "nl"}]},
        {"regions": [{"name": "nl-nh", "parent": "nl"}]},
        {"regions": [{"name": "a", "parent": "b"}, {"name": "b", "parent": "a"}]},
        {"regions": [{"name": "nl"}], "home_region": "be"},
        {"regions": [{"name": "has space"}]},
        {"regions": [{"name": "x" * 31}]},
        {"regions": [{"name": f"r{i}"} for i in range(33)]},
    ]
    for doc in bad:
        with pytest.raises(ValueError):
            HostRepeaterSettings.model_validate(doc)


def test_legacy_region_rules_document_still_loads():
    # The document shadow mode saved before the region map existed (live DB, v1).
    legacy = HostRepeaterSettings().model_dump(mode="json", by_alias=True)
    for key in (
        "regions",
        "home_region",
        "dc_gate_enabled",
        "dc_gate_threshold",
        "dc_gate_hysteresis",
    ):
        legacy.pop(key)
    legacy["region_rules"] = {}
    legacy["shadow_enabled"] = True
    loaded = HostRepeaterSettings.model_validate(legacy)
    assert loaded.shadow_enabled and loaded.regions == []
    converted = HostRepeaterSettings.model_validate({"region_rules": {"nl": "deny", "be": "allow"}})
    assert [(r.name, r.deny_flood) for r in converted.regions] == [("nl", True), ("be", False)]


# ── DMC duty-cycle region gating ────────────────────────────────────────


def test_airtime_budget_reads_percent_of_budget_in_use():
    budget = AirtimeBudget()
    budget.configure(0.10, 0.0)
    assert budget.max_ms == 360_000
    assert budget.used_percent(0.0) == 0
    budget.consume(0.0, 252_000)
    assert budget.used_percent(0.0) == 70
    # Refilled at the duty rate: 100 s gives back 10 s of airtime.
    assert budget.used_percent(100.0) == 67
    # Transmitting below the duty cycle keeps the reading near 0.
    steady = AirtimeBudget()
    steady.configure(0.10, 0.0)
    for t in range(0, 3600, 10):
        steady.consume(float(t), 500.0)  # 5 % of wall time
    assert steady.used_percent(3600.0) <= 1


TREE = [region("nl"), region("nl-nh", "nl"), region("nl-nh-ams", "nl-nh")]


def gated_engine(**overrides) -> ForwardingEngine:
    return engine(regions=TREE, dc_gate_enabled=True, **overrides)


def test_gate_closes_layers_outside_in_and_protects_the_innermost():
    eng = gated_engine()
    eng.add_own_tx(NOW, 280_000)  # 78 % of the 360 s budget at 869.618 MHz
    snap = eng.gate_snapshot(NOW)
    # Checks run every 10 s; the first one ran before the airtime was spent.
    assert snap["budget_used_percent"] == 78 and snap["level"] == 0 and snap["max_level"] == 3
    snap = eng.gate_snapshot(NOW + 10)
    assert snap["level"] == 1 and snap["wildcard_gated"] and snap["gated_regions"] == []
    plain = frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(1))
    assert decide(eng, plain, now=NOW + 10).reason == "region_gated"
    assert decide(eng, scoped("nl", 2), now=NOW + 10).forward

    snap = eng.gate_snapshot(NOW + 20)
    assert snap["level"] == 2 and snap["gated_regions"] == ["nl"]
    assert decide(eng, scoped("nl", 3), now=NOW + 20).reason == "region_gated"
    assert decide(eng, scoped("nl-nh", 4), now=NOW + 20).forward

    snap = eng.gate_snapshot(NOW + 30)
    assert snap["level"] == 3 and snap["gated_regions"] == ["nl", "nl-nh"]
    assert decide(eng, scoped("nl-nh-ams", 5), now=NOW + 30).forward
    # Max level reached: stays there while the budget is still above the threshold.
    assert eng.gate_snapshot(NOW + 40)["level"] == 3


def test_gate_recovers_inside_out_once_budget_refills():
    eng = gated_engine()
    eng.add_own_tx(NOW, 280_000)
    assert eng.gate_snapshot(NOW + 30)["level"] == 3
    # Between threshold - hysteresis (60) and threshold (70): hold.
    assert eng.gate_snapshot(NOW + 120)["level"] == 3  # 280 - 12 = 268 s used, 74 %
    # 1 h later the bucket is full again and every layer re-opened.
    snap = eng.gate_snapshot(NOW + 3600)
    assert snap["budget_used_percent"] == 0 and snap["level"] == 0
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(9)), now=NOW + 3600).forward


def test_home_region_is_never_gated():
    eng = gated_engine(home_region="nl")
    eng.add_own_tx(NOW, 300_000)
    snap = eng.gate_snapshot(NOW + 30)
    assert snap["level"] == 3 and snap["gated_regions"] == ["nl-nh"]
    assert decide(eng, scoped("nl", 1), now=NOW + 30).forward


def test_flat_list_only_gates_the_wildcard_and_no_regions_never_gates():
    flat = engine(regions=[region("nl"), region("be")], dc_gate_enabled=True)
    flat.add_own_tx(NOW, 350_000)
    snap = flat.gate_snapshot(NOW + 60)
    assert snap["max_level"] == 1 and snap["level"] == 1 and snap["gated_regions"] == []
    assert decide(flat, scoped("be", 1), now=NOW + 60).forward
    none = engine(dc_gate_enabled=True)
    none.add_own_tx(NOW, 360_000)
    assert none.gate_snapshot(NOW + 60)["level"] == 0
    assert decide(none, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(2)), now=NOW + 60).forward


def test_gate_off_or_unknown_band_never_gates():
    off = engine(regions=TREE)
    off.add_own_tx(NOW, 360_000)
    assert off.gate_snapshot(NOW + 60)["level"] == 0
    us = ForwardingEngine(
        HostRepeaterSettings(regions=TREE, dc_gate_enabled=True),
        OUR_KEY,
        RadioParams(freq_mhz=910.525, bw_khz=62.5, sf=8, cr=8),
        rng=random.Random(1),
    )
    us.add_own_tx(NOW, 360_000)
    snap = us.gate_snapshot(NOW + 60)
    assert snap["budget_used_percent"] is None and snap["level"] == 0


def test_forwards_use_the_same_budget():
    eng = gated_engine()
    before = eng.gate_snapshot(NOW)["budget_used_percent"]
    for n in range(5):
        assert decide(eng, scoped("nl", n + 10), now=NOW).forward
    assert eng._budget.tokens_ms < eng._budget.max_ms
    assert before == 0


def test_plain_flood_stays_plain_and_can_be_denied():
    raw = frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload())
    d = decide(engine(), raw)
    assert d.forwarded is not None and d.forwarded[0] & 0x03 == FLOOD
    assert decide(engine(unscoped_flood_allow=False), raw).reason == "unscoped_denied"


def test_duplicate_is_dropped_even_with_a_different_path():
    eng = engine()
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x01, b"\x11", grp_payload())).forward
    again = decide(eng, frame(FLOOD, GRP_TXT, 0x02, b"\x11\x22", grp_payload()))
    assert again.reason == "duplicate"


def test_seen_table_entry_expires_after_ttl():
    eng = engine(seen_ttl_seconds=300)
    raw = frame(FLOOD, GRP_TXT, 0x01, b"\x11", grp_payload())
    assert decide(eng, raw, now=NOW).forward
    assert decide(eng, raw, now=NOW + 301).forward


@pytest.mark.parametrize("ptype", [RAW_CUSTOM, TRACE, CONTROL, MULTIPART])
def test_types_the_firmware_never_flood_forwards(ptype):
    d = decide(engine(), frame(FLOOD, ptype, 0x00, b"", bytes(20)))
    assert d.reason == "type_not_forwarded"


def test_flood_max_variants():
    raw = frame(FLOOD, GRP_TXT, 0x02, b"\x11\x22", grp_payload())
    assert decide(engine(flood_max=2), raw).reason == "flood_max"
    assert decide(engine(flood_max_unscoped=2), raw).reason == "flood_max"
    assert decide(engine(flood_max=3), raw).forward


def test_loop_detect_minimal_one_byte_threshold_is_four():
    three = bytes([0xAB, 0x11, 0xAB, 0x22, 0xAB])
    four = three + b"\xab"
    assert decide(engine(), frame(FLOOD, GRP_TXT, len(three), three, grp_payload(1))).forward
    assert decide(engine(), frame(FLOOD, GRP_TXT, len(four), four, grp_payload(2))).reason == "loop"
    assert decide(
        engine(loop_detect="off"), frame(FLOOD, GRP_TXT, len(four), four, grp_payload(3))
    ).forward


def test_path_full_when_our_hash_does_not_fit():
    path = bytes(64)  # 32 hops of 2-byte hashes
    raw = frame(FLOOD, GRP_TXT, 0x40 | 32, path, grp_payload())
    assert decide(engine(loop_detect="off"), raw).reason == "path_full"


def test_for_us_and_own_origin_are_not_forwarded():
    raw = frame(FLOOD, TXT, 0x01, b"\x11", bytes([0xAB, 0x22]) + bytes(18))
    assert decide(engine(), raw, for_us=True).reason == "for_us"
    raw2 = frame(FLOOD, TXT, 0x01, b"\x11", bytes([0x22, 0xAB]) + bytes(18))
    assert decide(engine(), raw2, own_origin=True).reason == "own_origin"


def test_incomplete_peer_packet_is_malformed():
    raw = frame(FLOOD, TXT, 0x00, b"", bytes([0x11, 0x22, 0x01, 0x02]))
    assert decide(engine(), raw).reason == "malformed"


def test_advert_needs_valid_signature_and_is_not_ours():
    key = SigningKey.generate()
    pub = bytes(key.verify_key)
    ts = (123456).to_bytes(4, "little")
    app_data = b"\x81node"
    sig = key.sign(pub + ts + app_data).signature
    good = pub + ts + sig + app_data
    assert decide(engine(), frame(FLOOD, ADVERT, 0x00, b"", good)).forward
    bad = pub + ts + bytes(64) + app_data
    assert decide(engine(), frame(FLOOD, ADVERT, 0x00, b"", bad)).reason == "bad_signature"
    ours = OUR_KEY + ts + sig + app_data
    assert decide(engine(), frame(FLOOD, ADVERT, 0x00, b"", ours)).reason == "own_origin"
    far = frame(FLOOD, ADVERT, 8, bytes(range(1, 9)), good)
    assert decide(engine(), far).reason == "flood_max"  # flood.max.advert default 8


def test_too_large_for_the_raw_send_command():
    payload = bytes([0x42, 1, 2]) + bytes(16 * 10)  # 163 bytes
    raw = frame(FLOOD, GRP_TXT, 0x44, bytes(8), payload)  # 1 + 1 + 8 + 163 = 173
    d = decide(engine(loop_detect="off"), raw)
    assert d.reason == "too_large"


def test_duty_cycle_window_drops_when_budget_is_used():
    eng = engine(max_airtime_per_minute_ms=400)
    first = decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(1)))
    assert first.forward and first.airtime_ms and first.airtime_ms < 400
    second = decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(2)))
    assert second.reason == "duty_cycle"
    later = decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(3)), now=NOW + 61)
    assert later.forward


# ── direct forwarding ───────────────────────────────────────────────────


def test_direct_strips_our_hash_priority_zero():
    payload = bytes([0x33, 0x44]) + bytes(18)
    d = decide(engine(), frame(DIRECT, TXT, 0x02, b"\xab\x22", payload))
    assert d.forward and d.reason == "direct"
    assert d.forwarded == frame(DIRECT, TXT, 0x01, b"\x22", payload)
    assert d.priority == 0


def test_direct_two_byte_hash_strip():
    payload = bytes(20)
    raw = frame(DIRECT, REQ, 0x42, b"\xab\xcd\x11\x22", payload)
    d = decide(engine(), raw)
    assert d.forwarded == frame(DIRECT, REQ, 0x41, b"\x11\x22", payload)


def test_direct_not_next_hop_and_zero_hop():
    assert decide(engine(), frame(DIRECT, TXT, 0x01, b"\x22", bytes(20))).reason == "not_next_hop"
    assert decide(engine(), frame(DIRECT, TXT, 0x00, b"", bytes(20))).reason == "zero_hop"


def test_routed_ack_is_regenerated_as_plain_direct_without_delay():
    codes = bytes([1, 2, 3, 4])
    payload = bytes([9, 8, 7, 6])
    d = decide(engine(), frame(TDIRECT, ACK, 0x02, b"\xab\x33", payload, codes))
    assert d.reason == "ack" and d.delay_ms == 0.0 and d.priority == 0
    assert d.forwarded == bytes([(ACK << 2) | DIRECT, 0x01, 0x33]) + payload


def test_multipart_ack_relayed_as_plain_ack_with_spacing():
    payload = bytes([(2 << 4) | ACK, 9, 8, 7, 6])
    d = decide(engine(), frame(DIRECT, MULTIPART, 0x02, b"\xab\x33", payload))
    assert d.reason == "multipart_ack"
    assert d.delay_ms == 900.0
    assert d.forwarded == bytes([(ACK << 2) | DIRECT, 0x01, 0x33, 9, 8, 7, 6])
    other = bytes([(2 << 4) | TXT, 9, 8, 7, 6])
    assert decide(engine(), frame(DIRECT, MULTIPART, 0x02, b"\xab\x33", other)).reason == (
        "multipart_unsupported"
    )


def test_trace_appends_snr_priority_five():
    head = bytes(8) + bytes([0x00])  # tag, auth, flags (1-byte hashes)
    hashes = bytes([0x55, 0xAB, 0x66])
    raw = frame(DIRECT, TRACE, 0x01, b"\x14", head + hashes)
    d = decide(engine(), raw, snr=7.25)
    assert d.reason == "trace" and d.priority == 5
    assert d.forwarded == frame(DIRECT, TRACE, 0x02, b"\x14\x1d", head + hashes)
    neg = decide(engine(), raw, snr=-3.5)
    assert neg.forwarded is not None and neg.forwarded[3] == 0xF2  # int8(-14)
    end = frame(DIRECT, TRACE, 0x03, b"\x01\x02\x03", head + hashes)
    assert decide(engine(), end).reason == "trace_end"
    other = frame(DIRECT, TRACE, 0x00, b"", head + hashes)
    assert decide(engine(), other).reason == "not_next_hop"


def test_high_bit_control_is_zero_hop_only():
    raw = frame(DIRECT, CONTROL, 0x01, b"\xab", bytes([0x80]) + bytes(5))
    assert decide(engine(), raw).reason == "control_zero_hop"


def test_no_identity_or_radio_means_no_decision():
    raw = frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload())
    assert (
        ForwardingEngine(HostRepeaterSettings(), None, RADIO).decide(raw, RxFacts(), NOW).reason
        == "no_identity"
    )
    assert (
        ForwardingEngine(HostRepeaterSettings(), OUR_KEY, None).decide(raw, RxFacts(), NOW).reason
        == "no_radio"
    )


# ── OpenHop policy (evaluated first) ────────────────────────────────────


def rule(rid: str, cond: dict, action: str) -> PolicyRule:
    return PolicyRule.model_validate({"id": rid, "if": cond, "then": {"action": action}})


def test_policy_drop_runs_before_everything_including_direct():
    policy = PolicyConfig(
        enabled=True,
        rules=[rule("r1", {"field": "payload_type", "op": "equals", "value": TXT}, "drop")],
    )
    d = decide(engine(policy=policy), frame(DIRECT, TXT, 0x02, b"\xab\x22", bytes(20)))
    assert d.reason == "policy_drop" and d.policy_rule_id == "r1"


def test_policy_allow_does_not_bypass_gates_and_log_only_is_recorded():
    policy = PolicyConfig(
        enabled=True,
        rules=[
            rule("allow-all", {"field": "hop_count", "op": "greater_or_equal", "value": 0}, "allow")
        ],
    )
    eng = engine(policy=policy)
    raw = frame(FLOOD, GRP_TXT, 0x01, b"\x11", grp_payload())
    assert decide(eng, raw).forward
    assert decide(eng, raw).reason == "duplicate"
    log_policy = PolicyConfig(
        enabled=True,
        rules=[rule("watch", {"field": "channel_hash", "op": "equals", "value": "42"}, "log_only")],
    )
    d = decide(engine(policy=log_policy), raw)
    assert d.forward and d.policy_rule_id == "watch" and d.policy_action == "log_only"


def test_policy_default_action_and_groups():
    policy = PolicyConfig.model_validate(
        {
            "enabled": True,
            "default_action": "drop",
            "objects": {"channel_hash_groups": {"ok": ["42"]}},
            "rules": [
                {
                    "id": "keep",
                    "if": {"field": "channel_hash", "op": "in", "value": "@channel_hash_groups.ok"},
                    "then": {"action": "allow"},
                }
            ],
        }
    )
    eng = engine(policy=policy)
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload())).forward
    other = bytes([0x43, 1, 2]) + bytes(16)
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", other)).reason == "policy_drop"


# ── DMC filter ──────────────────────────────────────────────────────────


def test_dmc_limiter_hard_and_soft():
    hard = DmcLimiter(2, 60)
    assert [hard.allow(0, 0) for _ in range(3)] == [True, True, False]
    assert hard.allow(61, 0)  # new window
    soft = DmcLimiter(4, 60, soft=2)
    results = [soft.allow(0, 255) for _ in range(5)]
    assert results == [True, True, False, False, False]  # rnd 255 fails the ramp
    soft2 = DmcLimiter(4, 60, soft=2)
    assert [soft2.allow(0, 0) for _ in range(5)] == [True, True, True, False, False]


def test_dmc_filter_hops_hash_channel_rate():
    types = {"GRP_TXT": DmcTypeLimits(hops_max=2, rate_limit=1, rate_secs=60)}
    eng = engine(filter_enabled=True, filter_types=types)
    assert (
        decide(eng, frame(FLOOD, GRP_TXT, 0x02, b"\x11\x22", grp_payload(1))).reason
        == "filter_hops"
    )
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(2))).forward
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(3))).reason == "filter_rate"

    blocked = engine(filter_enabled=True, filter_channels=[BlockedChannel(hash="42")])
    assert (
        decide(blocked, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload())).reason == "filter_channel"
    )

    min2 = engine(filter_enabled=True, filter_min_hash_bytes=2)
    assert decide(min2, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload())).reason == "filter_hash"


def test_dmc_channel_block_does_not_consume_rate_budget():
    types = {"GRP_TXT": DmcTypeLimits(hops_max=32, rate_limit=1, rate_secs=60)}
    eng = engine(
        filter_enabled=True, filter_types=types, filter_channels=[BlockedChannel(hash="42")]
    )
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", grp_payload(1))).reason == "filter_channel"
    other = bytes([0x43, 1, 2]) + bytes(16)
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", other)).forward


def test_dmc_acl_bypass_and_direct_exempt():
    types = {"TXT_MSG": DmcTypeLimits(hops_max=0, rate_limit=1, rate_secs=60)}
    eng = engine(filter_enabled=True, filter_types=types)
    raw = frame(FLOOD, TXT, 0x01, b"\x11", bytes([0x55, 0x66]) + bytes(18))
    assert decide(eng, raw).reason == "filter_hops"
    raw2 = frame(FLOOD, TXT, 0x01, b"\x11", bytes([0x55, 0x67]) + bytes(18))
    assert decide(eng, raw2, acl_hashes=frozenset({0x67})).forward
    direct = frame(DIRECT, TXT, 0x02, b"\xab\x22", bytes(20))
    assert decide(eng, direct).forward


def _public_grp(timestamp: int, text: bytes) -> bytes:
    key = bytes.fromhex(PUBLIC_CHANNEL_KEY)
    plain = timestamp.to_bytes(4, "little") + b"\x00" + text
    plain += bytes(-len(plain) % 16)
    ct = AES.new(key, AES.MODE_ECB).encrypt(plain)
    mac = hmac.new(key + bytes(16), ct, hashlib.sha256).digest()[:2]
    return bytes([0x11]) + mac + ct


def test_dmc_malformed_public_scan():
    eng = engine(filter_enabled=True, filter_malformed=True)
    good = _public_grp(int(time.time()), b"alice: hi")
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", good)).forward
    stale = _public_grp(int(time.time()) - 8 * 86400, b"alice: hi")
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", stale)).reason == "filter_malformed"
    empty = _public_grp(int(time.time()), b"")
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", empty)).reason == "filter_malformed"
    bad_utf8 = _public_grp(int(time.time()), b"\xff\xfe")
    assert decide(eng, frame(FLOOD, GRP_TXT, 0x00, b"", bad_utf8)).reason == "filter_malformed"


# ── Phase 4: score-based delays ─────────────────────────────────────────


def test_packet_score_ports_packet_score_int():
    # RadioLibWrappers.cpp: 0 below the SF floor, (snr - floor) / 10 * (1 - len / 256), clamped.
    assert packet_score(-10.0, 8, 20) == 0.0
    assert packet_score(-10.1, 8, 20) == 0.0
    assert packet_score(-5.0, 8, 128) == pytest.approx(0.25)
    assert packet_score(20.0, 8, 20) == 1.0
    assert packet_score(-7.4, 7, 0) == pytest.approx(0.01)
    assert packet_score(None, 8, 20) is None
    assert packet_score(5.0, 6, 20) is None  # unknown SF: no score, delays stay off


def test_rx_delay_formula_threshold_and_cap():
    # MyMesh::calcRxDelay: (base ^ (0.85 - score) - 1) * airtime; < 50 ms means "now".
    assert rx_delay_ms(0.0, 100.0, 0.0) == 0.0
    assert rx_delay_ms(None, 100.0, 10.0) == 0.0
    assert rx_delay_ms(0.85, 100.0, 10.0) == 0.0
    assert rx_delay_ms(0.0, 100.0, 10.0) == pytest.approx((10**0.85 - 1) * 100.0)
    assert rx_delay_ms(0.8, 100.0, 10.0) == 0.0  # 12.2 ms, under the 50 ms threshold
    assert rx_delay_ms(0.0, 100_000.0, 20.0) == 32_000.0


def test_engine_holds_only_weak_floods():
    eng = engine(rx_delay_base=10.0)
    weak = frame(FLOOD, GRP_TXT, 0x02, bytes([0x11, 0x22]), grp_payload())
    assert eng.rx_delay_ms(weak, -9.9) > 50.0
    assert eng.rx_delay_ms(weak, 20.0) == 0.0  # score 1: strong receptions are judged now
    assert eng.rx_delay_ms(weak, None) == 0.0
    direct = frame(DIRECT, REQ, 0x01, bytes([0xAB]), bytes(20))
    assert eng.rx_delay_ms(direct, -9.9) == 0.0  # Dispatcher only queues floods
    assert engine().rx_delay_ms(weak, -9.9) == 0.0  # default off


def test_use_score_for_tx_shrinks_the_random_delay_for_strong_receptions():
    raw = frame(FLOOD, GRP_TXT, 0x02, bytes([0x11, 0x22]), grp_payload())
    plain = decide(engine(tx_delay_factor=10.0), raw, snr=20.0)
    scored = decide(engine(tx_delay_factor=10.0, use_score_for_tx=True), raw, snr=20.0)
    assert plain.forward and scored.forward and plain.delay_ms >= 50.0
    assert scored.score == 1.0 and scored.delay_ms == pytest.approx(plain.delay_ms * 0.2)
    # A reception at the SNR floor keeps the full delay; unknown SNR too.
    floor = decide(engine(tx_delay_factor=10.0, use_score_for_tx=True), raw, snr=-10.0)
    assert floor.score == 0.0 and floor.delay_ms == pytest.approx(plain.delay_ms)
    unknown = decide(engine(tx_delay_factor=10.0, use_score_for_tx=True), raw)
    assert unknown.score is None and unknown.delay_ms == pytest.approx(plain.delay_ms)


# ── Phase 4: per-source advert limiter ──────────────────────────────────


def test_advert_limiter_bucket_refill_and_min_interval():
    lim = AdvertLimiter(2, 1, 100, 10)
    assert lim.allow(b"a", 0.0)
    assert not lim.allow(b"a", 5.0)  # min interval
    assert lim.allow(b"a", 20.0)  # second token
    assert not lim.allow(b"a", 40.0)  # bucket empty
    assert lim.allow(b"b", 40.0)  # other node, own bucket
    assert lim.allow(b"a", 120.0)  # one token refilled at t=100
    assert not lim.allow(b"a", 140.0)
    assert (lim.allowed, lim.dropped, lim.tracked) == (4, 3, 2)


def _signed_advert(key: SigningKey, ts: int) -> bytes:
    pub = bytes(key.verify_key)
    stamp = ts.to_bytes(4, "little")
    app_data = b"\x81node"
    sig = key.sign(pub + stamp + app_data).signature
    return frame(FLOOD, ADVERT, 0x00, b"", pub + stamp + sig + app_data)


def test_engine_advert_rate_limits_repeat_adverts_per_source():
    key = SigningKey.generate()
    eng = engine(
        advert_limiter_enabled=True,
        advert_bucket_capacity=1,
        advert_min_interval_seconds=0,
        advert_refill_interval_seconds=3600,
    )
    assert decide(eng, _signed_advert(key, 1)).forward
    second = decide(eng, _signed_advert(key, 2), now=NOW + 60)
    assert second.reason == "advert_rate"
    other = decide(eng, _signed_advert(SigningKey.generate(), 2), now=NOW + 60)
    assert other.forward
    assert decide(eng, _signed_advert(key, 3), now=NOW + 3700).forward  # refilled
    snap = eng.advert_limiter_snapshot()
    assert snap == {"enabled": True, "tracked": 2, "allowed": 3, "dropped": 1}
    off = engine()
    assert decide(off, _signed_advert(key, 1)).forward
    assert decide(off, _signed_advert(key, 2), now=NOW + 60).forward
