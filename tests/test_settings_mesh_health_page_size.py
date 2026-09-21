"""app_settings round-trips mesh_health_page_size (migration _100).

Controls the Mesh Health "All Advertised Contacts Heard" table page size.
0 means "show all"; other allowed values are 10/25/50/100.
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_mesh_health_page_size_default_50(test_db):
    assert (await AppSettingsRepository.get()).mesh_health_page_size == 50


@pytest.mark.asyncio
async def test_mesh_health_page_size_round_trip(test_db):
    await AppSettingsRepository.update(mesh_health_page_size=25)
    assert (await AppSettingsRepository.get()).mesh_health_page_size == 25

    # 0 = show all.
    await AppSettingsRepository.update(mesh_health_page_size=0)
    assert (await AppSettingsRepository.get()).mesh_health_page_size == 0


@pytest.mark.asyncio
async def test_mesh_health_page_size_coerces_unexpected_to_default(test_db):
    # A value outside the allowed set is written to the column but coerced back
    # to 50 on read (defense against a stale/rogue client).
    await AppSettingsRepository.update(mesh_health_page_size=999)
    assert (await AppSettingsRepository.get()).mesh_health_page_size == 50
