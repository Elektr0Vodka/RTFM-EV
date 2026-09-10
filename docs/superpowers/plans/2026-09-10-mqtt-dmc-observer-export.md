# DMC Observer MQTT Export (X1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `mqtt_dmc_observer` fanout module that mirrors the DMC observer firmware's `status`/`packets`/`raw` MQTT topics and payload schemas for a companion radio, with per-topic toggles and a configurable status interval.

**Architecture:** A new fanout type reusing the existing shared MQTT connection loop (`BaseMqttPublisher`) and the community publisher's JWT/stats/device-info machinery (via subclassing `CommunityMqttPublisher`, without modifying it). Pure payload builders (unit-tested) are separated from the thin publisher/module that gather live radio data and call `publish()`. Status is interval + connect driven; packets/raw are event-driven from `on_raw`. No DB migration (the `fanout_configs` table stores `type` + JSON `config` + JSON `scope`).

**Tech Stack:** Python 3 / FastAPI / aiomqtt (backend), pytest (backend tests), React + TypeScript (frontend), vitest (frontend tests). Firmware reference schemas: `docs/superpowers/specs/2026-09-10-mqtt-dmc-observer-export-design.md`.

**Branch:** `feat/mqtt-dmc-observer-export` (already created off `origin/main`).

**Run tests from these directories:**
- Backend: repo root, `python -m pytest ...`
- Frontend: `frontend/`, `npx vitest run ...`, `npx eslint ...`, `npx tsc -p tsconfig.json --noEmit`

---

## Design decisions locked in (from the approved spec)

- **STATUS `stats`**: omit fields with no host source (`errors`, `recv_errors`, `internal_heap`); map `queue_len` to our own outbound publish-queue depth (we await each publish, so depth is `0`); `repeat` is `"off"` (companion is an endpoint, not a forwarding repeater).
- **PACKETS `route`**: keep the richer wire route `F`/`D`/`T` via `{0:"F",1:"F",2:"D",3:"T"}`; drop (do not publish) packets whose route is unmapped (`"U"`). This intentionally diverges from firmware runtime output (which only ever emits `F`/`D`).
- **LWT**: none (faithful mirror; firmware has none).
- **Timestamps**: ISO-8601 UTC ending `+00:00` (Python `datetime.now(UTC).isoformat()` already yields this — do NOT replace with `Z`).
- **Topic**: `meshcore/{IATA}/{DEVICE}/{status|packets|raw}`, `DEVICE` = 64-char uppercase pubkey hex.
- **Retain**: `status` retained (QoS default), `packets`/`raw` never retained.
- **Defaults**: `publish_status=true`, `publish_packets=true`, `publish_raw=false`, `status_interval_ms=300000` clamped to `[1000, 3600000]`.

## File structure

- `app/fanout/mqtt_dmc_observer.py` — NEW. Pure payload/topic builders + `DmcObserverPublisher(CommunityMqttPublisher)` + `DmcObserverModule(FanoutModule)` + `_config_to_dmc_settings()`.
- `app/fanout/manager.py` — MODIFY. Register the new type.
- `app/routers/fanout.py` — MODIFY. `_VALID_TYPES`, validator, scope enforcement.
- `app/fanout/AGENTS_fanout.md` — MODIFY. Document the new type.
- `tests/test_mqtt_dmc_observer.py` — NEW. Unit tests for builders + publisher + module + validator.
- `tests/test_fanout_integration.py` — MODIFY. End-to-end dispatch test.
- `frontend/src/components/settings/SettingsFanoutSection.tsx` — MODIFY. `DraftType`, create-definition, editor, save-normalization.
- `frontend/src/i18n/locales/{en,nl,de}.json` — MODIFY. New keys.
- `frontend/src/test/fanoutSection.test.tsx` — MODIFY. Editor test.

---

## Task 1: Pure payload + topic builders

**Files:**
- Create: `app/fanout/mqtt_dmc_observer.py`
- Test: `tests/test_mqtt_dmc_observer.py`

These are pure functions with no I/O so the wire schema can be tested exactly.

- [ ] **Step 1: Write failing tests for the builders**

Create `tests/test_mqtt_dmc_observer.py`:

```python
"""Unit tests for the DMC observer MQTT payload/topic builders."""

from __future__ import annotations

from app.fanout import mqtt_dmc_observer as dmc


def test_build_dmc_topic():
    assert (
        dmc.build_dmc_topic("AMS", "AABBCC", "status") == "meshcore/AMS/AABBCC/status"
    )
    assert dmc.build_dmc_topic("ams", "aabbcc", "packets") == "meshcore/AMS/AABBCC/packets"


def test_dmc_timestamp_uses_plus_offset():
    ts = dmc._dmc_timestamp()
    assert ts.endswith("+00:00")
    assert "Z" not in ts


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
    # errors / recv_errors / internal_heap are never present
    assert "errors" not in stats
    assert "recv_errors" not in stats
    assert "internal_heap" not in stats


def test_stats_from_health_omits_missing_values():
    stats = dmc._stats_from_health({"battery_mv": 3900}, queue_len=0)
    assert stats == {"battery_mv": 3900, "queue_len": 0}


def test_stats_from_health_none():
    assert dmc._stats_from_health(None, queue_len=0) == {"queue_len": 0}


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
    assert payload["origin_id"] == "A1B2"  # uppercased
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


def _advert_direct_hex() -> str:
    # A minimal direct-routed payload_version 0 packet is hard to hand-craft;
    # these packet tests exercise the decode path via the shared helpers, so
    # use a byte string that parse_packet_envelope decodes as direct (route D).
    # See tests/test_path_utils.py for envelope fixtures to copy an exact hex.
    from tests.helpers.packet_fixtures import DIRECT_PACKET_HEX  # noqa: PLC0415

    return DIRECT_PACKET_HEX


def test_build_packet_payload_rx_direct():
    data = {"data": _advert_direct_hex(), "snr": 7.5, "rssi": -95}
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
    assert pkt["SNR"] == "7.5"          # string, one decimal
    assert pkt["RSSI"] == "-95"         # string, integer
    assert isinstance(pkt["path"], list)  # array, not comma-joined
    assert pkt["origin_id"] == "A1B2"
    assert pkt["raw"] == data["data"].upper()
    assert "score" not in pkt           # host has no rebroadcast score


def test_build_packet_payload_omits_snr_rssi_when_missing():
    data = {"data": _advert_direct_hex()}
    pkt = dmc.build_packet_payload(data, "x", "aa")
    assert pkt is not None
    assert "SNR" not in pkt
    assert "RSSI" not in pkt


def test_build_packet_payload_drops_unmapped_route():
    # Empty/garbage bytes decode to route "U" -> dropped.
    assert dmc.build_packet_payload({"data": ""}, "x", "aa") is None


def test_build_raw_payload():
    data = {"data": "42aabb"}
    raw = dmc.build_raw_payload(data, "MyRepeater", "a1b2")
    assert list(raw.keys()) == ["origin", "origin_id", "timestamp", "type", "data"]
    assert raw["type"] == "RAW"
    assert raw["data"] == "42AABB"
    assert raw["origin_id"] == "A1B2"
    assert raw["timestamp"].endswith("+00:00")


def test_build_raw_payload_empty_returns_none():
    assert dmc.build_raw_payload({"data": ""}, "x", "aa") is None
```

Note on `packet_fixtures`: if `tests/helpers/packet_fixtures.py` with `DIRECT_PACKET_HEX` does not exist, create it in this step by copying a known direct-routed packet hex from an existing decode test. Find one with:
`grep -rniE "route.*D|isRouteDirect|direct" tests/test_path_utils.py tests/*.py | grep -i hex` and reuse a hex literal that `app.path_utils.parse_packet_envelope` decodes with `route_type == 2`. If no reusable fixture exists, construct the minimal bytes: first byte with `route_type` bits `= 2` (`byte0 & 0b11 == 2`) and `payload_version 0`, followed by a valid path + payload per `app/path_utils.py::parse_packet_envelope`. Keep the fixture in one place so both this task and Task 5 reuse it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -x -q`
Expected: FAIL (`ModuleNotFoundError: app.fanout.mqtt_dmc_observer` or `AttributeError`).

- [ ] **Step 3: Implement the builders**

Create `app/fanout/mqtt_dmc_observer.py`:

```python
"""DMC observer MQTT export fanout module.

Mirrors the Dutch-MeshCore observer firmware's MQTT bridge (status/packets/raw
topics) for a companion radio, which has no MQTT of its own. Reuses the
community MQTT connection/JWT/stats machinery via subclassing without modifying
it. See docs/superpowers/specs/2026-09-10-mqtt-dmc-observer-export-design.md.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from app.fanout.base import FanoutModule
from app.fanout.community_mqtt import (
    CommunityMqttPublisher,
    _build_radio_info,
    _decode_packet_fields,
    _get_client_version,
)
from app.path_utils import calculate_packet_hash

logger = logging.getLogger(__name__)

_IATA_RE = re.compile(r"^[A-Z]{3}$")

_STATUS_INTERVAL_DEFAULT_MS = 300000
_STATUS_INTERVAL_MIN_MS = 1000
_STATUS_INTERVAL_MAX_MS = 3600000

# on_health field -> DMC stats field. Fields with no host source
# (errors, recv_errors, internal_heap) are intentionally absent.
_HEALTH_TO_STATS = {
    "battery_mv": "battery_mv",
    "uptime_secs": "uptime_secs",
    "packets_sent": "packets_sent",
    "packets_recv": "packets_received",
    "noise_floor_dbm": "noise_floor",
    "tx_air_secs": "tx_air_secs",
    "rx_air_secs": "rx_air_secs",
}
# Firmware stats field order (queue_len inserted after packets_received).
_STATS_ORDER = [
    "battery_mv",
    "uptime_secs",
    "packets_sent",
    "packets_received",
    "queue_len",
    "noise_floor",
    "tx_air_secs",
    "rx_air_secs",
]


def clamp_status_interval_ms(value: Any) -> int:
    """Clamp a status interval to [1000, 3600000] ms, else the 300000 default."""
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return _STATUS_INTERVAL_DEFAULT_MS
    if _STATUS_INTERVAL_MIN_MS <= ms <= _STATUS_INTERVAL_MAX_MS:
        return ms
    return _STATUS_INTERVAL_DEFAULT_MS


def _dmc_timestamp(dt: datetime | None = None) -> str:
    """ISO-8601 UTC ending in +00:00 (matches firmware; never 'Z')."""
    current = dt.astimezone(UTC) if dt is not None else datetime.now(UTC)
    return current.isoformat()


def build_dmc_topic(iata: str, device_hex: str, type_name: str) -> str:
    """Build meshcore/{IATA}/{DEVICE}/{type}."""
    return f"meshcore/{iata.upper()}/{device_hex.upper()}/{type_name}"


def _stats_from_health(health: dict[str, Any] | None, *, queue_len: int) -> dict[str, Any]:
    """Map an on_health snapshot to the firmware stats schema, omitting unknowns."""
    mapped: dict[str, Any] = {}
    if health:
        for src, dest in _HEALTH_TO_STATS.items():
            value = health.get(src)
            if value is not None:
                mapped[dest] = value
    mapped["queue_len"] = queue_len
    return {k: mapped[k] for k in _STATS_ORDER if k in mapped}


def build_status_payload(
    *,
    origin: str,
    origin_id: str,
    model: str,
    firmware_version: str,
    radio: str,
    client_version: str,
    stats: dict[str, Any],
    dt: datetime | None = None,
) -> dict[str, Any]:
    """Build the STATUS payload in firmware field order."""
    payload: dict[str, Any] = {
        "status": "online",
        "timestamp": _dmc_timestamp(dt),
        "origin": origin or "MeshCore Device",
        "origin_id": origin_id.upper(),
        "model": model or "unknown",
        "firmware_version": firmware_version or "unknown",
        "radio": radio,
        "client_version": client_version,
        "repeat": "off",
    }
    if stats:
        payload["stats"] = stats
    return payload


def build_packet_payload(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict[str, Any] | None:
    """Build the PACKETS payload, or None if the packet cannot be decoded/routed."""
    raw_hex = data.get("data", "")
    raw_bytes = bytes.fromhex(raw_hex) if raw_hex else b""

    route, packet_type, payload_len, path_values, _pt = _decode_packet_fields(raw_bytes)
    if route == "U":
        return None

    now = datetime.now(UTC)
    packet_hash = calculate_packet_hash(raw_bytes)

    payload: dict[str, Any] = {
        "timestamp": _dmc_timestamp(now),
        "hash": str(packet_hash).upper(),
        "origin": device_name or "MeshCore Device",
        "type": "PACKET",
        "direction": "rx",
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%d/%m/%Y"),
        "len": str(len(raw_bytes)),
        "packet_type": packet_type,
        "route": route,
        "payload_len": payload_len,
        "raw": raw_hex.upper(),
        "origin_id": public_key_hex.upper(),
    }

    snr_val = data.get("snr")
    if snr_val is not None:
        payload["SNR"] = f"{float(snr_val):.1f}"
    rssi_val = data.get("rssi")
    if rssi_val is not None:
        payload["RSSI"] = f"{int(rssi_val):d}"

    # score: host has no firmware rebroadcast score -> omitted (as firmware omits on NaN).

    if route == "D" and path_values:
        payload["path"] = list(path_values)

    return payload


def build_raw_payload(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict[str, Any] | None:
    """Build the minimal RAW payload, or None when there is no raw hex."""
    raw_hex = data.get("data", "")
    if not raw_hex:
        return None
    return {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": _dmc_timestamp(),
        "type": "RAW",
        "data": raw_hex.upper(),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -x -q`
Expected: PASS (all builder tests).

- [ ] **Step 5: Commit**

```bash
git add app/fanout/mqtt_dmc_observer.py tests/test_mqtt_dmc_observer.py tests/helpers/packet_fixtures.py
git commit -m "feat(mqtt): DMC observer payload/topic builders"
```

---

## Task 2: DmcObserverPublisher (connection + status publishing)

**Files:**
- Modify: `app/fanout/mqtt_dmc_observer.py`
- Test: `tests/test_mqtt_dmc_observer.py`

Subclass `CommunityMqttPublisher` to reuse the connection loop, JWT auth, and device-info/self-info gathering. Override only: no LWT, config-driven status interval, and the DMC status payload built from the cached `on_health` snapshot.

- [ ] **Step 1: Write failing tests**

Append to `tests/test_mqtt_dmc_observer.py`:

```python
import asyncio
from types import SimpleNamespace


def test_publisher_client_kwargs_has_no_will(monkeypatch):
    pub = dmc.DmcObserverPublisher()

    def fake_super_kwargs(self, settings):  # noqa: ANN001
        return {"hostname": "h", "port": 1, "will": "SHOULD_BE_REMOVED"}

    monkeypatch.setattr(
        dmc.CommunityMqttPublisher, "_build_client_kwargs", fake_super_kwargs
    )
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
    # Should early-return without touching keystore/radio.
    asyncio.run(pub._publish_status(pub._settings))
    assert published == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -k publisher -x -q`
Expected: FAIL (`AttributeError: DmcObserverPublisher`).

- [ ] **Step 3: Implement the publisher**

Append to `app/fanout/mqtt_dmc_observer.py`:

```python
import time  # add to the imports at top of file


class DmcObserverPublisher(CommunityMqttPublisher):
    """Community MQTT connection, re-shaped to the DMC observer wire schema.

    Reuses CommunityMqttPublisher's connection loop, JWT auth, and device-info
    gathering. Overrides status publishing (DMC schema, config interval, no LWT).
    """

    _log_prefix = "DMC Observer MQTT"

    def __init__(self) -> None:
        super().__init__()
        self.latest_health: dict[str, Any] | None = None

    def _status_interval_secs(self) -> float:
        s = self._settings
        raw = getattr(s, "dmc_status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS) if s else _STATUS_INTERVAL_DEFAULT_MS
        return clamp_status_interval_ms(raw) / 1000.0

    def _build_client_kwargs(self, settings: object) -> dict[str, Any]:
        # Reuse community broker/auth/TLS/JWT construction, then drop the LWT
        # (the firmware publishes no will message; decision C).
        kwargs = super()._build_client_kwargs(settings)
        kwargs.pop("will", None)
        return kwargs

    def _on_connected(self, settings: object) -> tuple[str, str]:
        host = getattr(settings, "community_mqtt_broker_host", "") or "broker"
        port = getattr(settings, "community_mqtt_broker_port", "")
        return ("DMC Observer MQTT connected", f"{host}:{port}")

    def _on_error(self) -> tuple[str, str]:
        return (
            "DMC Observer MQTT connection failure",
            "Check your internet connection or try again later.",
        )

    async def _publish_status(self, settings: object, *, refresh_stats: bool = True) -> None:
        """Publish the DMC-schema STATUS payload (retained), if enabled."""
        if not getattr(settings, "dmc_publish_status", True):
            return

        from app.keystore import get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        public_key = get_public_key()
        if public_key is None:
            return
        pubkey_hex = public_key.hex().upper()

        iata = getattr(settings, "community_mqtt_iata", "").upper().strip()
        if not _IATA_RE.fullmatch(iata):
            return

        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            device_name = radio_manager.meshcore.self_info.get("name", "")

        if radio_manager.device_info_loaded:
            raw_ver = radio_manager.firmware_version or "unknown"
            fw_build = radio_manager.firmware_build or ""
            fw_str = f"{raw_ver} (Build: {fw_build})" if fw_build else f"{raw_ver}"
            model = radio_manager.device_model or "unknown"
        else:
            info = await self._fetch_device_info()
            model = info.get("model", "unknown")
            fw_str = info.get("firmware_version", "unknown")

        stats = _stats_from_health(self.latest_health, queue_len=0)

        payload = build_status_payload(
            origin=device_name,
            origin_id=pubkey_hex,
            model=model,
            firmware_version=fw_str,
            radio=_build_radio_info(),
            client_version=_get_client_version(),
            stats=stats,
        )
        topic = build_dmc_topic(iata, pubkey_hex, "status")
        await self.publish(topic, payload, retain=True)
        self._last_status_publish = time.monotonic()

    async def _on_connected_async(self, settings: object) -> None:
        await self._publish_status(settings)

    async def _on_periodic_wake(self, elapsed: float) -> None:
        if not self._settings:
            return
        now = time.monotonic()
        if (now - self._last_status_publish) >= self._status_interval_secs():
            await self._publish_status(self._settings, refresh_stats=True)
```

Note: `_fetch_device_info`, `_fetch_stats`, `_pre_connect`, `_is_configured`, `_should_break_wait`, `_on_not_configured`, and `publish` are inherited unchanged from `CommunityMqttPublisher`. `_last_status_publish` is initialized by the parent `__init__`.

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -k publisher -x -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/fanout/mqtt_dmc_observer.py tests/test_mqtt_dmc_observer.py
git commit -m "feat(mqtt): DMC observer publisher (status schema, interval, no LWT)"
```

---

## Task 3: DmcObserverModule + config mapping

**Files:**
- Modify: `app/fanout/mqtt_dmc_observer.py`
- Test: `tests/test_mqtt_dmc_observer.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_mqtt_dmc_observer.py`:

```python
def test_config_to_dmc_settings_defaults():
    s = dmc._config_to_dmc_settings({})
    assert s.dmc_publish_status is True
    assert s.dmc_publish_packets is True
    assert s.dmc_publish_raw is False
    assert s.dmc_status_interval_ms == 300000
    assert s.community_mqtt_enabled is True


def test_config_to_dmc_settings_clamps_interval():
    s = dmc._config_to_dmc_settings({"status_interval_ms": 99})  # below min
    assert s.dmc_status_interval_ms == 300000
    s = dmc._config_to_dmc_settings({"status_interval_ms": 120000})
    assert s.dmc_status_interval_ms == 120000


def test_module_on_health_caches_snapshot():
    mod = dmc.DmcObserverModule("id1", {}, name="dmc")
    snap = {"battery_mv": 3900}
    asyncio.run(mod.on_health(snap))
    assert mod._publisher.latest_health == snap


def test_module_on_raw_gates_topics(monkeypatch):
    mod = dmc.DmcObserverModule(
        "id1",
        {"iata": "AMS", "publish_packets": True, "publish_raw": True},
        name="dmc",
    )
    published: list[tuple[str, dict]] = []

    async def fake_publish(topic, payload, **k):  # noqa: ANN001
        published.append((topic, payload))

    mod._publisher.connected = True
    monkeypatch.setattr(mod._publisher, "publish", fake_publish)
    monkeypatch.setattr(dmc, "_get_pubkey_hex", lambda: "A1B2")
    monkeypatch.setattr(dmc, "_get_device_name", lambda: "Node")

    asyncio.run(mod.on_raw({"data": "42aabb", "snr": 7.0, "rssi": -90}))
    topics = [t for t, _ in published]
    assert any(t == "meshcore/AMS/A1B2/raw" for t in topics)
    # packets topic only if the packet decodes to a mapped route; "42aabb" may
    # decode to route U (dropped). Assert raw always present when publish_raw on.
    assert "meshcore/AMS/A1B2/raw" in topics


def test_module_on_raw_raw_off(monkeypatch):
    mod = dmc.DmcObserverModule(
        "id1", {"iata": "AMS", "publish_raw": False}, name="dmc"
    )
    published: list[str] = []

    async def fake_publish(topic, payload, **k):  # noqa: ANN001
        published.append(topic)

    mod._publisher.connected = True
    monkeypatch.setattr(mod._publisher, "publish", fake_publish)
    monkeypatch.setattr(dmc, "_get_pubkey_hex", lambda: "A1B2")
    monkeypatch.setattr(dmc, "_get_device_name", lambda: "Node")
    asyncio.run(mod.on_raw({"data": "42aabb"}))
    assert "meshcore/AMS/A1B2/raw" not in published
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -k "config_to or module" -x -q`
Expected: FAIL (`AttributeError`).

- [ ] **Step 3: Implement the config mapping + module**

Append to `app/fanout/mqtt_dmc_observer.py`:

```python
def _config_to_dmc_settings(config: dict) -> SimpleNamespace:
    """Map a fanout config blob to the settings namespace the publisher reads."""
    return SimpleNamespace(
        # Connection knobs reused by the inherited community connection code.
        community_mqtt_enabled=True,
        community_mqtt_broker_host=config.get("broker_host", ""),
        community_mqtt_broker_port=config.get("broker_port", 443),
        community_mqtt_transport=config.get("transport", "websockets"),
        community_mqtt_use_tls=config.get("use_tls", True),
        community_mqtt_tls_verify=config.get("tls_verify", True),
        community_mqtt_auth_mode=config.get("auth_mode", "token"),
        community_mqtt_username=config.get("username", ""),
        community_mqtt_password=config.get("password", ""),
        community_mqtt_iata=config.get("iata", ""),
        community_mqtt_email=config.get("email", ""),
        community_mqtt_token_audience=config.get("token_audience", ""),
        community_mqtt_websocket_path=config.get("websocket_path", "/"),
        # DMC knobs.
        dmc_publish_status=bool(config.get("publish_status", True)),
        dmc_publish_packets=bool(config.get("publish_packets", True)),
        dmc_publish_raw=bool(config.get("publish_raw", False)),
        dmc_status_interval_ms=clamp_status_interval_ms(
            config.get("status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS)
        ),
    )


def _get_pubkey_hex() -> str | None:
    from app.keystore import get_public_key

    key = get_public_key()
    return key.hex().upper() if key is not None else None


def _get_device_name() -> str:
    from app.services.radio_runtime import radio_runtime as radio_manager

    if radio_manager.meshcore and radio_manager.meshcore.self_info:
        return radio_manager.meshcore.self_info.get("name", "")
    return ""


class DmcObserverModule(FanoutModule):
    """Fanout module that mirrors the DMC observer firmware MQTT bridge."""

    def __init__(self, config_id: str, config: dict, *, name: str = "") -> None:
        super().__init__(config_id, config, name=name)
        self._publisher = DmcObserverPublisher()
        self._publisher.set_integration_name(name or config_id)

    async def start(self) -> None:
        await self._publisher.start(_config_to_dmc_settings(self.config))

    async def stop(self) -> None:
        await self._publisher.stop()

    async def on_message(self, data: dict) -> None:
        # DMC observer export publishes packets/raw/status, not decoded messages.
        pass

    async def on_health(self, data: dict) -> None:
        self._publisher.latest_health = data

    async def on_raw(self, data: dict) -> None:
        if not self._publisher.connected:
            return
        pubkey_hex = _get_pubkey_hex()
        if pubkey_hex is None:
            return
        iata = str(self.config.get("iata", "")).upper().strip()
        if not _IATA_RE.fullmatch(iata):
            return
        device_name = _get_device_name()

        try:
            if bool(self.config.get("publish_packets", True)):
                pkt = build_packet_payload(data, device_name, pubkey_hex)
                if pkt is not None:
                    await self._publisher.publish(
                        build_dmc_topic(iata, pubkey_hex, "packets"), pkt
                    )
            if bool(self.config.get("publish_raw", False)):
                raw = build_raw_payload(data, device_name, pubkey_hex)
                if raw is not None:
                    await self._publisher.publish(
                        build_dmc_topic(iata, pubkey_hex, "raw"), raw
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning("DMC Observer MQTT broadcast error: %s", e, exc_info=True)

    @property
    def status(self) -> str:
        if self.last_error:
            return "error"
        if self._publisher._is_configured():
            return "connected" if self._publisher.connected else "disconnected"
        return "disconnected"

    @property
    def last_error(self) -> str | None:
        return self._publisher.last_error
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -x -q`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add app/fanout/mqtt_dmc_observer.py tests/test_mqtt_dmc_observer.py
git commit -m "feat(mqtt): DMC observer fanout module (raw/packets topics + toggles)"
```

---

## Task 4: Register the module + router validation

**Files:**
- Modify: `app/fanout/manager.py`
- Modify: `app/routers/fanout.py`
- Test: `tests/test_mqtt_dmc_observer.py`

- [ ] **Step 1: Write failing validator tests**

Append to `tests/test_mqtt_dmc_observer.py`:

```python
import pytest
from fastapi import HTTPException

from app.routers import fanout as fanout_router


def test_validator_requires_iata():
    with pytest.raises(HTTPException):
        fanout_router._validate_dmc_observer_config({"broker_host": "h"})


def test_validator_requires_broker_host():
    with pytest.raises(HTTPException):
        fanout_router._validate_dmc_observer_config({"iata": "AMS"})


def test_validator_clamps_interval_and_normalizes():
    cfg = {"iata": "ams", "broker_host": "h", "status_interval_ms": 50}
    fanout_router._validate_dmc_observer_config(cfg)
    assert cfg["iata"] == "AMS"
    assert cfg["status_interval_ms"] == 300000
    assert cfg["publish_status"] is True
    assert cfg["publish_raw"] is False


def test_enforce_scope_dmc_observer():
    assert fanout_router._enforce_scope("mqtt_dmc_observer", {}) == {
        "messages": "none",
        "raw_packets": "all",
    }


def test_manager_knows_dmc_observer_type():
    from app.fanout.manager import FanoutManager

    assert "mqtt_dmc_observer" in FanoutManager()._module_types_for_test()
```

If `FanoutManager` has no `_module_types_for_test` helper, instead assert against the registry the manager actually uses. Inspect with:
`grep -nE "_MODULE_TYPES|_register_module_types|_module_types" app/fanout/manager.py`
and adapt the assertion to read that registry (e.g. `manager._MODULE_TYPES` or a module-level dict). Do not add a test-only method to production code if a direct reference works.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -k "validator or enforce or manager" -x -q`
Expected: FAIL.

- [ ] **Step 3a: Register in the manager**

Read the registration site: `grep -nE "_register_module_types|_MODULE_TYPES|import" app/fanout/manager.py`.
Add, alongside the other module imports and registrations (mirror the existing `mqtt_community` lines exactly):

```python
from app.fanout.mqtt_dmc_observer import DmcObserverModule
```
and in `_register_module_types()` (or wherever the dict is built):
```python
_MODULE_TYPES["mqtt_dmc_observer"] = DmcObserverModule
```

- [ ] **Step 3b: Router — valid type, validator, scope**

In `app/routers/fanout.py`:

Add to `_VALID_TYPES` (line ~19-28):
```python
    "mqtt_dmc_observer",
```

Add a branch in `_validate_and_normalize_config` (after the `mqtt_community` branch, ~line 97):
```python
    elif config_type == "mqtt_dmc_observer":
        _validate_dmc_observer_config(normalized)
```

Add the validator (place it after `_validate_mqtt_community_config`, ~line 180):
```python
def _validate_dmc_observer_config(config: dict) -> None:
    """Validate mqtt_dmc_observer config blob. Normalizes IATA + interval + toggles."""
    broker_host = str(config.get("broker_host", "")).strip()
    if not broker_host:
        raise HTTPException(status_code=400, detail="broker_host is required for mqtt_dmc_observer")
    config["broker_host"] = broker_host

    port = config.get("broker_port", 443)
    if not isinstance(port, int) or port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="broker_port must be between 1 and 65535")
    config["broker_port"] = port

    transport = str(config.get("transport", "websockets")).strip().lower()
    if transport not in _ALLOWED_COMMUNITY_MQTT_TRANSPORTS:
        raise HTTPException(status_code=400, detail="transport must be 'websockets' or 'tcp'")
    config["transport"] = transport
    config["use_tls"] = bool(config.get("use_tls", True))
    config["tls_verify"] = bool(config.get("tls_verify", True))

    auth_mode = str(config.get("auth_mode", "token")).strip().lower()
    if auth_mode not in _ALLOWED_COMMUNITY_MQTT_AUTH_MODES:
        raise HTTPException(status_code=400, detail="auth_mode must be 'token', 'password', or 'none'")
    config["auth_mode"] = auth_mode
    username = str(config.get("username", "")).strip()
    password = str(config.get("password", "")).strip()
    if auth_mode == "password" and (not username or not password):
        raise HTTPException(
            status_code=400,
            detail="username and password are required when auth_mode is 'password'",
        )
    config["username"] = username
    config["password"] = password
    config["token_audience"] = str(config.get("token_audience", "")).strip()

    iata = config.get("iata", "").upper().strip()
    if not iata or not _IATA_RE.fullmatch(iata):
        raise HTTPException(
            status_code=400,
            detail="IATA code is required and must be exactly 3 uppercase alphabetic characters",
        )
    config["iata"] = iata

    config["publish_status"] = bool(config.get("publish_status", True))
    config["publish_packets"] = bool(config.get("publish_packets", True))
    config["publish_raw"] = bool(config.get("publish_raw", False))

    interval = config.get("status_interval_ms", 300000)
    if not isinstance(interval, int) or interval < 1000 or interval > 3600000:
        interval = 300000
    config["status_interval_ms"] = interval
```

Add a branch in `_enforce_scope` (after the `mqtt_community` line, ~line 366):
```python
    if config_type == "mqtt_dmc_observer":
        return {"messages": "none", "raw_packets": "all"}
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/test_mqtt_dmc_observer.py -x -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/fanout/manager.py app/routers/fanout.py tests/test_mqtt_dmc_observer.py
git commit -m "feat(mqtt): register mqtt_dmc_observer type + validation + scope"
```

---

## Task 5: Backend integration test

**Files:**
- Modify: `tests/test_fanout_integration.py`

- [ ] **Step 1: Read the existing patterns**

Run: `grep -nE "mqtt_community|broadcast_raw|FanoutManager|reload_config|def test_" tests/test_fanout_integration.py | head -40`
Reuse the same fixtures/harness the existing `mqtt_community` integration test uses (config creation, enabling, dispatch). Mirror it for `mqtt_dmc_observer`.

- [ ] **Step 2: Write the failing test**

Add a test that: creates an enabled `mqtt_dmc_observer` config with `{iata:"AMS", broker_host:"h", publish_raw:true}`, monkeypatches the module's `_publisher.publish` to capture calls and `_publisher.connected=True`, patches `_get_pubkey_hex`/`_get_device_name`, dispatches a direct-routed packet via `FanoutManager.broadcast_raw(...)`, and asserts a publish to `meshcore/AMS/<ID>/packets` (and `.../raw`). Use `tests/helpers/packet_fixtures.DIRECT_PACKET_HEX`. Also assert a disabled config publishes nothing.

```python
# Sketch — adapt names to the file's existing harness:
import asyncio
from app.fanout import mqtt_dmc_observer as dmc
from tests.helpers.packet_fixtures import DIRECT_PACKET_HEX


def test_dmc_observer_receives_raw(monkeypatch, fanout_manager_with_config):
    mgr, module = fanout_manager_with_config(
        type="mqtt_dmc_observer",
        config={"iata": "AMS", "broker_host": "h", "publish_raw": True},
    )
    calls = []

    async def fake_publish(topic, payload, **k):
        calls.append(topic)

    module._publisher.connected = True
    monkeypatch.setattr(module._publisher, "publish", fake_publish)
    monkeypatch.setattr(dmc, "_get_pubkey_hex", lambda: "AABB")
    monkeypatch.setattr(dmc, "_get_device_name", lambda: "Node")

    asyncio.run(mgr.broadcast_raw({"data": DIRECT_PACKET_HEX, "snr": 7.0, "rssi": -90}))
    assert "meshcore/AMS/AABB/packets" in calls
    assert "meshcore/AMS/AABB/raw" in calls
```

If `fanout_manager_with_config` is not an existing fixture, construct the manager/module the same way the existing `mqtt_community` test does (read it first). Do NOT invent fixtures that aren't in the file.

- [ ] **Step 3: Run to verify it fails, then implement/adjust, then verify pass**

Run: `python -m pytest tests/test_fanout_integration.py -k dmc_observer -x -q`
Expected: FAIL first (no such test / wiring), PASS after alignment with the file's harness.

- [ ] **Step 4: Commit**

```bash
git add tests/test_fanout_integration.py
git commit -m "test(mqtt): DMC observer fanout dispatch integration"
```

---

## Task 6: Frontend editor + create-definition + i18n

**Files:**
- Modify: `frontend/src/components/settings/SettingsFanoutSection.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

- [ ] **Step 1: Add the DraftType**

In `SettingsFanoutSection.tsx`, extend the `DraftType` union (~line 140) with:
```typescript
  | 'mqtt_dmc_observer'
```

- [ ] **Step 2: Add the create-definition**

In `getCreateIntegrationDefinitions(t)` (array starting ~line 171), add an entry (place it in the community-sharing section, after the `mqtt_community_dmc2` entry):
```typescript
    {
      value: 'mqtt_dmc_observer',
      savedType: 'mqtt_dmc_observer',
      label: t('settings_fanout_type_dmc_observer'),
      section: t('settings_fanout_type_community_sharing'),
      description: t('settings_fanout_desc_dmc_observer'),
      defaultName: t('settings_fanout_type_dmc_observer'),
      nameMode: 'fixed',
      defaults: {
        config: {
          broker_host: '',
          broker_port: 443,
          transport: 'websockets',
          use_tls: true,
          tls_verify: true,
          auth_mode: 'token',
          username: '',
          password: '',
          iata: '',
          email: '',
          token_audience: '',
          websocket_path: '/',
          publish_status: true,
          publish_packets: true,
          publish_raw: false,
          status_interval_ms: 300000,
        },
        scope: { messages: 'none', raw_packets: 'all' },
      },
    },
```

- [ ] **Step 3: Add save-normalization for the new type**

In `normalizeIntegrationConfigForSave(configType, config)` (~line 453) add an `if (configType === 'mqtt_dmc_observer') { ... }` block that: trims `broker_host`, coerces `broker_port` (string→int, fallback 443), uppercases/trims `iata`, coerces `publish_status`/`publish_packets`/`publish_raw` to booleans, and coerces `status_interval_ms` to an int clamped to `[1000, 3600000]` with a `300000` fallback. Mirror the coercion style used in the existing `mqtt_community` branch (read lines ~472-500 first and copy the patterns exactly).

- [ ] **Step 4: Add the editor component**

Add `MqttDmcObserverConfigEditor` modeled on `MqttCommunityConfigEditor` (starts at ~line 1639 — read it and copy its broker/port/transport/TLS/auth/IATA/email field layout verbatim). Then add the DMC-specific controls below the shared fields:
- three checkboxes bound to `config.publish_status`, `config.publish_packets`, `config.publish_raw` (labels `t('settings_fanout_dmc_publish_status')`, `..._packets`, `..._raw`), each calling `onChange({ ...config, publish_x: e.target.checked })`;
- a number input for status interval in **minutes**, value `= Math.round(Number(config.status_interval_ms ?? 300000) / 60000)`, min `1`, max `60`, onChange sets `status_interval_ms = clamp(minutes,1,60) * 60000` (label `t('settings_fanout_dmc_status_interval_min')`, help `t('settings_fanout_dmc_status_interval_help')`).
No `ScopeSelector` (scope is fixed). Use `useT()` for `t`, mirroring the community editor.

- [ ] **Step 5: Wire the editor into the detail view**

Find where editors are chosen by saved type (search for `MqttCommunityConfigEditor` usage in the detail render, ~after line 3480). Add a sibling conditional rendering `MqttDmcObserverConfigEditor` when the saved/detail type is `mqtt_dmc_observer`, passing the same `config`/`onChange` props the community editor receives (no scope props).

- [ ] **Step 6: Add i18n keys**

Add these keys to all three catalogs `frontend/src/i18n/locales/{en,nl,de}.json` (keep `_meta` first; the parity test requires identical key sets). Real NL/DE below:

en.json:
```json
  "settings_fanout_type_dmc_observer": "DMC Observer (native)",
  "settings_fanout_desc_dmc_observer": "Bridge a companion radio to a DMC observer MQTT broker using the observer firmware's native status/packets/raw schema.",
  "settings_fanout_dmc_publish_status": "Publish status",
  "settings_fanout_dmc_publish_packets": "Publish packets",
  "settings_fanout_dmc_publish_raw": "Publish raw packets",
  "settings_fanout_dmc_status_interval_min": "Status interval (minutes)",
  "settings_fanout_dmc_status_interval_help": "How often the status message is published (1-60 minutes).",
```
nl.json:
```json
  "settings_fanout_type_dmc_observer": "DMC Observer (native)",
  "settings_fanout_desc_dmc_observer": "Verbind een companion-radio met een DMC-observer-MQTT-broker via het native status/packets/raw-schema van de observer-firmware.",
  "settings_fanout_dmc_publish_status": "Status publiceren",
  "settings_fanout_dmc_publish_packets": "Pakketten publiceren",
  "settings_fanout_dmc_publish_raw": "Ruwe pakketten publiceren",
  "settings_fanout_dmc_status_interval_min": "Statusinterval (minuten)",
  "settings_fanout_dmc_status_interval_help": "Hoe vaak het statusbericht wordt gepubliceerd (1-60 minuten).",
```
de.json:
```json
  "settings_fanout_type_dmc_observer": "DMC Observer (nativ)",
  "settings_fanout_desc_dmc_observer": "Verbindet ein Companion-Funkgerät mit einem DMC-Observer-MQTT-Broker im nativen status/packets/raw-Schema der Observer-Firmware.",
  "settings_fanout_dmc_publish_status": "Status veröffentlichen",
  "settings_fanout_dmc_publish_packets": "Pakete veröffentlichen",
  "settings_fanout_dmc_publish_raw": "Rohpakete veröffentlichen",
  "settings_fanout_dmc_status_interval_min": "Statusintervall (Minuten)",
  "settings_fanout_dmc_status_interval_help": "Wie oft die Statusnachricht veröffentlicht wird (1-60 Minuten).",
```
Insert each block next to the other `settings_fanout_type_*` / `settings_fanout_desc_*` keys so diffs stay grouped, keeping the three files' key sets identical.

- [ ] **Step 7: Verify frontend compiles + lint clean**

Run (in `frontend/`):
```bash
npx tsc -p tsconfig.json --noEmit
npx eslint src/components/settings/SettingsFanoutSection.tsx src/i18n/locales/en.json
npx vitest run src/test/i18nParity.test.ts
```
Expected: tsc exit 0; eslint 0 errors; i18nParity PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/settings/SettingsFanoutSection.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(mqtt): DMC observer fanout editor + i18n"
```

---

## Task 7: Frontend editor test

**Files:**
- Modify: `frontend/src/test/fanoutSection.test.tsx`

- [ ] **Step 1: Read the existing test harness**

Run: `grep -nE "render|create|mqtt_community|DraftType|screen\.|findBy|getBy" frontend/src/test/fanoutSection.test.tsx | head -40`
Mirror how the suite opens the create flow and selects a type.

- [ ] **Step 2: Write the test**

Add a test that opens the create flow, selects "DMC Observer (native)", fills IATA + broker host, toggles nothing (defaults), and asserts the create POST payload has `type: 'mqtt_dmc_observer'`, `config.publish_raw === false`, `config.publish_status === true`, and `config.status_interval_ms === 300000`. Also a case that sets the interval field to `10` (minutes) and asserts `status_interval_ms === 600000`. Match the file's existing mocking of the create API call.

- [ ] **Step 3: Run to verify pass**

Run (in `frontend/`): `npx vitest run src/test/fanoutSection.test.tsx`
Expected: PASS (use `--testTimeout=30000` if the full suite is run concurrently).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/test/fanoutSection.test.tsx
git commit -m "test(mqtt): DMC observer fanout editor test"
```

---

## Task 8: Docs + full verification

**Files:**
- Modify: `app/fanout/AGENTS_fanout.md`

- [ ] **Step 1: Document the module**

Under "## Current Module Types" in `app/fanout/AGENTS_fanout.md`, add an `### mqtt_dmc_observer` subsection: purpose (faithful DMC observer firmware bridge for a companion radio), config keys (connection knobs + `publish_status`/`publish_packets`/`publish_raw`/`status_interval_ms`), topic layout, and the three payload schemas (link to the spec). Note it is distinct from the `mqtt_community` DMC broker presets (which use the community schema).

- [ ] **Step 2: Commit docs**

```bash
git add app/fanout/AGENTS_fanout.md
git commit -m "docs(mqtt): document mqtt_dmc_observer fanout module"
```

- [ ] **Step 3: Full backend verification**

Run:
```bash
python -m pytest tests/test_mqtt_dmc_observer.py tests/test_fanout_integration.py -q
python -m ruff check app/fanout/mqtt_dmc_observer.py app/routers/fanout.py app/fanout/manager.py
python -m pyright app/fanout/mqtt_dmc_observer.py
```
Expected: new tests PASS (the ~13 known Windows-only env failures in `test_fanout_integration`/`test_mqtt` are pre-existing per project memory — confirm any failure is byte-identical to `origin/main`, not a regression); ruff + pyright clean.

- [ ] **Step 4: Full frontend verification**

Run (in `frontend/`):
```bash
npm run lint
npx tsc -p tsconfig.json --noEmit
npx vitest run --testTimeout=30000
```
Expected: lint 0 errors; tsc exit 0; vitest green.

- [ ] **Step 5: Live runtime check**

With a backend on `:8000` and `npm run dev`, create an `mqtt_dmc_observer` config against a test broker (or `dry`/local mosquitto), confirm topics `meshcore/{IATA}/{DEVICE}/status` and `.../packets` appear with the correct schema, `raw` absent by default, and status cadence matches the configured interval. Compare one captured publish against the firmware example JSON in the spec. Record NOT VERIFIED for anything not observed.

---

## Self-review notes

- **Spec coverage:** module+wiring (T3/T4), config blob + toggles + interval clamp (T1/T3/T4), topic layout (T1), all three payload schemas incl. F/D/T route + string SNR/RSSI + array path + `+00:00` + no-LWT + omitted stats (T1/T2), data sourcing from on_health (T2/T3), frontend+i18n (T6), tests (T1-T7), docs (T8) — all mapped.
- **Type consistency:** builder names (`build_dmc_topic`, `build_status_payload`, `build_packet_payload`, `build_raw_payload`, `_stats_from_health`, `clamp_status_interval_ms`, `_config_to_dmc_settings`, `_get_pubkey_hex`, `_get_device_name`), publisher `DmcObserverPublisher`, module `DmcObserverModule`, backend type string `mqtt_dmc_observer`, validator `_validate_dmc_observer_config` — used consistently across tasks.
- **Known unknowns the implementer must resolve by reading first (flagged inline, not placeholders):** the exact `tests/test_fanout_integration.py` harness/fixtures; the manager's registry symbol (`_MODULE_TYPES` vs a method); the detail-view editor-switch site; the community editor's exact field markup to copy; a reusable direct-packet hex fixture.
