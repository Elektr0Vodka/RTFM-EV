"""Unit tests for the DMC observer MQTT payload/topic builders and module."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.fanout import mqtt_dmc_observer as dmc

# A direct-routed (route_type=2 -> "D"), payload_version 0 packet:
# header 0x0A (route 2, ptype 2, pv 0), path_byte 0x02 (2 hops, 1-byte hash),
# path AABB, payload CC. Verified via app.path_utils.parse_packet_envelope.
DIRECT_PACKET_HEX = "0a02aabbcc"


# ── Topic + timestamp ──────────────────────────────────────────────────


def test_build_dmc_topic():
    assert dmc.build_dmc_topic("AMS", "AABBCC", "status") == "meshcore/AMS/AABBCC/status"
    assert dmc.build_dmc_topic("ams", "aabbcc", "packets") == "meshcore/AMS/AABBCC/packets"


def test_dmc_timestamp_uses_plus_offset():
    ts = dmc._dmc_timestamp()
    assert ts.endswith("+00:00")
    assert "Z" not in ts


# ── STATUS stats mapping ───────────────────────────────────────────────


def test_stats_from_health_maps_and_omits():
    health = {
        "battery_mv": 3980,
        "uptime_secs": 123456,
        "packets_sent": 4200,
        "packets_recv": 5300,
        "noise_floor_dbm": -110,
        "tx_air_secs": 340,
        "rx_air_secs": 890,
    }
    stats = dmc._stats_from_health(health, queue_len=0)
    assert stats == {
        "battery_mv": 3980,
        "uptime_secs": 123456,
        "packets_sent": 4200,
        "packets_received": 5300,
        "queue_len": 0,
        "noise_floor": -110,
        "tx_air_secs": 340,
        "rx_air_secs": 890,
    }
    assert "errors" not in stats
    assert "recv_errors" not in stats
    assert "internal_heap" not in stats


def test_stats_from_health_omits_missing_values():
    stats = dmc._stats_from_health({"battery_mv": 3900}, queue_len=0)
    assert stats == {"battery_mv": 3900, "queue_len": 0}


def test_stats_from_health_none():
    assert dmc._stats_from_health(None, queue_len=0) == {"queue_len": 0}


# ── STATUS payload ─────────────────────────────────────────────────────


def test_build_status_payload_shape_and_order():
    payload = dmc.build_status_payload(
        origin="MyRepeater",
        origin_id="a1b2",
        model="Heltec V3",
        firmware_version="v1.7.2",
        radio="868.5,250.0,10,5",
        client_version="RemoteTerm/1.0-abc",
        stats={"battery_mv": 3980, "queue_len": 0},
    )
    assert list(payload.keys()) == [
        "status",
        "timestamp",
        "origin",
        "origin_id",
        "model",
        "firmware_version",
        "radio",
        "client_version",
        "repeat",
        "stats",
    ]
    assert payload["status"] == "online"
    assert payload["origin_id"] == "A1B2"
    assert payload["repeat"] == "off"
    assert payload["timestamp"].endswith("+00:00")


def test_build_status_payload_omits_empty_stats():
    payload = dmc.build_status_payload(
        origin="x",
        origin_id="aa",
        model="m",
        firmware_version="v",
        radio="0,0,0,0",
        client_version="c",
        stats={},
    )
    assert "stats" not in payload


# ── PACKETS payload ────────────────────────────────────────────────────


def test_build_packet_payload_rx_direct():
    data = {"data": DIRECT_PACKET_HEX, "snr": 7.5, "rssi": -95}
    pkt = dmc.build_packet_payload(data, "MyRepeater", "a1b2")
    assert pkt is not None
    assert list(pkt.keys()) == [
        "timestamp",
        "hash",
        "origin",
        "type",
        "direction",
        "time",
        "date",
        "len",
        "packet_type",
        "route",
        "payload_len",
        "raw",
        "origin_id",
        "SNR",
        "RSSI",
        "path",
    ]
    assert pkt["type"] == "PACKET"
    assert pkt["direction"] == "rx"
    assert pkt["route"] == "D"
    assert pkt["SNR"] == "7.5"
    assert pkt["RSSI"] == "-95"
    assert pkt["path"] == ["aa", "bb"]
    assert pkt["origin_id"] == "A1B2"
    assert pkt["raw"] == DIRECT_PACKET_HEX.upper()
    assert "score" not in pkt


def test_build_packet_payload_omits_snr_rssi_when_missing():
    pkt = dmc.build_packet_payload({"data": DIRECT_PACKET_HEX}, "x", "aa")
    assert pkt is not None
    assert "SNR" not in pkt
    assert "RSSI" not in pkt


def test_build_packet_payload_drops_unmapped_route():
    assert dmc.build_packet_payload({"data": ""}, "x", "aa") is None


# ── RAW payload ────────────────────────────────────────────────────────


def test_build_raw_payload():
    raw = dmc.build_raw_payload({"data": "42aabb"}, "MyRepeater", "a1b2")
    assert list(raw.keys()) == ["origin", "origin_id", "timestamp", "type", "data"]
    assert raw["type"] == "RAW"
    assert raw["data"] == "42AABB"
    assert raw["origin_id"] == "A1B2"
    assert raw["timestamp"].endswith("+00:00")


def test_build_raw_payload_empty_returns_none():
    assert dmc.build_raw_payload({"data": ""}, "x", "aa") is None


# ── DmcObserverPublisher ───────────────────────────────────────────────


def test_publisher_client_kwargs_has_no_will(monkeypatch):
    pub = dmc.DmcObserverPublisher()

    def fake_super_kwargs(self, settings):  # noqa: ANN001, ARG001
        return {"hostname": "h", "port": 1, "will": "SHOULD_BE_REMOVED"}

    monkeypatch.setattr(dmc.CommunityMqttPublisher, "_build_client_kwargs", fake_super_kwargs)
    kwargs = pub._build_client_kwargs(SimpleNamespace())
    assert "will" not in kwargs


def test_publisher_status_interval_reads_and_clamps():
    pub = dmc.DmcObserverPublisher()
    pub._settings = SimpleNamespace(dmc_status_interval_ms=90000)
    assert pub._status_interval_secs() == 90.0
    pub._settings = SimpleNamespace(dmc_status_interval_ms=50)  # below min
    assert pub._status_interval_secs() == 300.0


def test_publisher_publish_status_gated_off(monkeypatch):
    pub = dmc.DmcObserverPublisher()
    pub._settings = SimpleNamespace(dmc_publish_status=False)
    published: list = []
    monkeypatch.setattr(pub, "publish", lambda *a, **k: published.append(a))
    asyncio.run(pub._publish_status(pub._settings))
    assert published == []


# ── Config mapping + DmcObserverModule ─────────────────────────────────


def test_config_to_dmc_settings_defaults():
    s = dmc._config_to_dmc_settings({})
    assert s.dmc_publish_status is True
    assert s.dmc_publish_packets is True
    assert s.dmc_publish_raw is False
    assert s.dmc_status_interval_ms == 300000
    assert s.community_mqtt_enabled is True


def test_config_to_dmc_settings_clamps_interval():
    assert dmc._config_to_dmc_settings({"status_interval_ms": 99}).dmc_status_interval_ms == 300000
    assert (
        dmc._config_to_dmc_settings({"status_interval_ms": 120000}).dmc_status_interval_ms == 120000
    )


def test_module_on_health_caches_snapshot():
    mod = dmc.DmcObserverModule("id1", {}, name="dmc")
    snap = {"battery_mv": 3900}
    asyncio.run(mod.on_health(snap))
    assert mod._publisher.latest_health == snap


def test_module_on_raw_publishes_raw_when_enabled(monkeypatch):
    mod = dmc.DmcObserverModule(
        "id1", {"iata": "AMS", "publish_packets": True, "publish_raw": True}, name="dmc"
    )
    published: list[str] = []

    async def fake_publish(topic, payload, **k):  # noqa: ANN001
        published.append(topic)

    mod._publisher.connected = True
    monkeypatch.setattr(mod._publisher, "publish", fake_publish)
    monkeypatch.setattr(dmc, "_get_pubkey_hex", lambda: "A1B2")
    monkeypatch.setattr(dmc, "_get_device_name", lambda: "Node")

    # DIRECT_PACKET_HEX decodes to route "D" -> both packets and raw publish.
    asyncio.run(mod.on_raw({"data": DIRECT_PACKET_HEX, "snr": 7.0, "rssi": -90}))
    assert "meshcore/AMS/A1B2/packets" in published
    assert "meshcore/AMS/A1B2/raw" in published


def test_module_on_raw_raw_off(monkeypatch):
    mod = dmc.DmcObserverModule("id1", {"iata": "AMS", "publish_raw": False}, name="dmc")
    published: list[str] = []

    async def fake_publish(topic, payload, **k):  # noqa: ANN001
        published.append(topic)

    mod._publisher.connected = True
    monkeypatch.setattr(mod._publisher, "publish", fake_publish)
    monkeypatch.setattr(dmc, "_get_pubkey_hex", lambda: "A1B2")
    monkeypatch.setattr(dmc, "_get_device_name", lambda: "Node")
    asyncio.run(mod.on_raw({"data": DIRECT_PACKET_HEX}))
    assert "meshcore/AMS/A1B2/raw" not in published
    assert "meshcore/AMS/A1B2/packets" in published


def test_module_on_raw_skips_when_disconnected(monkeypatch):
    mod = dmc.DmcObserverModule("id1", {"iata": "AMS"}, name="dmc")
    published: list[str] = []
    mod._publisher.connected = False
    monkeypatch.setattr(
        mod._publisher, "publish", lambda *a, **k: published.append("x")  # noqa: ARG005
    )
    asyncio.run(mod.on_raw({"data": DIRECT_PACKET_HEX}))
    assert published == []


# ── Router validation + registration ───────────────────────────────────


def test_validator_requires_iata():
    import pytest
    from fastapi import HTTPException

    from app.routers import fanout as fanout_router

    with pytest.raises(HTTPException):
        fanout_router._validate_dmc_observer_config({"broker_host": "h"})


def test_validator_requires_broker_host():
    import pytest
    from fastapi import HTTPException

    from app.routers import fanout as fanout_router

    with pytest.raises(HTTPException):
        fanout_router._validate_dmc_observer_config({"iata": "AMS"})


def test_validator_clamps_interval_and_normalizes():
    from app.routers import fanout as fanout_router

    cfg = {"iata": "ams", "broker_host": "h", "status_interval_ms": 50}
    fanout_router._validate_dmc_observer_config(cfg)
    assert cfg["iata"] == "AMS"
    assert cfg["status_interval_ms"] == 300000
    assert cfg["publish_status"] is True
    assert cfg["publish_raw"] is False


def test_enforce_scope_dmc_observer():
    from app.routers import fanout as fanout_router

    assert fanout_router._enforce_scope("mqtt_dmc_observer", {}) == {
        "messages": "none",
        "raw_packets": "all",
    }


def test_manager_registers_dmc_observer_type():
    from app.fanout import manager

    manager._register_module_types()
    assert manager._MODULE_TYPES.get("mqtt_dmc_observer") is dmc.DmcObserverModule
