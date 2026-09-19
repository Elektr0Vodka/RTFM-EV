"""app_settings round-trips the raw_packet_retention_days field (migration _096).

0 = keep forever (default); a positive integer is the number of days of
raw_packets history to keep. The daily prune task deletes older rows.
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_raw_packet_retention_default_keeps_forever(test_db):
    s = await AppSettingsRepository.get()
    assert s.raw_packet_retention_days == 0


@pytest.mark.asyncio
async def test_raw_packet_retention_round_trip(test_db):
    await AppSettingsRepository.update(raw_packet_retention_days=14)
    assert (await AppSettingsRepository.get()).raw_packet_retention_days == 14

    # Back to keep-forever.
    await AppSettingsRepository.update(raw_packet_retention_days=0)
    assert (await AppSettingsRepository.get()).raw_packet_retention_days == 0
