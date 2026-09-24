"""app_settings round-trips the per-class retention settings (migration _105)."""

import pytest
from pydantic import ValidationError

from app.models import RETENTION_DEFAULTS
from app.repository import AppSettingsRepository
from app.routers.settings import AppSettingsUpdate, update_settings


@pytest.mark.asyncio
async def test_defaults_match_pre_migration_behavior(test_db):
    s = await AppSettingsRepository.get()
    for name, default in RETENTION_DEFAULTS.items():
        assert getattr(s, name) == default, name
    assert s.telemetry_retention_days == 30
    assert s.telemetry_max_rows_per_node == 1000
    assert s.link_signal_retention_days == 30
    assert s.advert_paths_per_contact == 10
    assert s.message_retention_days == 0


@pytest.mark.asyncio
async def test_round_trip_via_router(test_db):
    result = await update_settings(
        AppSettingsUpdate(
            retention_prune_interval_hours=6,
            telemetry_retention_days=0,
            telemetry_max_rows_per_node=0,
            link_signal_retention_days=90,
            advert_paths_per_contact=25,
            noise_floor_retention_days=365,
            battery_retention_days=180,
            airtime_retention_days=90,
            message_retention_days=730,
            advert_retention_days=0,
            raw_packet_retention_days=3650,
        )
    )
    assert result.retention_prune_interval_hours == 6
    s = await AppSettingsRepository.get()
    assert (
        s.retention_prune_interval_hours,
        s.telemetry_retention_days,
        s.telemetry_max_rows_per_node,
        s.link_signal_retention_days,
        s.advert_paths_per_contact,
        s.noise_floor_retention_days,
        s.battery_retention_days,
        s.airtime_retention_days,
        s.message_retention_days,
        s.advert_retention_days,
        s.raw_packet_retention_days,
    ) == (6, 0, 0, 90, 25, 365, 180, 90, 730, 0, 3650)


@pytest.mark.asyncio
async def test_repository_update_leaves_other_fields_alone(test_db):
    await AppSettingsRepository.update(message_retention_days=30)
    s = await AppSettingsRepository.get()
    assert s.message_retention_days == 30
    assert s.telemetry_retention_days == 30


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("retention_prune_interval_hours", 0),
        ("retention_prune_interval_hours", 169),
        ("telemetry_retention_days", -1),
        ("telemetry_retention_days", 3651),
        ("telemetry_max_rows_per_node", -1),
        ("telemetry_max_rows_per_node", 100001),
        ("link_signal_retention_days", -1),
        ("advert_paths_per_contact", 0),
        ("advert_paths_per_contact", 101),
        ("noise_floor_retention_days", -1),
        ("battery_retention_days", 3651),
        ("airtime_retention_days", -1),
        ("message_retention_days", -1),
        ("raw_packet_retention_days", 3651),
    ],
)
def test_router_rejects_out_of_range(field, bad):
    with pytest.raises(ValidationError):
        AppSettingsUpdate(**{field: bad})


@pytest.mark.asyncio
async def test_link_edge_retention_default_and_update(test_db):
    s = await AppSettingsRepository.get()
    assert s.link_edge_retention_days == 365
    s = await AppSettingsRepository.update(link_edge_retention_days=90)
    assert s.link_edge_retention_days == 90
