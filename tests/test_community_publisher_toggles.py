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
