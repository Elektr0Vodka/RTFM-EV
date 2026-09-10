"""Noise-floor and battery-history persistence: repositories and endpoints."""

import pytest

from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository


class TestNoiseFloorRepository:
    @pytest.mark.asyncio
    async def test_insert_and_get_range(self, test_db):
        await NoiseFloorRepository.insert(1700000000, -100)
        await NoiseFloorRepository.insert(1700000100, -95)
        await NoiseFloorRepository.insert(1700000200, -110)

        rows = await NoiseFloorRepository.get_range(1700000050, 1700000200)
        assert rows == [
            {"timestamp": 1700000100, "noise_floor_dbm": -95},
            {"timestamp": 1700000200, "noise_floor_dbm": -110},
        ]

    @pytest.mark.asyncio
    async def test_get_range_empty(self, test_db):
        rows = await NoiseFloorRepository.get_range(0, 100)
        assert rows == []


class TestBatteryHistoryRepository:
    @pytest.mark.asyncio
    async def test_insert_and_get_range(self, test_db):
        await BatteryHistoryRepository.insert(1700000000, 3900)
        await BatteryHistoryRepository.insert(1700000100, 3850)

        rows = await BatteryHistoryRepository.get_range(1700000000, 1700000050)
        assert rows == [{"timestamp": 1700000000, "battery_mv": 3900}]


class TestPersistSamples:
    @pytest.mark.asyncio
    async def test_persists_noise_and_battery_from_snapshot(self, test_db):
        from app.services.radio_stats import _persist_samples

        await _persist_samples(
            {"timestamp": 1700000000, "noise_floor": -105, "battery_mv": 3700}
        )

        nf = await NoiseFloorRepository.get_range(1700000000, 1700000000)
        bat = await BatteryHistoryRepository.get_range(1700000000, 1700000000)
        assert nf == [{"timestamp": 1700000000, "noise_floor_dbm": -105}]
        assert bat == [{"timestamp": 1700000000, "battery_mv": 3700}]

    @pytest.mark.asyncio
    async def test_ignores_missing_fields(self, test_db):
        from app.services.radio_stats import _persist_samples

        await _persist_samples({"timestamp": 1700000000})  # no noise/battery

        assert await NoiseFloorRepository.get_range(0, 2000000000) == []
        assert await BatteryHistoryRepository.get_range(0, 2000000000) == []


class TestStatisticsEndpoints:
    @pytest.mark.asyncio
    async def test_noise_floor_range_endpoint(self, test_db, client):
        await NoiseFloorRepository.insert(1700000000, -100)
        await NoiseFloorRepository.insert(1700000100, -95)

        resp = await client.get(
            "/api/statistics/noise-floor?start_ts=1700000000&end_ts=1700000200"
        )
        assert resp.status_code == 200
        assert resp.json() == [
            {"timestamp": 1700000000, "noise_floor_dbm": -100},
            {"timestamp": 1700000100, "noise_floor_dbm": -95},
        ]

    @pytest.mark.asyncio
    async def test_battery_range_endpoint(self, test_db, client):
        await BatteryHistoryRepository.insert(1700000000, 3900)

        resp = await client.get(
            "/api/statistics/battery/range?start_ts=1700000000&end_ts=1700000200"
        )
        assert resp.status_code == 200
        assert resp.json() == [{"timestamp": 1700000000, "battery_mv": 3900}]

    @pytest.mark.asyncio
    async def test_battery_endpoint_shape_merges_db(self, test_db, client):
        import time

        now = int(time.time())
        await BatteryHistoryRepository.insert(now - 100, 3800)

        resp = await client.get("/api/statistics/battery")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) >= {
            "sample_interval_seconds",
            "coverage_seconds",
            "latest_battery_mv",
            "latest_timestamp",
            "samples",
        }
        assert {"timestamp": now - 100, "battery_mv": 3800} in body["samples"]
        assert body["latest_battery_mv"] == 3800
