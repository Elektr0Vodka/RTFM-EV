"""Prometheus metrics: format, content and the opt-in switch."""

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.repository import ChannelRepository, ContactRepository, MessageRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository
from app.services.metrics_export import _escape, build_metrics_text

KEY = "ab" * 32


def _lines(text: str, name: str) -> list[str]:
    return [
        line
        for line in text.splitlines()
        if line.startswith(name + "{") or line.startswith(name + " ")
    ]


@pytest.mark.asyncio
async def test_metrics_cover_store_nodes_and_sensors(test_db):
    await ContactRepository.upsert({"public_key": KEY, "name": 'Hill "Top"', "type": 2})
    await ChannelRepository.upsert(key="AA" * 16, name="#ops")
    await MessageRepository.create(
        msg_type="CHAN",
        text="Bob: hi",
        conversation_key="AA" * 16,
        sender_timestamp=1,
        received_at=1,
    )
    await RepeaterTelemetryRepository.record(
        public_key=KEY,
        timestamp=1000,
        data={
            "battery_volts": 4.12,
            "packets_received": 120,
            "lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 21.5}],
        },
    )

    text = await build_metrics_text(now=1060)

    assert "# TYPE rtfm_contacts gauge" in text
    assert 'rtfm_contacts{type="repeater"} 1' in text
    # The test database may hold seeded channels too.
    (channels_line,) = _lines(text, "rtfm_channels")
    assert int(channels_line.split()[-1]) >= 1
    assert 'rtfm_messages{type="channel"} 1' in text
    labels = f'public_key="{KEY}",name="Hill \\"Top\\""'
    assert f"rtfm_node_battery_volts{{{labels}}} 4.12" in text
    assert f"rtfm_node_packets_received_total{{{labels}}} 120" in text
    assert "# TYPE rtfm_node_packets_received_total counter" in text
    assert f"rtfm_node_telemetry_age_seconds{{{labels}}} 60" in text
    assert f'rtfm_node_sensor{{{labels},channel="1",sensor="temperature"}} 21.5' in text
    # One HELP/TYPE per metric even with several samples.
    assert text.count("# HELP rtfm_contacts ") == 1


@pytest.mark.asyncio
async def test_radio_queue_and_connection(test_db):
    class _Radio:
        is_connected = True

        def operation_queue(self):
            return {
                "holder": {"name": "x", "held_ms": 5},
                "waiting": [{"name": "y", "waited_ms": 1}],
            }

    with patch("app.services.radio_runtime.radio_runtime", _Radio()):
        text = await build_metrics_text(now=0)
    assert "rtfm_radio_connected 1" in text
    assert "rtfm_radio_operation_running 1" in text
    assert "rtfm_radio_operations_waiting 1" in text


def test_label_escaping():
    assert _escape('a"b\\c\nd') == 'a\\"b\\\\c\\nd'


@pytest.mark.asyncio
async def test_endpoint_is_off_by_default(test_db):
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/metrics")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_endpoint_serves_prometheus_text_when_enabled(test_db):
    from app.config import settings
    from app.main import app

    with patch.object(settings, "metrics_enabled", True):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/metrics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain; version=0.0.4")
    assert _lines(resp.text, "rtfm_build_info")
