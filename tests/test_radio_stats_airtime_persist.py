"""Tests that the radio-stats sampler persists tx/rx airtime and RX error counters."""

import pytest

from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.services import radio_stats


def _patch_repos(monkeypatch, calls):
    async def fake_air(ts, tx, rx, recv_errors=None):
        calls.append((ts, tx, rx, recv_errors))

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(AirtimeHistoryRepository, "insert", staticmethod(fake_air))
    monkeypatch.setattr(NoiseFloorRepository, "insert", staticmethod(noop))
    monkeypatch.setattr(BatteryHistoryRepository, "insert", staticmethod(noop))


@pytest.mark.asyncio
async def test_persist_writes_airtime(monkeypatch):
    calls: list[tuple[int, int, int, int | None]] = []
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
    assert calls == [(1000, 5, 9, None)]


@pytest.mark.asyncio
async def test_persist_writes_recv_errors_from_packet_stats(monkeypatch):
    calls: list[tuple[int, int, int, int | None]] = []
    _patch_repos(monkeypatch, calls)

    await radio_stats._persist_samples(
        {
            "timestamp": 1000,
            "tx_air_secs": 5,
            "rx_air_secs": 9,
            "packets": {"recv": 10, "sent": 2, "recv_errors": 3},
        }
    )
    assert calls == [(1000, 5, 9, 3)]

    # Legacy 26-byte STATS_PACKETS frame: the parser sets recv_errors=None.
    await radio_stats._persist_samples(
        {
            "timestamp": 1060,
            "tx_air_secs": 6,
            "rx_air_secs": 9,
            "packets": {"recv": 11, "sent": 2, "recv_errors": None},
        }
    )
    assert calls[-1] == (1060, 6, 9, None)


@pytest.mark.asyncio
async def test_persist_skips_airtime_when_missing(monkeypatch):
    calls: list[tuple[int, int, int, int | None]] = []
    _patch_repos(monkeypatch, calls)

    # Only one of the two counters present -> nothing written.
    await radio_stats._persist_samples({"timestamp": 1000, "tx_air_secs": 5})
    assert calls == []
