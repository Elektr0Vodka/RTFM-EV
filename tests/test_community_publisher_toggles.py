import json

import pytest

from app.fanout import community_mqtt as cm


def test_clamp_status_interval_ms():
    assert cm._clamp_status_interval_ms(600000) == 600000
    assert cm._clamp_status_interval_ms(500) == 300000
    assert cm._clamp_status_interval_ms(9_999_999) == 300000
    assert cm._clamp_status_interval_ms("bad") == 300000
    assert cm._clamp_status_interval_ms(None) == 300000


@pytest.mark.asyncio
async def test_publish_status_skipped_when_disabled(monkeypatch):
    pub = cm.CommunityMqttPublisher()
    published: list = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(pub, "publish", fake_publish)

    from types import SimpleNamespace

    settings = SimpleNamespace(community_mqtt_publish_status=False, community_mqtt_iata="AMS")
    await pub._publish_status(settings)
    assert published == []


@pytest.mark.asyncio
async def test_publish_config_skipped_when_disabled(monkeypatch):
    pub = cm.CommunityMqttPublisher()
    published: list = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(pub, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    from types import SimpleNamespace

    settings = SimpleNamespace(community_mqtt_publish_config=False, community_mqtt_iata="AMS")
    await pub._publish_config(settings)
    assert published == []


@pytest.mark.asyncio
async def test_publish_config_publishes_retained_config_topic(monkeypatch):
    pub = cm.CommunityMqttPublisher()
    published: list[tuple[str, dict, dict]] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append((topic, payload, kwargs))

    monkeypatch.setattr(pub, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    from types import SimpleNamespace

    from app.services.host_repeater_settings import HostRepeaterSettings, RegionConfig

    class _Repo:
        @staticmethod
        async def get():
            return SimpleNamespace(flood_scope="nl")

    monkeypatch.setattr("app.repository.AppSettingsRepository", _Repo)
    fake_host = SimpleNamespace(
        settings=HostRepeaterSettings(
            regions=[RegionConfig(name="nl"), RegionConfig(name="nl-gr", parent="nl")],
            home_region="nl-gr",
        ),
        state="shadow",
    )
    monkeypatch.setattr("app.services.host_repeater.host_repeater", fake_host)

    settings = SimpleNamespace(
        community_mqtt_publish_config=True,
        community_mqtt_iata="ams",
        community_mqtt_fanout_config={"iata": "AMS", "publish_packets": False},
    )
    await pub._publish_config(settings)

    assert len(published) == 1
    topic, payload, kwargs = published[0]
    assert topic == "meshcore/AMS/AABB/config"
    assert kwargs.get("retain") is True
    assert payload["origin_id"] == "AABB"
    assert payload["region"]["home"] == "nl-gr"
    assert payload["region"]["default"] == "nl"
    assert payload["region"]["scopes"] == [
        {"name": "nl", "flood": True, "parent": "*"},
        {"name": "nl-gr", "flood": True, "parent": "nl"},
    ]
    assert payload["repeat"]["disable_fwd"] is True  # shadow, not armed
    assert payload["mqtt"]["packets"] is False
    assert payload["mqtt"]["config"] is True
    assert "broker" not in json.dumps(payload).lower()
