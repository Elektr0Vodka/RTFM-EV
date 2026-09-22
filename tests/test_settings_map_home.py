"""app_settings round-trips the map home-view fields (migration _104).

``map_home_mode`` selects the map's initial camera on load ('auto'/'home'/
'last'); ``map_home_lat``/``map_home_lon``/``map_home_zoom`` hold the saved
home camera used in 'home' mode.
"""

import pytest

from app.repository import AppSettingsRepository
from app.routers.settings import AppSettingsUpdate, update_settings


@pytest.mark.asyncio
async def test_map_home_defaults(test_db):
    s = await AppSettingsRepository.get()
    assert s.map_home_mode == "auto"
    assert s.map_home_lat is None
    assert s.map_home_lon is None
    assert s.map_home_zoom is None


@pytest.mark.asyncio
async def test_map_home_round_trip(test_db):
    await AppSettingsRepository.update(
        map_home_mode="home",
        map_home_lat=52.1,
        map_home_lon=5.1,
        map_home_zoom=11.5,
    )
    s = await AppSettingsRepository.get()
    assert s.map_home_mode == "home"
    assert s.map_home_lat == pytest.approx(52.1)
    assert s.map_home_lon == pytest.approx(5.1)
    assert s.map_home_zoom == pytest.approx(11.5)


@pytest.mark.asyncio
async def test_map_home_mode_coerces_unexpected_to_auto(test_db):
    await AppSettingsRepository.update(map_home_mode="nonsense")
    assert (await AppSettingsRepository.get()).map_home_mode == "auto"


@pytest.mark.asyncio
async def test_router_rejects_unknown_mode(test_db):
    # An unknown mode is ignored (not persisted), leaving the default in place.
    await update_settings(AppSettingsUpdate(map_home_mode="bogus"))
    assert (await AppSettingsRepository.get()).map_home_mode == "auto"


@pytest.mark.asyncio
async def test_router_persists_home_camera(test_db):
    result = await update_settings(
        AppSettingsUpdate(
            map_home_mode="home",
            map_home_lat=48.0,
            map_home_lon=2.0,
            map_home_zoom=9,
        )
    )
    assert result.map_home_mode == "home"
    assert result.map_home_lat == pytest.approx(48.0)
    assert result.map_home_lon == pytest.approx(2.0)
    assert result.map_home_zoom == pytest.approx(9)


@pytest.mark.asyncio
async def test_router_rejects_out_of_range_coords(test_db):
    # Field validators (ge/le) reject impossible coordinates at model construction.
    with pytest.raises(ValueError):
        AppSettingsUpdate(map_home_lat=200)
    with pytest.raises(ValueError):
        AppSettingsUpdate(map_home_zoom=99)
