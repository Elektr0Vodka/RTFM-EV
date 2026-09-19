"""app_settings round-trips packet_history_sort (migration _098).

Independent from packet_feed_sort; controls the Packet History view sort.
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_packet_history_sort_default_oldest(test_db):
    assert (await AppSettingsRepository.get()).packet_history_sort == "oldest"


@pytest.mark.asyncio
async def test_packet_history_sort_round_trip(test_db):
    await AppSettingsRepository.update(packet_history_sort="newest")
    assert (await AppSettingsRepository.get()).packet_history_sort == "newest"

    await AppSettingsRepository.update(packet_history_sort="oldest")
    assert (await AppSettingsRepository.get()).packet_history_sort == "oldest"


@pytest.mark.asyncio
async def test_packet_history_sort_independent_of_feed_sort(test_db):
    await AppSettingsRepository.update(packet_feed_sort="newest", packet_history_sort="oldest")
    s = await AppSettingsRepository.get()
    assert s.packet_feed_sort == "newest"
    assert s.packet_history_sort == "oldest"
