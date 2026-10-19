"""GET /api/trackers."""

import time

import pytest

from app.models import TrackerObject, TrackerPosition
from app.repository.trackers import TrackerRepository


async def _pos(identity: str, at: int, source: str = "atak") -> None:
    await TrackerRepository.add_position(
        TrackerPosition(
            source=source,  # type: ignore[arg-type]
            identity=identity,
            lat=52.0,
            lon=5.0,
            received_at=at,
        )
    )


@pytest.mark.asyncio
async def test_latest_default(test_db, client):
    await _pos("A", 100)
    await _pos("A", 200)
    await _pos("B", 150)
    response = await client.get("/api/trackers")
    assert response.status_code == 200
    body = response.json()
    assert [(p["identity"], p["received_at"]) for p in body["positions"]] == [
        ("A", 200),
        ("B", 150),
    ]
    assert body["truncated"] is False


@pytest.mark.asyncio
async def test_trails_when_latest_false(test_db, client):
    await _pos("A", 100)
    await _pos("A", 200)
    response = await client.get("/api/trackers", params={"latest_per_identity": "false"})
    assert [p["received_at"] for p in response.json()["positions"]] == [200, 100]


@pytest.mark.asyncio
async def test_window_and_source_filter(test_db, client):
    await _pos("A", 100)
    await _pos("A", 300)
    await _pos("a1b2c3d4e5f6", 250, source="sar_fast_gps")
    response = await client.get(
        "/api/trackers",
        params={"since": 150, "until": 300, "latest_per_identity": "false", "source": "atak"},
    )
    assert [p["received_at"] for p in response.json()["positions"]] == [300]


@pytest.mark.asyncio
async def test_bad_source_rejected(test_db, client):
    response = await client.get("/api/trackers", params={"source": "nope"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_stale_objects_hidden(test_db, client):
    now = int(time.time())
    for uid, stale in (("old", now - 10), ("fresh", now + 600)):
        await TrackerRepository.upsert_object(
            TrackerObject(
                uid=uid, cot_type="a-h-G", lat=52.0, lon=5.0, stale_at=stale, received_at=now
            )
        )
    response = await client.get("/api/trackers")
    assert [o["uid"] for o in response.json()["objects"]] == ["fresh"]


@pytest.mark.asyncio
async def test_truncated_when_over_limit(test_db, client, monkeypatch):
    import app.routers.trackers as trackers_router

    monkeypatch.setattr(trackers_router, "POSITION_LIMIT", 2)
    for at in (100, 101, 102):
        await _pos("A", at)
    response = await client.get("/api/trackers", params={"latest_per_identity": "false"})
    body = response.json()
    assert [p["received_at"] for p in body["positions"]] == [102, 101]
    assert body["truncated"] is True
