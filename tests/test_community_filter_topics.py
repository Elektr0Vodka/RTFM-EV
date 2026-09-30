"""Community MQTT: DMC observer ``filter`` topic, own ``neighbors`` topic, config extras."""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app.fanout import community_mqtt as cm
from app.services.host_repeater import HostRepeaterRuntime
from app.services.host_repeater_settings import (
    FilterRule,
    HostRepeaterSettings,
    RegionConfig,
)


def _runtime(state: str = "shadow", **settings) -> HostRepeaterRuntime:
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=state != "off", **settings)
    rt.engine.configure(settings=rt.settings)
    return rt


def _publisher(monkeypatch, rt) -> tuple[cm.CommunityMqttPublisher, list]:
    pub = cm.CommunityMqttPublisher()
    published: list[tuple[str, dict, dict]] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append((topic, payload, kwargs))

    monkeypatch.setattr(pub, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")
    monkeypatch.setattr("app.services.host_repeater.host_repeater", rt)

    class _Repo:
        @staticmethod
        async def get():
            return SimpleNamespace(flood_scope="#nl")

    monkeypatch.setattr("app.repository.AppSettingsRepository", _Repo)
    return pub, published


def _settings(**kw) -> SimpleNamespace:
    base = {
        "community_mqtt_iata": "ams",
        "community_mqtt_publish_filter": True,
        "community_mqtt_filter_interval_ms": 60000,
        "community_mqtt_publish_own_neighbors": True,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def test_format_filter_stats_matches_the_observer_shape():
    rt = _runtime(
        filter_enabled=True,
        filter_paths=["A1B2"],
        filter_sender_rules=[FilterRule(pattern="Bob", secs=60)],
        filter_watch=["#bots"],
        filter_advert_hours=48,
    )
    c = rt.engine.filter_counters
    c.hops["GRP_TXT"] = 3
    c.rate["TXT_MSG"] = 2
    c.hash_size[0] = 5
    c.hash_type["ADVERT"] = 5
    c.sources[0xA3] = 7
    c.air_ms = 1234.5
    since = 1_700_000_000.0
    payload = cm._format_filter_stats(
        device_name="Node",
        public_key_hex="aabb",
        host_repeater_state="shadow",
        since=since,
        filter_snapshot=rt.engine.filter_snapshot(time.time()),
        region_gate=rt.engine.gate_snapshot(time.monotonic()),
        now=since + 90,
    )
    assert payload["origin_id"] == "AABB"
    assert payload["uptime_secs"] == 90
    assert payload["boot_id"] == (int(since) & 0xFFFF) | 1
    assert payload["enabled"] is True
    assert payload["dryrun"] is True  # shadow: nothing is really dropped
    assert payload["host_repeater"] == {"state": "shadow"}
    assert payload["totals"]["hops"] == 3 and payload["totals"]["rate"] == 2
    assert payload["hops"] == {"05": 3} and payload["rate"] == {"02": 2}
    assert payload["hash"] == {"size": {"1B": 5, "2B": 0, "3B": 0}, "top_types": {"04": 5}}
    assert payload["top_sources"] == [{"hash": "a3", "drops": 7}]
    assert payload["air_ms"] == 1234
    assert payload["advert"] == {"window_h": 48, "cache": 0, "cache_size": 256}
    assert payload["paths"] == [{"prefix": "A1B2", "drops": 0}]
    assert payload["senders"] == [
        {"pattern": "Bob", "secs": 60, "prob": 100, "drops": 0, "pass": 0}
    ]
    assert "texts" not in payload and "channels" not in payload
    assert payload["watch"] == ["#bots"]
    assert payload["config"]["05"] == {"limit": 20, "secs": 60, "soft": 0, "hops_max": 32}
    assert set(payload["region_gate"]) == {
        "enabled",
        "duty",
        "level",
        "max_level",
        "threshold",
        "hysteresis",
    }


def test_filter_dryrun_reflects_setting_when_armed():
    rt = _runtime()
    snap = rt.engine.filter_snapshot(time.time())
    gate = rt.engine.gate_snapshot(time.monotonic())
    kwargs = {
        "device_name": "",
        "public_key_hex": "aa",
        "since": 0.0,
        "filter_snapshot": snap,
        "region_gate": gate,
    }
    assert cm._format_filter_stats(host_repeater_state="armed", **kwargs)["dryrun"] is False
    snap["dryrun"] = True
    assert cm._format_filter_stats(host_repeater_state="armed", **kwargs)["dryrun"] is True


@pytest.mark.asyncio
async def test_filter_topic_needs_the_toggle_and_an_active_host_repeater(monkeypatch):
    rt = _runtime("off")
    pub, published = _publisher(monkeypatch, rt)
    assert not await pub._publish_filter(_settings())  # host repeater off
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    assert not await pub._publish_filter(_settings(community_mqtt_publish_filter=False))
    assert await pub._publish_filter(_settings())
    topic, payload, kwargs = published[0]
    assert topic == "meshcore/AMS/AABB/filter"
    assert kwargs.get("retain") is None
    assert payload["host_repeater"]["state"] == "shadow"


@pytest.mark.asyncio
async def test_own_neighbors_published_once_per_completed_poll(monkeypatch):
    rt = _runtime(
        regions=[RegionConfig(name="nl"), RegionConfig(name="be", deny_flood=True)],
    )
    pub, published = _publisher(monkeypatch, rt)
    assert not await pub._publish_own_neighbors(_settings())  # no poll finished yet
    rt.neighbors.put("cc" * 32, 5.5)
    rt.neighbors.entries["cc" * 32].status = "responded"
    rt.neighbors.entries["cc" * 32].scopes = "*,nl"
    rt.neighbors.put("dd" * 32, 1.0)  # never queried
    rt.neighbors.poll.last_finished = time.time()
    rt.neighbors.poll.queried = 1
    rt.neighbors.version = 1
    assert await pub._publish_own_neighbors(_settings())
    assert not await pub._publish_own_neighbors(_settings())  # same poll: once
    topic, payload, _ = published[0]
    assert topic == "meshcore/AMS/AABB/neighbors"
    assert payload["self"] == {"scopes": "*,nl", "default_scope": "nl"}
    assert payload["total_neighbors"] == 2 and payload["queried_neighbors"] == 1
    by_key = {n["pubkey"]: n for n in payload["neighbors"]}
    assert by_key["CC" * 32]["status"] == "responded"
    assert by_key["CC" * 32]["scopes"] == "*,nl"
    assert by_key["DD" * 32]["status"] == "timeout"
    assert "subject_id" not in payload
    assert not await pub._publish_own_neighbors(
        _settings(community_mqtt_publish_own_neighbors=False)
    )


def test_config_carries_filter_interval_neighbors_interval_and_timing():
    hr = HostRepeaterSettings(
        rx_delay_base=5.0, neighbor_poll_enabled=True, neighbor_poll_interval_hours=48
    )
    payload = cm._format_node_config(
        device_name="n",
        public_key_hex="aa",
        self_info={},
        device_info=None,
        stats=None,
        host_repeater_settings=hr,
        host_repeater_state="shadow",
        flood_scope=None,
        fanout_config={"publish_filter": True, "filter_interval_ms": 120000},
    )
    assert isinstance(payload["boot_id"], int) and payload["boot_id"] & 1
    assert payload["radio"]["rx_delay"] == 5.0
    assert payload["radio"]["tx_delay_factor"] == 1.0
    assert payload["radio"]["direct_tx_delay_factor"] == 0.5
    assert payload["mqtt"]["filter_interval"] == 120000
    assert payload["mqtt"]["neighbors_interval"] == 48 * 3_600_000
    off = cm._format_node_config(
        device_name="n",
        public_key_hex="aa",
        self_info={},
        device_info=None,
        stats=None,
        host_repeater_settings=None,
        host_repeater_state=None,
        flood_scope=None,
        fanout_config={},
    )
    assert off["mqtt"]["filter_interval"] == 0
    assert "neighbors_interval" not in off["mqtt"] and "radio" not in off
