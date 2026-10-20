"""Drives: every upload lands in a stored drive, by the page's drive uid or,
without one, by the 10-minute gap rule."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

import app.routers.wardrive as router_module
from app.repository import AppSettingsRepository
from app.repository.wardrive import WardriveDriveRepository, WardriveUserRepository
from app.services import retention_pruner
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from app.wardrive.drives import split_by_gap
from tests.wardrive_helpers import (
    client_for,
    make_radio,
    obs,
    register,
    signed,
    track,
    wardrive_app,
)

BASE = 1792404000  # 2026-10-19T10:00:00Z
UID_A = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b"
UID_B = "1c7a4d2f-3b5e-4f90-8b2c-4d6e8fa02b3c"


def iso(dt: int) -> str:
    return (
        datetime.fromtimestamp(BASE + dt, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def o(pk: str, dt: int, n: int = 0) -> dict:
    return obs(pk, iso(dt), hash=f"{dt * 10 + n:016x}")


def tr(pk: str, dt: int) -> dict:
    return track(pk, iso(dt), t1=iso(dt + 10))


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    async with client_for(wardrive_app(router_module.router)) as client:
        yield client


async def _drives(test_db) -> list[dict]:
    async with test_db.readonly() as conn:
        async with conn.execute(
            "SELECT id, uid, radio_key, start_ts, end_ts FROM wardrive_drives ORDER BY start_ts"
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def _drive_of(test_db, table: str) -> list[int | None]:
    async with test_db.readonly() as conn:
        async with conn.execute(f"SELECT drive_id FROM {table} ORDER BY id") as cur:
            return [r[0] for r in await cur.fetchall()]


async def _up(api, pk: str, uid: str | None = None, obs_rows=(), track_rows=()):
    body: dict = {"radio_key": pk, "obs": list(obs_rows), "tracks": list(track_rows)}
    if uid is not None:
        body["drive_uid"] = uid
    return await api.post("/api/wardrive/upload", json=body)


def test_split_by_gap_uses_more_than_ten_minutes():
    assert split_by_gap([0, 600, 1201, 1300]) == [[0, 1], [2, 3]]
    assert split_by_gap([]) == []
    assert split_by_gap([5]) == [[0]]


async def test_batches_with_one_uid_make_one_drive(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    assert (await _up(api, pk, UID_A, [o(pk, 0)], [tr(pk, 5)])).status_code == 200
    assert (await _up(api, pk, UID_A, [o(pk, 120)])).status_code == 200
    drives = await _drives(test_db)
    assert len(drives) == 1
    assert drives[0]["uid"] == UID_A
    assert (drives[0]["start_ts"], drives[0]["end_ts"]) == (BASE, BASE + 120)
    assert await _drive_of(test_db, "wardrive_obs") == [drives[0]["id"]] * 2
    assert await _drive_of(test_db, "wardrive_tracks") == [drives[0]["id"]]


async def test_a_new_uid_is_a_new_drive(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    await _up(api, pk, UID_A, [o(pk, 0)])
    await _up(api, pk, UID_B, [o(pk, 60)])
    assert [d["uid"] for d in await _drives(test_db)] == [UID_A, UID_B]


async def test_a_uid_of_another_radio_is_refused(api, test_db):
    one, two = make_radio(), make_radio()
    await register(api, radio=one)
    body = await signed(api, *two)
    assert (
        await api.post("/api/wardrive/radios", json={**body, "name": "bike"})
    ).status_code == 200
    await _up(api, one[1], UID_A, [o(one[1], 0)])
    r = await _up(api, two[1], UID_A, [o(two[1], 30)])
    assert r.status_code == 422
    assert await _drive_of(test_db, "wardrive_obs") == [(await _drives(test_db))[0]["id"]]


async def test_a_malformed_uid_is_refused(api):
    radio = make_radio()
    await register(api, radio=radio)
    r = await _up(api, radio[1], "not-a-uuid", [o(radio[1], 0)])
    assert r.status_code == 422


async def test_rows_without_uid_join_by_the_gap_rule(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    await _up(api, pk, UID_A, [o(pk, 0)])
    # An old cached page: no uid, 5 minutes after the drive, then 20 minutes.
    await _up(api, pk, None, [o(pk, 300), o(pk, 1500)])
    drives = await _drives(test_db)
    assert len(drives) == 2
    assert (drives[0]["uid"], drives[0]["end_ts"]) == (UID_A, BASE + 300)
    assert (drives[1]["uid"], drives[1]["start_ts"]) == (None, BASE + 1500)
    # The derived drive keeps growing with the rows after it.
    await _up(api, pk, None, [o(pk, 1800)])
    drives = await _drives(test_db)
    assert len(drives) == 2
    assert drives[1]["end_ts"] == BASE + 1800


async def test_a_resent_batch_creates_no_drive(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    await _up(api, pk, None, [o(pk, 0)])
    r = await _up(api, pk, None, [o(pk, 0)])
    assert r.json()["duplicate_obs"] == 1
    assert len(await _drives(test_db)) == 1


async def test_deleting_a_user_deletes_their_drives(api, test_db):
    radio = make_radio()
    me = (await register(api, radio=radio)).json()
    await _up(api, radio[1], UID_A, [o(radio[1], 0)])
    await WardriveUserRepository.delete(me["user_id"])
    assert await _drives(test_db) == []


async def test_empty_drives_are_removed(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    await _up(api, pk, UID_A, [o(pk, 0)])
    await _up(api, pk, UID_B, [o(pk, 60)])
    first = (await _drives(test_db))[0]["id"]
    async with test_db.tx() as conn:
        await conn.execute("DELETE FROM wardrive_obs WHERE drive_id = ?", (first,))
    assert await WardriveDriveRepository.delete_empty() == 1
    assert [d["uid"] for d in await _drives(test_db)] == [UID_B]


async def test_retention_prune_removes_drives_it_emptied(api, test_db):
    radio = make_radio()
    await register(api, radio=radio)
    pk = radio[1]
    await _up(api, pk, UID_A, [o(pk, 0)], [tr(pk, 0)])
    await AppSettingsRepository.update(wardrive_retention_days=30)
    result = await retention_pruner.prune_once(now=BASE + 31 * 86400)
    assert result["wardrive_drives"] == 1
    assert await _drives(test_db) == []
