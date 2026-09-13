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
