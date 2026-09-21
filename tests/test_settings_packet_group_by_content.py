"""app_settings round-trips packet_group_by_content (migration _101).

Persists the last-selected "Group repeats by content" packet-filter toggle,
shared by the Raw Packet Feed and Packet History views.
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_packet_group_by_content_default_false(test_db):
    assert (await AppSettingsRepository.get()).packet_group_by_content is False


@pytest.mark.asyncio
async def test_packet_group_by_content_round_trip(test_db):
    await AppSettingsRepository.update(packet_group_by_content=True)
    assert (await AppSettingsRepository.get()).packet_group_by_content is True

    await AppSettingsRepository.update(packet_group_by_content=False)
    assert (await AppSettingsRepository.get()).packet_group_by_content is False
