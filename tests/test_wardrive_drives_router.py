"""Listing and managing drives: drivers under their visibility (manage only
their own), the owner everything."""

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
UIDS = [f"{i:08x}-0000-4000-8000-{i:012x}" for i in range(1, 10)]


def iso(dt: int) -> str:
    return (
        datetime.fromtimestamp(BASE + dt, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@pytest.fixture
async def world(test_db, monkeypatch):
    """A (own, two drives), B (groups, in a group with A, one drive), C (own,
    one drive). Returns the client, user ids, radio keys and drive ids."""
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        users: dict[str, int] = {}
        radios: dict[str, str] = {}
        uid_iter = iter(UIDS)
        for name, starts in (("A", (0, 3600)), ("B", (100,)), ("C", (200,))):
            radio = make_radio()
            users[name] = (await register(client, username=name, radio=radio)).json()["user_id"]
            pk = radios[name] = radio[1]
            for start in starts:
                rows = [obs(pk, iso(start + dt), hash=f"{start + dt:016x}") for dt in (0, 60, 120)]
                r = await client.post(
                    "/api/wardrive/upload",
                    json={
                        "radio_key": pk,
                        "drive_uid": next(uid_iter),
                        "obs": rows,
                        "tracks": [track(pk, iso(start + 30), t1=iso(start + 40))],
                    },
                )
                assert r.status_code == 200
        gid = await WardriveGroupRepository.create("Team", now=1)
        await WardriveGroupRepository.set_members(gid, [users["A"], users["B"]])
        await WardriveGroupRepository.create("Other", now=1)
        await WardriveUserRepository.update(users["B"], visibility="groups")
        client.cookies.clear()
        yield client, users, radios, gid


async def login(client, name: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/wardrive/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200


async def drives(client, path: str = "/api/wardrive/drives", **params) -> list[dict]:
    r = await client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()["drives"]


async def test_a_driver_lists_own_drives_newest_first(world):
    client, users, radios, _ = world
    await login(client, "A")
    listed = await drives(client)
    assert [d["start_ts"] - BASE for d in listed] == [3600, 0]
    first = listed[0]
    assert first["user_id"] == users["A"]
    assert first["username"] == "A"
    assert first["radio_key"] == radios["A"]
    assert first["radio_name"] == "car"
    assert (first["obs"], first["tracks"]) == (3, 1)
    assert first["end_ts"] - first["start_ts"] == 120
    assert first["can_edit"] is True
    assert first["name"] is None and first["notes"] is None


async def test_groups_visibility_sees_but_cannot_edit_others(world):
    client, users, _, _ = world
    await login(client, "B")
    listed = await drives(client)
    assert {d["username"] for d in listed} == {"A", "B"}
    a_drive = next(d for d in listed if d["username"] == "A")
    assert a_drive["can_edit"] is False
    r = await client.patch(f"/api/wardrive/drives/{a_drive['id']}", json={"name": "mine now"})
    assert r.status_code == 403
    for method, path, body in (
        ("DELETE", f"/api/wardrive/drives/{a_drive['id']}", None),
        ("POST", f"/api/wardrive/drives/{a_drive['id']}/split", {"at": a_drive["start_ts"] + 30}),
    ):
        assert (await client.request(method, path, json=body)).status_code == 403
    await login(client, "A")
    assert all(d["name"] is None for d in await drives(client))


async def test_an_invisible_drive_is_not_found(world):
    client, _, _, _ = world
    await login(client, "A")
    a_id = (await drives(client))[0]["id"]
    await login(client, "C")
    assert a_id not in {d["id"] for d in await drives(client)}
    r = await client.patch(f"/api/wardrive/drives/{a_id}", json={"name": "x"})
    assert r.status_code == 404
    assert (await client.delete("/api/wardrive/drives/99999")).status_code == 404


async def test_rename_and_notes(world):
    client, _, _, _ = world
    await login(client, "A")
    drive_id = (await drives(client))[0]["id"]
    r = await client.patch(
        f"/api/wardrive/drives/{drive_id}", json={"name": "  Ochtend  ", "notes": "Via Ens"}
    )
    assert r.status_code == 200
    assert (r.json()["name"], r.json()["notes"]) == ("Ochtend", "Via Ens")
    r = await client.patch(f"/api/wardrive/drives/{drive_id}", json={"name": ""})
    assert r.json()["name"] is None
    assert r.json()["notes"] == "Via Ens"
    r = await client.patch(f"/api/wardrive/drives/{drive_id}", json={"name": "x" * 65})
    assert r.status_code == 422
    r = await client.patch(f"/api/wardrive/drives/{drive_id}", json={"notes": "x" * 1001})
    assert r.status_code == 422


async def test_delete_removes_rows(world, test_db):
    client, _, _, _ = world
    await login(client, "A")
    drive_id = (await drives(client))[0]["id"]
    r = await client.delete(f"/api/wardrive/drives/{drive_id}")
    assert r.status_code == 200
    assert r.json() == {"status": "deleted", "obs": 3, "tracks": 1}
    async with test_db.readonly() as conn:
        for table in ("wardrive_obs", "wardrive_tracks"):
            async with conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE drive_id = ?", (drive_id,)
            ) as cur:
                assert (await cur.fetchone())[0] == 0
    assert len(await drives(client)) == 1


async def test_merge_keeps_the_earliest(world):
    client, _, _, _ = world
    await login(client, "A")
    later, earlier = await drives(client)
    await client.patch(f"/api/wardrive/drives/{earlier['id']}", json={"notes": "first"})
    await client.patch(f"/api/wardrive/drives/{later['id']}", json={"notes": "second"})
    r = await client.post("/api/wardrive/drives/merge", json={"ids": [later["id"], earlier["id"]]})
    assert r.status_code == 200, r.text
    merged = r.json()
    assert merged["id"] == earlier["id"]
    assert (merged["obs"], merged["tracks"]) == (6, 2)
    assert (merged["start_ts"], merged["end_ts"]) == (earlier["start_ts"], later["end_ts"])
    assert merged["notes"] == "first\n\nsecond"
    assert [d["id"] for d in await drives(client)] == [earlier["id"]]


async def test_merge_across_users_is_refused(world):
    client, _, _, _ = world
    await login(client, "A")
    a_id = (await drives(client))[0]["id"]
    await login(client, "C")
    c_id = (await drives(client))[0]["id"]
    # Only the owner can reach both; the rule is the same for everyone.
    r = await client.post("/api/wardrive-admin/drives/merge", json={"ids": [a_id, c_id]})
    assert r.status_code == 422
    r = await client.post("/api/wardrive/drives/merge", json={"ids": [c_id]})
    assert r.status_code == 422


async def test_split_moves_the_later_rows(world):
    client, _, _, _ = world
    await login(client, "A")
    drive = (await drives(client))[1]
    r = await client.post(
        f"/api/wardrive/drives/{drive['id']}/split", json={"at": drive["start_ts"] + 60}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["drive"]["obs"], body["drive"]["tracks"]) == (1, 1)
    assert body["new_drive"]["obs"] == 2
    assert body["new_drive"]["start_ts"] == drive["start_ts"] + 60
    assert body["new_drive"]["name"] is None
    assert len(await drives(client)) == 3


@pytest.mark.parametrize("offset", [0, -10, 121, 10_000])
async def test_split_outside_the_drive_is_refused(world, offset):
    client, _, _, _ = world
    await login(client, "A")
    drive = (await drives(client))[1]
    r = await client.post(
        f"/api/wardrive/drives/{drive['id']}/split", json={"at": drive["start_ts"] + offset}
    )
    assert r.status_code == 422
    assert len(await drives(client)) == 2


async def test_admin_lists_and_filters_everything(world):
    client, users, radios, gid = world
    client.cookies.clear()
    path = "/api/wardrive-admin/drives"
    assert {d["username"] for d in await drives(client, path)} == {"A", "B", "C"}
    assert all(d["can_edit"] for d in await drives(client, path))
    assert {d["username"] for d in await drives(client, path, user_id=users["C"])} == {"C"}
    assert {d["username"] for d in await drives(client, path, group_id=gid)} == {"A", "B"}
    assert {d["username"] for d in await drives(client, path, radio_key=radios["B"])} == {"B"}
    window = await drives(client, path, since=BASE + 3000, until=BASE + 4000)
    assert [d["username"] for d in window] == ["A"]
    c_id = (await drives(client, path, user_id=users["C"]))[0]["id"]
    r = await client.patch(f"{path}/{c_id}", json={"name": "Owner named it"})
    assert r.json()["name"] == "Owner named it"
    assert (await client.get(path, params={"group_id": 999})).status_code == 404


async def test_a_driver_lists_own_groups(world):
    client, _, _, _ = world
    await login(client, "B")
    r = await client.get("/api/wardrive/groups")
    assert [g["name"] for g in r.json()["groups"]] == ["Team"]
    await login(client, "C")
    assert (await client.get("/api/wardrive/groups")).json() == {"groups": []}


async def test_a_driver_group_filter_stays_inside_visibility(world):
    client, _, _, gid = world
    await login(client, "C")
    # C may see only C: the group filter cannot widen that.
    assert await drives(client, group_id=gid) == []


async def test_a_merge_whose_notes_would_be_too_long_is_refused_and_changes_nothing(world):
    client, _, _, _ = world
    await login(client, "A")
    later, earlier = await drives(client)
    await client.patch(f"/api/wardrive/drives/{earlier['id']}", json={"notes": "a" * 600})
    await client.patch(f"/api/wardrive/drives/{later['id']}", json={"notes": "b" * 600})
    r = await client.post("/api/wardrive/drives/merge", json={"ids": [later["id"], earlier["id"]]})
    assert r.status_code == 422
    assert "1000" in r.json()["detail"]
    after = await drives(client)
    assert [(d["id"], d["obs"], d["notes"]) for d in after] == [
        (later["id"], 3, "b" * 600),
        (earlier["id"], 3, "a" * 600),
    ]


async def test_a_refused_split_changes_nothing(world):
    client, _, _, _ = world
    await login(client, "A")
    before = await drives(client)
    drive = before[1]
    r = await client.post(
        f"/api/wardrive/drives/{drive['id']}/split", json={"at": drive["start_ts"] - 10}
    )
    assert r.status_code == 422
    assert await drives(client) == before


async def test_a_split_inside_the_span_with_one_side_empty_is_refused(world):
    client, _, radios, _ = world
    await login(client, "A")
    pk = radios["A"]
    uid = "aaaaaaaa-0000-4000-8000-000000000001"
    # Receptions at 0 and 60, a track from 100 to 400: nothing starts after 100.
    rows = [obs(pk, iso(20000 + dt), hash=f"{20000 + dt:016x}") for dt in (0, 60)]
    r = await client.post(
        "/api/wardrive/upload",
        json={
            "radio_key": pk,
            "drive_uid": uid,
            "obs": rows,
            "tracks": [track(pk, iso(20100), t1=iso(20400))],
        },
    )
    assert r.status_code == 200
    drive = next(d for d in await drives(client) if d["start_ts"] == BASE + 20000)
    assert drive["end_ts"] == BASE + 20400
    r = await client.post(f"/api/wardrive/drives/{drive['id']}/split", json={"at": BASE + 20200})
    assert r.status_code == 422
    assert r.json()["detail"] == "Both parts need receptions or track"
    after = next(d for d in await drives(client) if d["id"] == drive["id"])
    assert after == drive


async def test_control_characters_are_taken_out_of_names_and_notes(world):
    client, _, _, _ = world
    await login(client, "A")
    drive_id = (await drives(client))[0]["id"]
    r = await client.patch(
        f"/api/wardrive/drives/{drive_id}",
        json={"name": "Och\x00tend\x1b", "notes": "line one\nline\ttwo\x07"},
    )
    assert r.status_code == 200
    assert (r.json()["name"], r.json()["notes"]) == ("Ochtend", "line one\nline\ttwo")
