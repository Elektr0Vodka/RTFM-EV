"""Tests that the radio-stats sampler persists tx/rx airtime counters."""

import pytest

from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.services import radio_stats


def _patch_repos(monkeypatch, calls):
    async def fake_air(ts, tx, rx):
        calls.append((ts, tx, rx))

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(AirtimeHistoryRepository, "insert", staticmethod(fake_air))
    monkeypatch.setattr(NoiseFloorRepository, "insert", staticmethod(noop))
    monkeypatch.setattr(BatteryHistoryRepository, "insert", staticmethod(noop))


@pytest.mark.asyncio
async def test_persist_writes_airtime(monkeypatch):
    calls: list[tuple[int, int, int]] = []
    _patch_repos(monkeypatch, calls)

    await radio_stats._persist_samples(
        {
            "timestamp": 1000,
            "tx_air_secs": 5,
            "rx_air_secs": 9,
            "noise_floor": -100,
            "battery_mv": 4100,
        }
    )
    assert calls == [(1000, 5, 9)]


@pytest.mark.asyncio
async def test_persist_skips_airtime_when_missing(monkeypatch):
    calls: list[tuple[int, int, int]] = []
    _patch_repos(monkeypatch, calls)

    # Only one of the two counters present -> nothing written.
    await radio_stats._persist_samples({"timestamp": 1000, "tx_air_secs": 5})
    assert calls == []
