import pytest

from app.fanout.mqtt_community import MqttCommunityModule, _config_to_settings


def test_config_to_settings_maps_toggles_and_interval():
    s = _config_to_settings(
        {"publish_status": False, "status_interval_ms": 600000, "iata": "AMS"}
    )
    assert s.community_mqtt_publish_status is False
    assert s.community_mqtt_status_interval_ms == 600000


def test_config_to_settings_defaults():
    s = _config_to_settings({"iata": "AMS"})
    assert s.community_mqtt_publish_status is True
    assert s.community_mqtt_status_interval_ms == 300000


@pytest.mark.asyncio
async def test_on_raw_skips_packets_when_disabled(monkeypatch):
    module = MqttCommunityModule(
        "c1", {"iata": "AMS", "publish_packets": False}, name="c"
    )
    module._publisher.connected = True
    module._publisher._settings = object()  # non-None so on_raw proceeds

    published: list[str] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(module._publisher, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    await module.on_raw({"data": "0a02aabbcc", "snr": 7.0, "rssi": -90})
    assert published == []


@pytest.mark.asyncio
async def test_on_raw_publishes_packets_when_enabled(monkeypatch):
    module = MqttCommunityModule("c2", {"iata": "AMS"}, name="c")  # packets default on
    module._publisher.connected = True
    module._publisher._settings = object()

    published: list[str] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(module._publisher, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    await module.on_raw({"data": "0a02aabbcc", "snr": 7.0, "rssi": -90})
    assert any(t.startswith("meshcore/AMS/") and t.endswith("/packets") for t in published)
