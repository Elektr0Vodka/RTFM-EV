"""Reports through the API: drivers under their visibility, the owner everything."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.repository.wardrive import WardriveGroupRepository, WardriveUserRepository
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import (
    PASSWORD,
    client_for,
    make_radio,
    obs,
    register,
    track,
    wardrive_app,
)

BASE = 1792404000


def iso(dt: int) -> str:
    return (
        datetime.fromtimestamp(BASE + dt, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@pytest.fixture
async def world(test_db, monkeypatch):
    """A (own, 2 receptions), B (groups with A, 3 receptions), C (own, 4)."""
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        users: dict[str, int] = {}
        for i, (name, count) in enumerate((("A", 2), ("B", 3), ("C", 4))):
            radio = make_radio()
            users[name] = (await register(client, username=name, radio=radio)).json()["user_id"]
            pk = radio[1]
            rows = [obs(pk, iso(i * 100 + n), hash=f"{i * 100 + n:016x}") for n in range(count)]
            r = await client.post(
                "/api/wardrive/upload",
                json={
                    "radio_key": pk,
                    "drive_uid": f"0000000{i}-0000-4000-8000-000000000000",
                    "obs": rows,
                    "tracks": [track(pk, iso(i * 100), t1=iso(i * 100 + 10))],
                },
            )
            assert r.status_code == 200
        gid = await WardriveGroupRepository.create("Team", now=1)
        await WardriveGroupRepository.set_members(gid, [users["A"], users["B"]])
        await WardriveUserRepository.update(users["B"], visibility="groups")
        client.cookies.clear()
        yield client, users


async def login(client, name: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/wardrive/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200


WINDOW = {"since": BASE - 10, "until": BASE + 1000}


async def receptions(client, path="/api/wardrive/report", **params) -> int:
    r = await client.get(path, params={**WINDOW, **params})
    assert r.status_code == 200, r.text
    return r.json()["summary"]["receptions"]


async def test_own_visibility_reports_own_rows(world):
    client, _ = world
    await login(client, "A")
    assert await receptions(client) == 2


async def test_groups_visibility_includes_the_group(world):
    client, _ = world
    await login(client, "B")
    assert await receptions(client) == 5


async def test_a_user_filter_cannot_widen_visibility(world):
    client, users = world
    await login(client, "A")
    assert await receptions(client, user_id=users["C"]) == 0


async def test_an_invisible_drive_is_not_found(world):
    client, _ = world
    await login(client, "C")
    r = await client.get("/api/wardrive/drives")
    c_drive = r.json()["drives"][0]["id"]
    await login(client, "A")
    r = await client.get("/api/wardrive/report", params={"drive": c_drive})
    assert r.status_code == 404


async def test_picked_drives_ignore_the_window(world):
    client, _ = world
    await login(client, "B")
    r = await client.get("/api/wardrive/drives")
    ids = [d["id"] for d in r.json()["drives"]]
    r = await client.get("/api/wardrive/report", params={"drive": ids, "since": 0, "until": 1})
    assert r.json()["summary"]["receptions"] == 5
    assert sorted(r.json()["scope"]["drive_ids"]) == sorted(ids)


async def test_the_owner_reports_on_everyone(world):
    client, users = world
    client.cookies.clear()
    assert await receptions(client, "/api/wardrive-admin/report") == 9
    assert await receptions(client, "/api/wardrive-admin/report", user_id=users["C"]) == 4


async def test_resolution_is_checked(world):
    client, _ = world
    await login(client, "A")
    r = await client.get("/api/wardrive/report", params={**WINDOW, "res": 12})
    assert r.status_code == 422
    r = await client.get("/api/wardrive/report", params={**WINDOW, "res": 11})
    assert r.json()["scope"]["res"] == 11


async def test_a_report_needs_a_session(world):
    client, _ = world
    client.cookies.clear()
    assert (await client.get("/api/wardrive/report")).status_code == 401


async def test_the_report_is_built_off_the_event_loop(world, monkeypatch):
    import app.wardrive.drives as drives_module

    seen = []
    real = drives_module.asyncio.to_thread

    async def spy(fn, *args, **kwargs):
        seen.append(fn.__name__)
        return await real(fn, *args, **kwargs)

    monkeypatch.setattr(drives_module.asyncio, "to_thread", spy)
    client, _ = world
    await login(client, "A")
    assert await receptions(client) == 2
    assert "build_report" in seen
    r = await client.get("/api/wardrive/export/cells.csv", params=WINDOW)
    assert r.status_code == 200
    assert seen.count("build_report") == 2


async def test_raw_frames_are_read_only_for_zero_hop_adverts(world):
    from app.repository.wardrive import WardriveDriveRepository

    obs, _, _ = await WardriveDriveRepository.rows_for_report(
        None, None, BASE - 10, BASE + 1000, None, 100
    )
    assert obs and all(o["raw"] is None for o in obs)


async def test_a_cut_report_keeps_one_time_window(world, monkeypatch):
    import app.wardrive.drives as drives_module

    monkeypatch.setattr(drives_module, "REPORT_MAX_ROWS", 3)
    client, _ = world
    client.cookies.clear()
    r = await client.get("/api/wardrive-admin/report", params=WINDOW)
    body = r.json()
    assert body["truncated"] is True
    assert body["scope"]["cut_ts"] is not None
    assert body["summary"]["first_ts"] >= body["scope"]["cut_ts"]
