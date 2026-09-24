"""app_settings round-trips backup settings fields."""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_backup_fields_default(test_db):
    s = await AppSettingsRepository.get()
    assert s.backup_to_path_enabled is False
    assert s.backup_destination_path == ""


@pytest.mark.asyncio
async def test_backup_fields_round_trip(test_db):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path="/mnt/backups",
    )
    s = await AppSettingsRepository.get()
    assert s.backup_to_path_enabled is True
    assert s.backup_destination_path == "/mnt/backups"


@pytest.mark.asyncio
async def test_backup_schedule_fields_default(test_db):
    s = await AppSettingsRepository.get()
    assert s.backup_schedule_enabled is False
    assert s.backup_schedule_interval_hours == 24
    assert s.backup_schedule_keep == 7


@pytest.mark.asyncio
async def test_backup_schedule_fields_round_trip(test_db):
    await AppSettingsRepository.update(
        backup_schedule_enabled=True,
        backup_schedule_interval_hours=6,
        backup_schedule_keep=3,
    )
    s = await AppSettingsRepository.get()
    assert s.backup_schedule_enabled is True
    assert s.backup_schedule_interval_hours == 6
    assert s.backup_schedule_keep == 3
