"""Tests for FanoutMqttStatsRepository and per-broker MQTT stat tracking."""

from unittest.mock import AsyncMock

import pytest

from app.fanout.mqtt_base import BaseMqttPublisher
from app.repository.fanout import FanoutConfigRepository, FanoutMqttStatsRepository


class _StubPublisher(BaseMqttPublisher):
    """Minimal concrete BaseMqttPublisher for exercising the counters."""

    def _is_configured(self) -> bool:
        return True

    def _build_client_kwargs(self, settings):
        return {}

    def _on_connected(self, settings):
        return ("t", "d")

    def _on_error(self):
        return ("t", "d")


class TestFanoutMqttStatsRepository:
    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, test_db):
        assert await FanoutMqttStatsRepository.get("nope") is None

    @pytest.mark.asyncio
    async def test_set_then_get_round_trips(self, test_db):
        await FanoutMqttStatsRepository.set(
            "cfg-1", messages_published=5, publish_failures=2, reconnects=1
        )
        row = await FanoutMqttStatsRepository.get("cfg-1")
        assert row["messages_published"] == 5
        assert row["publish_failures"] == 2
        assert row["reconnects"] == 1
        assert row["updated_at"]  # non-empty ISO timestamp

    @pytest.mark.asyncio
    async def test_set_is_idempotent_upsert(self, test_db):
        await FanoutMqttStatsRepository.set("cfg-1", 1, 0, 0)
        await FanoutMqttStatsRepository.set("cfg-1", 9, 3, 2)
        row = await FanoutMqttStatsRepository.get("cfg-1")
        assert (row["messages_published"], row["publish_failures"], row["reconnects"]) == (9, 3, 2)

    @pytest.mark.asyncio
    async def test_delete_removes_row(self, test_db):
        await FanoutMqttStatsRepository.set("cfg-1", 1, 1, 1)
        await FanoutMqttStatsRepository.delete("cfg-1")
        assert await FanoutMqttStatsRepository.get("cfg-1") is None

    @pytest.mark.asyncio
    async def test_config_delete_also_removes_stats(self, test_db):
        cfg = await FanoutConfigRepository.create(
            "mqtt_private", "P", {"broker_host": "h"}, {}, enabled=False
        )
        await FanoutMqttStatsRepository.set(cfg["id"], 3, 0, 0)
        await FanoutConfigRepository.delete(cfg["id"])
        assert await FanoutMqttStatsRepository.get(cfg["id"]) is None


class TestPublisherCounters:
    @pytest.mark.asyncio
    async def test_publish_success_increments_messages_published(self):
        pub = _StubPublisher()
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("topic", {"a": 1})
        assert pub.messages_published == 1
        assert pub.publish_failures == 0

    @pytest.mark.asyncio
    async def test_publish_failure_increments_publish_failures(self):
        pub = _StubPublisher()
        pub._client = AsyncMock()
        pub._client.publish.side_effect = RuntimeError("boom")
        pub.connected = True
        await pub.publish("topic", {"a": 1})
        assert pub.messages_published == 0
        assert pub.publish_failures == 1

    @pytest.mark.asyncio
    async def test_load_baseline_adds_to_session(self, test_db):
        pub = _StubPublisher()
        pub.set_config_id("cfg-b")
        await FanoutMqttStatsRepository.set("cfg-b", 10, 4, 2)
        await pub.load_baseline()
        # Session starts at 0, cumulative == baseline.
        assert pub.messages_published == 10
        assert pub.publish_failures == 4
        assert pub.reconnects == 2
        # A new publish adds on top of the baseline.
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("t", {})
        assert pub.messages_published == 11

    @pytest.mark.asyncio
    async def test_flush_writes_baseline_plus_session_and_is_idempotent(self, test_db):
        pub = _StubPublisher()
        pub.set_config_id("cfg-c")
        await FanoutMqttStatsRepository.set("cfg-c", 5, 0, 0)
        await pub.load_baseline()
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("t", {})  # session +1
        await pub.flush_stats()
        await pub.flush_stats()  # repeat must not double count
        row = await FanoutMqttStatsRepository.get("cfg-c")
        assert row["messages_published"] == 6  # 5 baseline + 1 session

    @pytest.mark.asyncio
    async def test_flush_without_config_id_is_noop(self, test_db):
        pub = _StubPublisher()  # no config_id set
        await pub.flush_stats()  # must not raise
        assert await FanoutMqttStatsRepository.get("") is None


class TestGetMqttStats:
    @pytest.mark.asyncio
    async def test_get_mqtt_stats_reports_active_mqtt_modules(self, test_db):
        from app.fanout.manager import FanoutManager
        from app.fanout.mqtt_private import MqttPrivateModule
        from app.repository.fanout import _configs_cache

        mgr = FanoutManager()
        module = MqttPrivateModule("cfg-x", {"broker_host": "h"}, name="Private")
        # Simulate an active, running module without a real broker connection.
        module._publisher._session_published = 7
        module._publisher._session_failures = 1
        module._publisher._session_reconnects = 2
        mgr._modules["cfg-x"] = (module, {})
        _configs_cache["cfg-x"] = {"name": "Private", "type": "mqtt_private", "enabled": True}

        stats = mgr.get_mqtt_stats()

        assert len(stats) == 1
        entry = stats[0]
        assert entry["config_id"] == "cfg-x"
        assert entry["name"] == "Private"
        assert entry["type"] == "mqtt_private"
        assert entry["messages_published"] == 7
        assert entry["publish_failures"] == 1
        assert entry["reconnects"] == 2
        assert "status" in entry and "last_error" in entry

    @pytest.mark.asyncio
    async def test_get_mqtt_stats_excludes_non_mqtt_modules(self, test_db):
        from app.fanout.base import FanoutModule
        from app.fanout.manager import FanoutManager

        mgr = FanoutManager()
        mgr._modules["w1"] = (FanoutModule("w1", {}, name="hook"), {})
        assert mgr.get_mqtt_stats() == []


class TestStatisticsEndpointMqtt:
    @pytest.mark.asyncio
    async def test_statistics_includes_mqtt_brokers(self, test_db):
        from unittest.mock import patch

        from httpx import ASGITransport, AsyncClient

        from app.main import app

        fake = [
            {
                "config_id": "cfg-x",
                "name": "Private",
                "type": "mqtt_private",
                "status": "connected",
                "last_error": None,
                "messages_published": 7,
                "publish_failures": 1,
                "reconnects": 2,
            }
        ]
        with patch("app.routers.statistics.fanout_manager.get_mqtt_stats", return_value=fake):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/statistics")
        assert resp.status_code == 200
        body = resp.json()
        assert body["mqtt_brokers"] == fake

    @pytest.mark.asyncio
    async def test_statistics_mqtt_brokers_defaults_empty(self, test_db):
        from unittest.mock import patch

        from httpx import ASGITransport, AsyncClient

        from app.main import app

        with patch("app.routers.statistics.fanout_manager.get_mqtt_stats", return_value=[]):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/statistics")
        assert resp.status_code == 200
        assert resp.json()["mqtt_brokers"] == []
