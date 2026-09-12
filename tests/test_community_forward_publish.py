"""The community sink publishes forwarded node telemetry/neighbors/regions to
distinct new kinds under the self-pubkey topic base, gated by opt-in flags
(plan [24])."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.fanout.mqtt_community import MqttCommunityModule

_SELF_HEX = "11ff22ee33dd44cc55bb66aa"
_SELF_BYTES = bytes.fromhex(_SELF_HEX)
_SUBJECT = "aabbccddeeff00112233445566778899"


def _module(**config) -> tuple[MqttCommunityModule, list[tuple[str, dict]]]:
    config.setdefault("iata", "DEN")
    mod = MqttCommunityModule("cfg", config)
    published: list[tuple[str, dict]] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append((topic, payload))

    mod._publisher.connected = True
    mod._publisher._settings = SimpleNamespace()
    mod._publisher.publish = fake_publish
    return mod, published


def _telemetry_event() -> dict:
    return {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,
        "battery_volts": 4.1,
        "uptime_seconds": 3600,
    }


def _patched_identity():
    return (
        patch("app.keystore.get_public_key", return_value=_SELF_BYTES),
        patch(
            "app.services.radio_runtime.radio_runtime",
            SimpleNamespace(meshcore=SimpleNamespace(self_info={"name": "MyRadio"})),
        ),
    )


@pytest.mark.asyncio
async def test_on_telemetry_publishes_node_telemetry_topic_with_subject_id():
    mod, published = _module(publish_telemetry=True)
    p_key, p_rt = _patched_identity()
    with p_key, p_rt:
        await mod.on_telemetry(_telemetry_event())

    assert len(published) == 1
    topic, payload = published[0]
    assert topic == f"meshcore/DEN/{_SELF_HEX.upper()}/node_telemetry"
    assert payload["origin_id"] == _SELF_HEX.upper()  # publisher
    assert payload["subject_id"] == _SUBJECT.upper()  # heard node
    assert payload["stats"]["battery_mv"] == 4100


@pytest.mark.asyncio
async def test_on_telemetry_disabled_by_default():
    mod, published = _module()  # publish_telemetry defaults to False
    p_key, p_rt = _patched_identity()
    with p_key, p_rt:
        await mod.on_telemetry(_telemetry_event())

    assert published == []


@pytest.mark.asyncio
async def test_on_neighbor_publishes_node_neighbors_topic():
    mod, published = _module(publish_neighbors=True)
    event = {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,
        "reported_count": 1,
        "neighbors": [
            {"pubkey_prefix": "00112233", "name": "A", "snr": 9.75, "last_heard_seconds": 42}
        ],
    }
    p_key, p_rt = _patched_identity()
    with p_key, p_rt:
        await mod.on_neighbor(event)

    assert len(published) == 1
    topic, payload = published[0]
    assert topic == f"meshcore/DEN/{_SELF_HEX.upper()}/node_neighbors"
    assert payload["subject_id"] == _SUBJECT.upper()
    assert payload["neighbors"][0]["pubkey"] == "00112233"


@pytest.mark.asyncio
async def test_on_region_publishes_node_regions_topic():
    mod, published = _module(publish_regions=True)
    event = {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,
        "regions": [{"name": "DEN", "depth": 1, "flood_allowed": True, "is_home": True}],
    }
    p_key, p_rt = _patched_identity()
    with p_key, p_rt:
        await mod.on_region(event)

    assert len(published) == 1
    topic, payload = published[0]
    assert topic == f"meshcore/DEN/{_SELF_HEX.upper()}/node_regions"
    assert payload["subject_id"] == _SUBJECT.upper()


@pytest.mark.asyncio
async def test_on_telemetry_skips_when_disconnected():
    mod, published = _module(publish_telemetry=True)
    mod._publisher.connected = False
    p_key, p_rt = _patched_identity()
    with p_key, p_rt:
        await mod.on_telemetry(_telemetry_event())

    assert published == []
