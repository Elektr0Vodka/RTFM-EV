"""Tests for AirtimeHistoryRepository (airtime_history table)."""

import pytest

from app.repository.airtime_history import AirtimeHistoryRepository


@pytest.mark.asyncio
async def test_insert_and_get_range(test_db):
    await AirtimeHistoryRepository.insert(1000, 10, 20)
    await AirtimeHistoryRepository.insert(1060, 12, 25)
    await AirtimeHistoryRepository.insert(2000, 99, 99)  # outside the queried range

    rows = await AirtimeHistoryRepository.get_range(900, 1100)
    assert rows == [
        {"timestamp": 1000, "tx_air_secs": 10, "rx_air_secs": 20},
        {"timestamp": 1060, "tx_air_secs": 12, "rx_air_secs": 25},
    ]


@pytest.mark.asyncio
async def test_get_range_empty(test_db):
    assert await AirtimeHistoryRepository.get_range(0, 100) == []
