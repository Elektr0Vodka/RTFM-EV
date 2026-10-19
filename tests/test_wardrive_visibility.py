"""Who sees which stored wardrive data: own, my groups, all."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
from app.repository.wardrive import (
    WardriveDataRepository,
    WardriveGroupRepository,
    WardriveUserRepository,
)
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from app.wardrive.models import Obs, Track
from app.wardrive.visibility import visible_user_ids
from tests.wardrive_helpers import (
    PASSWORD,
    client_for,
    make_radio,
    obs,
    register,
    track,
    wardrive_app,
)

NOW_ISO = "2026-10-19T10:00:00.000Z"
NOW_TS = 1792404000


@pytest.fixture
async def world(test_db, monkeypatch):
    """Users A, B, C with one obs and one track each; group G = {A, B}."""
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    async with client_for(wardrive_app(router_module.router)) as client:
        ids = {}
        for name in ("A", "B", "C"):
            radio = make_radio()
            r = await register(client, username=name, radio=radio)
            uid = r.json()["user_id"]
            ids[name] = uid
            pk = radio[1]
            await WardriveDataRepository.insert_obs(uid, pk, [Obs(**obs(pk, NOW_ISO))], NOW_TS)
            await WardriveDataRepository.insert_tracks(
                uid, pk, [Track(**track(pk, NOW_ISO))], NOW_TS
            )
        gid = await WardriveGroupRepository.create("G", now=1)
        await WardriveGroupRepository.set_members(gid, [ids["A"], ids["B"]])
        client.cookies.clear()
        yield client, ids


async def _login(client, name: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/wardrive/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200


async def _seen(client) -> set[str]:
    r = await client.get(f"/api/wardrive/data?since={NOW_TS - 60}&until={NOW_TS + 60}")
    assert r.status_code == 200
    body = r.json()
    assert {t["username"] for t in body["tracks"]} == {o["username"] for o in body["obs"]}
    return {o["username"] for o in body["obs"]}


async def _set(ids, name: str, visibility: str) -> None:
    await WardriveUserRepository.update(ids[name], visibility=visibility)


async def test_own_sees_only_own(world):
    client, _ = world
    await _login(client, "A")
    assert await _seen(client) == {"A"}


async def test_groups_sees_group_mates(world):
    client, ids = world
    await _set(ids, "A", "groups")
    await _login(client, "A")
    assert await _seen(client) == {"A", "B"}


async def test_groups_without_group_is_own(world):
    client, ids = world
    await _set(ids, "C", "groups")
    await _login(client, "C")
    assert await _seen(client) == {"C"}


async def test_all_sees_everyone(world):
    client, ids = world
    await _set(ids, "A", "all")
    await _login(client, "A")
    assert await _seen(client) == {"A", "B", "C"}


async def test_visibility_change_applies_on_next_read(world):
    client, ids = world
    await _login(client, "A")
    assert await _seen(client) == {"A"}
    await _set(ids, "A", "all")
    assert await _seen(client) == {"A", "B", "C"}


async def test_data_needs_session(world):
    client, _ = world
    assert (await client.get("/api/wardrive/data")).status_code == 401


async def test_data_window_excludes_old_rows(world):
    client, _ = world
    await _login(client, "A")
    r = await client.get(f"/api/wardrive/data?since={NOW_TS + 10}&until={NOW_TS + 60}")
    assert r.json()["obs"] == []


async def test_obs_row_shape(world):
    client, _ = world
    await _login(client, "A")
    r = await client.get(f"/api/wardrive/data?since={NOW_TS - 60}&until={NOW_TS + 60}")
    [row] = r.json()["obs"]
    assert set(row) == {
        "user_id",
        "username",
        "radio_key",
        "rx_at",
        "hash",
        "packet_type",
        "route",
        "path",
        "rssi",
        "snr",
        "lat",
        "lon",
        "accuracy",
    }
    assert row["path"] == ["a1", "b2"]


async def test_visible_user_ids_all_is_none(world):
    _, ids = world
    await _set(ids, "A", "all")
    user = await WardriveUserRepository.get(ids["A"])
    assert await visible_user_ids(user) is None


async def test_query_truncates(world):
    result = await WardriveDataRepository.query(None, NOW_TS - 60, NOW_TS + 60, limit=1)
    assert result["truncated"] is True
    assert len(result["obs"]) == 1


async def test_data_window_out_of_range_is_a_validation_error(world):
    client, _ = world
    await _login(client, "A")
    for query in (f"since={2**63}", f"until={2**63}", "since=-1"):
        r = await client.get(f"/api/wardrive/data?{query}")
        assert r.status_code == 422, query
