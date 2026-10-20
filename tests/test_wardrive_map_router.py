"""The coverage map through the API: drivers under their visibility, the
owner everything, and the owner viewing as a driver or a group."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.repository.wardrive import WardriveGroupRepository, WardriveUserRepository
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import PASSWORD, client_for, make_radio, obs, register, wardrive_app

BASE = 1792404000
REAL_DIRECT = "0640774ad5974332ebc33dde2e08ef96b7b337d3358d"
WINDOW = {"since": BASE - 10, "until": BASE + 1000}


def iso(dt: int) -> str:
    return (
        datetime.fromtimestamp(BASE + dt, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@pytest.fixture
async def world(test_db, monkeypatch):
    """A (own, 2 receptions), B (groups with A, 3), C (own, 4); group Team = A, B."""
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        users: dict[str, int] = {}
        for i, (name, count) in enumerate((("A", 2), ("B", 3), ("C", 4))):
            radio = make_radio()
            users[name] = (await register(client, username=name, radio=radio)).json()["user_id"]
            pk = radio[1]
            rows = [
                obs(pk, iso(i * 100 + n), hash=f"{i * 100 + n:016x}", raw=REAL_DIRECT, path=[])
                for n in range(count)
            ]
            r = await client.post("/api/wardrive/upload", json={"radio_key": pk, "obs": rows})
            assert r.status_code == 200
        gid = await WardriveGroupRepository.create("Team", now=1)
        await WardriveGroupRepository.set_members(gid, [users["A"], users["B"]])
        await WardriveUserRepository.update(users["B"], visibility="groups")
        users["team"] = gid
        client.cookies.clear()
        yield client, users


async def login(client, name: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/wardrive/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200


async def points(client, path="/api/wardrive/map/points", **params) -> list[dict]:
    r = await client.get(path, params={**WINDOW, **params})
    assert r.status_code == 200, r.text
    return r.json()["points"]


ADMIN = "/api/wardrive-admin/map/points"


async def test_driver_points_follow_visibility(world):
    client, _ = world
    for name, count in (("A", 2), ("B", 5), ("C", 4)):
        await login(client, name)
        assert len(await points(client)) == count


async def test_driver_users_param_cannot_widen(world):
    client, users = world
    await login(client, "A")
    assert await points(client, users=str(users["C"])) == []


async def test_driver_group_filter_is_cut_to_visibility(world):
    client, users = world
    await login(client, "A")
    assert len(await points(client, group_id=users["team"])) == 2


async def test_admin_sees_everything(world):
    client, _ = world
    assert len(await points(client, ADMIN)) == 9


async def test_admin_view_as_user_matches_that_driver(world):
    client, users = world
    as_b = {p["hash"] for p in await points(client, ADMIN, as_user=users["B"])}
    await login(client, "B")
    own = {p["hash"] for p in await points(client)}
    assert as_b == own
    assert len(own) == 5


async def test_admin_view_as_group_is_union(world):
    client, users = world
    # A sees own (2), B sees the group (5): together 5.
    assert len(await points(client, ADMIN, as_group=users["team"])) == 5


async def test_admin_view_as_group_with_an_all_member_is_everything(world):
    client, users = world
    await WardriveUserRepository.update(users["A"], visibility="all")
    assert len(await points(client, ADMIN, as_group=users["team"])) == 9


@pytest.mark.parametrize("param", ["as_user", "as_group"])
async def test_view_as_unknown_is_404(world, param):
    client, _ = world
    r = await client.get(ADMIN, params={**WINDOW, param: 999})
    assert r.status_code == 404


async def test_view_as_disabled_user_works(world):
    client, users = world
    await WardriveUserRepository.update(users["C"], disabled=True)
    assert len(await points(client, ADMIN, as_user=users["C"])) == 4


@pytest.mark.parametrize("res", [5, 16])
async def test_cells_res_bounds_422(world, res):
    client, _ = world
    r = await client.get("/api/wardrive-admin/map/cells", params={**WINDOW, "res": res})
    assert r.status_code == 422


async def test_cells_route(world):
    client, users = world
    await login(client, "B")
    r = await client.get("/api/wardrive/map/cells", params={**WINDOW, "res": 9})
    assert r.status_code == 200
    assert sum(c["count"] for c in r.json()["cells"]) == 5
    r = await client.get(
        "/api/wardrive-admin/map/cells", params={**WINDOW, "res": 9, "as_user": users["A"]}
    )
    assert sum(c["count"] for c in r.json()["cells"]) == 2


async def test_drivers_roster_route(world):
    client, users = world
    await login(client, "B")
    r = await client.get("/api/wardrive/map/drivers", params=WINDOW)
    assert r.status_code == 200
    assert sorted(d["username"] for d in r.json()["drivers"]) == ["A", "B"]
    r = await client.get("/api/wardrive-admin/map/drivers", params=WINDOW)
    assert sorted(d["username"] for d in r.json()["drivers"]) == ["A", "B", "C"]
    r = await client.get(
        "/api/wardrive-admin/map/drivers", params={**WINDOW, "as_user": users["C"]}
    )
    assert [d["username"] for d in r.json()["drivers"]] == ["C"]


@pytest.mark.parametrize("kind", ["points", "cells", "drivers"])
async def test_map_routes_need_a_driver_login(world, kind):
    client, _ = world
    r = await client.get(f"/api/wardrive/map/{kind}", params=WINDOW)
    assert r.status_code == 401


async def test_bad_query_is_422(world):
    client, _ = world
    r = await client.get(ADMIN, params={**WINDOW, "bbox": "53,5,52,6"})
    assert r.status_code == 422
    r = await client.get(ADMIN, params={**WINDOW, "limit": 5001})
    assert r.status_code == 422


async def test_admin_reads_the_node_registry_for_the_map(world):
    from app.repository.contacts import ContactRepository

    client, _ = world
    await ContactRepository.upsert(
        {
            "public_key": "cc" * 32,
            "name": "Mast",
            "type": 2,
            "last_advert": 1000,
            "lat": 52.5,
            "lon": 5.5,
        }
    )
    box = {"min_lat": 52.0, "max_lat": 53.0, "min_lon": 5.0, "max_lon": 6.0}
    r = await client.get("/api/wardrive-admin/nodes", params=box)
    assert r.status_code == 200, r.text
    assert [n["name"] for n in r.json()["nodes"]] == ["Mast"]
    r = await client.get("/api/wardrive-admin/nodes", params={**box, "max_lat": 60.0})
    assert r.status_code == 422
