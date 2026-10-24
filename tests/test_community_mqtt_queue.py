"""Community MQTT: payload type filter, offline queue and broker error listening."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.fanout.mqtt_community import MqttCommunityModule, _payload_type, _type_allowed
from app.routers.fanout import _validate_mqtt_community_config

PUBKEY = bytes.fromhex("AB" * 32)


def _raw(payload_type: int, ts: int = 1_700_000_000, body: str = "00AA") -> dict:
    """Raw packet broadcast: flood route, no path."""
    header = (payload_type << 2) | 1
    return {"timestamp": ts, "data": f"{header:02X}{body}", "snr": None, "rssi": None}


class _Publisher:
    """Stand-in for CommunityMqttPublisher: records publishes, can drop the link."""

    def __init__(self, connected: bool) -> None:
        self.connected = connected
        self._settings = SimpleNamespace()
        self.published: list[tuple[str, dict]] = []
        self.fail_next = False
        self.last_error = None
        self.broker_error = None
        self.messages_published = 0
        self.publish_failures = 0
        self.reconnects = 0

    def _is_configured(self) -> bool:
        return True

    async def publish(self, topic: str, payload: dict) -> None:
        if self.fail_next:
            self.fail_next = False
            self.connected = False
            return
        self.published.append((topic, payload))


def _module(
    config: dict | None = None, *, connected: bool
) -> tuple[MqttCommunityModule, _Publisher]:
    module = MqttCommunityModule("cfg", {"iata": "AMS", **(config or {})}, name="Test")
    publisher = _Publisher(connected)
    module._publisher = publisher  # type: ignore[assignment]
    return module, publisher


@pytest.fixture(autouse=True)
def _radio_key():
    mock_radio = MagicMock()
    mock_radio.meshcore = MagicMock()
    mock_radio.meshcore.self_info = {"name": "Node"}
    with (
        patch("app.keystore.get_public_key", return_value=PUBKEY),
        patch("app.services.radio_runtime.radio_runtime", mock_radio),
    ):
        yield


def test_payload_type_is_read_from_the_header():
    assert _payload_type(_raw(4)) == 4
    assert _payload_type({"data": ""}) is None


def test_type_filter_empty_means_all():
    assert _type_allowed({}, _raw(9))
    assert _type_allowed({"packet_types": [4, 5]}, _raw(5))
    assert not _type_allowed({"packet_types": [4, 5]}, _raw(2))


@pytest.mark.asyncio
async def test_filtered_type_is_not_published():
    module, publisher = _module({"packet_types": [4]}, connected=True)
    await module.on_raw(_raw(2))
    await module.on_raw(_raw(4))
    assert len(publisher.published) == 1


@pytest.mark.asyncio
async def test_packets_wait_while_disconnected_and_go_out_in_order_with_receive_time():
    module, publisher = _module(connected=False)
    await module.on_raw(_raw(4, ts=1_700_000_001))
    await module.on_raw(_raw(4, ts=1_700_000_002))
    assert publisher.published == []
    assert module.mqtt_counters["queued"] == 2

    publisher.connected = True
    await module._flush_offline_queue()
    stamps = [packet["timestamp"] for _topic, packet in publisher.published]
    assert stamps == ["2023-11-14T22:13:21Z", "2023-11-14T22:13:22Z"]
    assert module.mqtt_counters["queued"] == 0


@pytest.mark.asyncio
async def test_full_queue_drops_the_oldest():
    module, publisher = _module({"offline_queue_max": 2}, connected=False)
    for ts in (1, 2, 3):
        await module.on_raw(_raw(4, ts=1_700_000_000 + ts))
    counters = module.mqtt_counters
    assert counters["queued"] == 2
    assert counters["queue_dropped"] == 1

    publisher.connected = True
    await module._flush_offline_queue()
    assert [p["timestamp"] for _t, p in publisher.published] == [
        "2023-11-14T22:13:22Z",
        "2023-11-14T22:13:23Z",
    ]


@pytest.mark.asyncio
async def test_queue_off_drops_packets_while_disconnected():
    module, _publisher = _module({"offline_queue": False}, connected=False)
    await module.on_raw(_raw(4))
    assert module.mqtt_counters["queued"] == 0


@pytest.mark.asyncio
async def test_a_failed_flush_keeps_the_packet():
    module, publisher = _module(connected=False)
    await module.on_raw(_raw(4))
    publisher.connected = True
    publisher.fail_next = True
    await module._flush_offline_queue()
    assert module.mqtt_counters["queued"] == 1


@pytest.mark.asyncio
async def test_new_packet_after_reconnect_goes_after_the_waiting_ones():
    module, publisher = _module(connected=False)
    await module.on_raw(_raw(4, ts=1_700_000_001))
    publisher.connected = True
    await module.on_raw(_raw(4, ts=1_700_000_005))
    assert [p["timestamp"] for _t, p in publisher.published] == [
        "2023-11-14T22:13:21Z",
        "2023-11-14T22:13:25Z",
    ]


class _Messages:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop(0)


@pytest.mark.asyncio
async def test_broker_error_topic_is_read_and_shown_as_the_last_error():
    from app.fanout.community_mqtt import CommunityMqttPublisher

    publisher = CommunityMqttPublisher()
    client = MagicMock()
    client.subscribe = AsyncMock()
    client.messages = _Messages(
        [
            SimpleNamespace(
                topic=f"meshcore/AMS/{PUBKEY.hex().upper()}/error",
                payload=json.dumps(
                    {"code": "PUBLISH_UNKNOWN_IATA", "message": "AMS not listed"}
                ).encode(),
            )
        ]
    )
    publisher._client = client
    settings = SimpleNamespace(community_mqtt_listen_broker_errors=True, community_mqtt_iata="ams")

    await publisher._listen_broker_errors(settings)
    assert publisher._error_reader is not None
    await publisher._error_reader

    client.subscribe.assert_awaited_once_with(f"meshcore/AMS/{PUBKEY.hex().upper()}/error")
    assert publisher.broker_error == "Broker refused: PUBLISH_UNKNOWN_IATA (AMS not listed)"

    module = MqttCommunityModule("cfg", {"iata": "AMS"}, name="Test")
    module._publisher = publisher
    assert module.last_error == publisher.broker_error


@pytest.mark.asyncio
async def test_broker_errors_are_not_subscribed_unless_asked():
    from app.fanout.community_mqtt import CommunityMqttPublisher

    publisher = CommunityMqttPublisher()
    client = MagicMock()
    client.subscribe = AsyncMock()
    publisher._client = client
    await publisher._listen_broker_errors(SimpleNamespace(community_mqtt_iata="AMS"))
    client.subscribe.assert_not_awaited()


def _valid_config(**extra) -> dict:
    return {"iata": "ams", **extra}


def test_config_defaults():
    config = _valid_config()
    _validate_mqtt_community_config(config)
    assert config["packet_types"] == []
    assert config["offline_queue"] is True
    assert config["offline_queue_max"] == 500
    assert config["listen_broker_errors"] is False


def test_config_rejects_bad_packet_types():
    with pytest.raises(HTTPException):
        _validate_mqtt_community_config(_valid_config(packet_types=[16]))
    with pytest.raises(HTTPException):
        _validate_mqtt_community_config(_valid_config(packet_types="4"))


def test_config_normalises_packet_types_and_clamps_the_queue():
    config = _valid_config(packet_types=[5, 4, 5], offline_queue_max=99999)
    _validate_mqtt_community_config(config)
    assert config["packet_types"] == [4, 5]
    assert config["offline_queue_max"] == 500
