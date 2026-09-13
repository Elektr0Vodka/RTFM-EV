import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_mention_sound_scalar_defaults_and_roundtrip(test_db):
    settings = await AppSettingsRepository.get()
    assert settings.mention_sound_enabled is False
    assert settings.mention_sound_choice == "beep"
    assert settings.mention_sound_volume == 80
    assert settings.mention_sound_custom is None

    await AppSettingsRepository.update(
        mention_sound_enabled=True,
        mention_sound_choice="bingbong",
        mention_sound_volume=55,
    )
    updated = await AppSettingsRepository.get()
    assert updated.mention_sound_enabled is True
    assert updated.mention_sound_choice == "bingbong"
    assert updated.mention_sound_volume == 55


@pytest.mark.asyncio
async def test_mention_sound_volume_is_clamped(test_db):
    await AppSettingsRepository.update(mention_sound_volume=999)
    assert (await AppSettingsRepository.get()).mention_sound_volume == 100
    await AppSettingsRepository.update(mention_sound_volume=-10)
    assert (await AppSettingsRepository.get()).mention_sound_volume == 0
