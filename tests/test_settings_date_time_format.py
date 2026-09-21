"""app_settings round-trips date_time_format (migration _101).

Controls the UI date/time format: 'auto' (follow UI language), '12h_mdy'
(12-hour + mm/dd/yyyy) or '24h_dmy' (24-hour + dd/mm/yyyy).
"""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_date_time_format_default_auto(test_db):
    assert (await AppSettingsRepository.get()).date_time_format == "auto"


@pytest.mark.asyncio
async def test_date_time_format_round_trip(test_db):
    await AppSettingsRepository.update(date_time_format="24h_dmy")
    assert (await AppSettingsRepository.get()).date_time_format == "24h_dmy"

    await AppSettingsRepository.update(date_time_format="12h_mdy")
    assert (await AppSettingsRepository.get()).date_time_format == "12h_mdy"


@pytest.mark.asyncio
async def test_date_time_format_coerces_unexpected_to_auto(test_db):
    # A value outside the allowed set is coerced back to 'auto' on read.
    await AppSettingsRepository.update(date_time_format="nonsense")
    assert (await AppSettingsRepository.get()).date_time_format == "auto"
