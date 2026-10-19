"""TrackerRepository: ATAK / SAR tracker positions and ATAK map objects."""

import pytest

from app.models import TrackerObject, TrackerPosition
from app.repository.trackers import TrackerRepository


def _pos(identity: str, at: int, source: str = "atak", lat: float = 52.0) -> TrackerPosition:
    return TrackerPosition(
        source=source,  # type: ignore[arg-type]
        identity=identity,
        display_name=identity,
        lat=lat,
        lon=5.0,
        received_at=at,
    )


def _obj(uid: str, at: int, stale_at: int | None, remarks: str = "r") -> TrackerObject:
    return TrackerObject(
        uid=uid,
        cot_type="a-h-G",
        callsign="OP",
        lat=52.0,
        lon=5.0,
        remarks=remarks,
        stale_at=stale_at,
        sender="JSTR25",
        channel_key="AB",
        received_at=at,
    )


@pytest.mark.asyncio
async def test_add_position_returns_id_and_roundtrips(test_db):
    pos = _pos("JESTER_25", 100).model_copy(
        update={"team": "Cyan", "alt_m": 12.0, "speed_mps": 1.5, "battery_pct": 80}
    )
    new_id = await TrackerRepository.add_position(pos)
    assert new_id > 0
    rows = await TrackerRepository.positions(None, None, False, None, 10)
    assert len(rows) == 1
    assert rows[0].id == new_id
    assert rows[0].team == "Cyan"
    assert rows[0].battery_pct == 80
    assert rows[0].speed_mps == 1.5


@pytest.mark.asyncio
async def test_latest_per_identity(test_db):
    await TrackerRepository.add_position(_pos("A", 100, lat=51.0))
    await TrackerRepository.add_position(_pos("A", 300, lat=53.0))
    await TrackerRepository.add_position(_pos("A", 200, lat=52.0))
    await TrackerRepository.add_position(_pos("B", 150))

    latest = await TrackerRepository.positions(None, None, True, None, 10)
    assert [(p.identity, p.received_at) for p in latest] == [("A", 300), ("B", 150)]
    assert latest[0].lat == 53.0

    trail = await TrackerRepository.positions(None, None, False, None, 10)
    assert [p.received_at for p in trail] == [300, 200, 150, 100]


@pytest.mark.asyncio
async def test_positions_window_and_source(test_db):
    await TrackerRepository.add_position(_pos("A", 100))
    await TrackerRepository.add_position(_pos("A", 200))
    await TrackerRepository.add_position(_pos("a1b2c3d4e5f6", 250, source="sar_fast_gps"))

    window = await TrackerRepository.positions(100, 200, False, None, 10)
    assert [p.received_at for p in window] == [200]  # since is exclusive, until inclusive

    sar = await TrackerRepository.positions(None, None, False, "sar_fast_gps", 10)
    assert [p.identity for p in sar] == ["a1b2c3d4e5f6"]


@pytest.mark.asyncio
async def test_same_identity_other_source_kept_apart(test_db):
    await TrackerRepository.add_position(_pos("X", 100, source="atak"))
    await TrackerRepository.add_position(_pos("X", 200, source="sar_fast_gps"))
    latest = await TrackerRepository.positions(None, None, True, None, 10)
    assert len(latest) == 2


@pytest.mark.asyncio
async def test_positions_limit(test_db):
    for at in range(100, 105):
        await TrackerRepository.add_position(_pos("A", at))
    rows = await TrackerRepository.positions(None, None, False, None, 3)
    assert [p.received_at for p in rows] == [104, 103, 102]


@pytest.mark.asyncio
async def test_upsert_object_replaces(test_db):
    await TrackerRepository.upsert_object(_obj("u-1", 100, 1000, remarks="old"))
    await TrackerRepository.upsert_object(_obj("u-1", 200, 2000, remarks="new"))
    rows = await TrackerRepository.objects(None, None, True, 0)
    assert len(rows) == 1
    assert rows[0].remarks == "new"
    assert rows[0].received_at == 200


@pytest.mark.asyncio
async def test_objects_hide_stale(test_db):
    await TrackerRepository.upsert_object(_obj("old", 100, 500))
    await TrackerRepository.upsert_object(_obj("fresh", 100, 5000))
    await TrackerRepository.upsert_object(_obj("nostale", 100, None))

    shown = await TrackerRepository.objects(None, None, False, 1000)
    assert {o.uid for o in shown} == {"fresh", "nostale"}
    every = await TrackerRepository.objects(None, None, True, 1000)
    assert {o.uid for o in every} == {"old", "fresh", "nostale"}
