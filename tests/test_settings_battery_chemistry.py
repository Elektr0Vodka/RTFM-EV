"""app_settings round-trips battery_chemistry (migration _108).

Global default battery chemistry used to convert millivolts to a percentage
(status bar, My Node, telemetry map layer). A contact's own
``battery_chemistry`` overrides this for that node (see
tests/test_contacts_battery_chemistry.py).
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_battery_chemistry_default_lipo(test_db):
    assert (await AppSettingsRepository.get()).battery_chemistry == "lipo"


@pytest.mark.asyncio
async def test_battery_chemistry_round_trip(test_db):
    for chemistry in ("lifepo4", "lipo_hv", "nmc", "lipo"):
        await AppSettingsRepository.update(battery_chemistry=chemistry)
        assert (await AppSettingsRepository.get()).battery_chemistry == chemistry


@pytest.mark.asyncio
async def test_battery_chemistry_coerces_unexpected_to_lipo(test_db):
    # A value outside the allowed set is coerced back to 'lipo' on read.
    await AppSettingsRepository.update(battery_chemistry="nonsense")
    assert (await AppSettingsRepository.get()).battery_chemistry == "lipo"
