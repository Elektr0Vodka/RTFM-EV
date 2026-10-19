"""The owner's wardrive admin: users, radios, groups, status and all data."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.config import Settings
from app.repository.wardrive import (
    WardriveDataRepository,
    WardriveUserRepository,
)
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from app.wardrive.models import Obs
from tests.wardrive_helpers import client_for, make_radio, obs, register, wardrive_app

NOW_ISO = "2026-10-19T10:00:00.000Z"
NOW_TS = 1792404000


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        yield client


async def _user(api, name: str) -> tuple[int, str]:
    radio = make_radio()
    r = await register(api, username=name, radio=radio)
    uid = r.json()["user_id"]
    pk = radio[1]
    await WardriveDataRepository.insert_obs(uid, pk, [Obs(**obs(pk, NOW_ISO))], NOW_TS)
    return uid, pk


async def test_users_list_hides_password_hash(api):
    await _user(api, "mike")
    r = await api.get("/api/wardrive-admin/users")
    assert r.status_code == 200
    [row] = r.json()
    assert "password_hash" not in row
    assert row["username"] == "mike"
    assert row["obs_count"] == 1
    assert len(row["radios"]) == 1


async def test_patch_visibility(api):
    uid, _ = await _user(api, "mike")
    r = await api.patch(f"/api/wardrive-admin/users/{uid}", json={"visibility": "groups"})
    assert r.status_code == 200
    [row] = (await api.get("/api/wardrive-admin/users")).json()
    assert row["visibility"] == "groups"


async def test_patch_rejects_unknown_visibility(api):
    uid, _ = await _user(api, "mike")
    r = await api.patch(f"/api/wardrive-admin/users/{uid}", json={"visibility": "everyone"})
    assert r.status_code == 422


async def test_patch_unknown_user_404(api):
    r = await api.patch("/api/wardrive-admin/users/999", json={"disabled": True})
    assert r.status_code == 404


async def test_disable_ends_sessions(api, test_db):
    uid, _ = await _user(api, "mike")
    assert (await api.get("/api/wardrive/me")).status_code == 200
    r = await api.patch(f"/api/wardrive-admin/users/{uid}", json={"disabled": True})
    assert r.status_code == 200
    async with test_db.readonly() as conn:
        async with conn.execute(
            "SELECT COUNT(*) FROM wardrive_sessions WHERE user_id = ?", (uid,)
        ) as cur:
            assert (await cur.fetchone())[0] == 0
    assert (await api.get("/api/wardrive/me")).status_code == 401


async def test_delete_user(api):
    uid, _ = await _user(api, "mike")
    assert (await api.delete(f"/api/wardrive-admin/users/{uid}")).json() == {"status": "deleted"}
    assert await WardriveUserRepository.get(uid) is None
    assert (await api.delete(f"/api/wardrive-admin/users/{uid}")).status_code == 404


async def test_delete_radio(api):
    uid, pk = await _user(api, "mike")
    assert (await api.delete(f"/api/wardrive-admin/radios/{pk.lower()}")).json() == {
        "status": "deleted"
    }
    [row] = (await api.get("/api/wardrive-admin/users")).json()
    assert row["radios"] == []
    assert (await api.delete(f"/api/wardrive-admin/radios/{pk}")).status_code == 404


async def test_group_crud_and_members(api):
    a, _ = await _user(api, "a")
    b, _ = await _user(api, "b")
    r = await api.post("/api/wardrive-admin/groups", json={"name": "crew"})
    assert r.status_code == 200
    gid = r.json()["id"]
    assert (await api.post("/api/wardrive-admin/groups", json={"name": "CREW"})).status_code == 409
    r = await api.patch(f"/api/wardrive-admin/groups/{gid}", json={"name": "team"})
    assert r.status_code == 200
    r = await api.put(f"/api/wardrive-admin/groups/{gid}/members", json={"user_ids": [a, b]})
    assert r.status_code == 200
    [group] = (await api.get("/api/wardrive-admin/groups")).json()
    assert group == {
        "id": gid,
        "name": "team",
        "created_at": group["created_at"],
        "member_ids": [a, b],
    }
    assert (await api.delete(f"/api/wardrive-admin/groups/{gid}")).json() == {"status": "deleted"}
    assert (await api.get("/api/wardrive-admin/groups")).json() == []


async def test_group_blank_name_rejected(api):
    assert (await api.post("/api/wardrive-admin/groups", json={"name": "  "})).status_code == 422


async def test_members_unknown_user_422(api):
    gid = (await api.post("/api/wardrive-admin/groups", json={"name": "crew"})).json()["id"]
    r = await api.put(f"/api/wardrive-admin/groups/{gid}/members", json={"user_ids": [999]})
    assert r.status_code == 422


async def test_members_unknown_group_404(api):
    r = await api.put("/api/wardrive-admin/groups/999/members", json={"user_ids": []})
    assert r.status_code == 404


async def test_admin_data_sees_all_and_filters_by_group(api):
    a, _ = await _user(api, "a")
    await _user(api, "b")
    window = f"since={NOW_TS - 60}&until={NOW_TS + 60}"
    r = await api.get(f"/api/wardrive-admin/data?{window}")
    assert {o["username"] for o in r.json()["obs"]} == {"a", "b"}
    gid = (await api.post("/api/wardrive-admin/groups", json={"name": "crew"})).json()["id"]
    await api.put(f"/api/wardrive-admin/groups/{gid}/members", json={"user_ids": [a]})
    r = await api.get(f"/api/wardrive-admin/data?{window}&group_id={gid}")
    assert {o["username"] for o in r.json()["obs"]} == {"a"}
    r = await api.get(f"/api/wardrive-admin/data?{window}&user_id={a}")
    assert {o["username"] for o in r.json()["obs"]} == {"a"}


async def test_status_reports_unprotected(api, monkeypatch):
    monkeypatch.setattr(admin_module, "settings", Settings(wardrive=True))
    r = await api.get("/api/wardrive-admin/status")
    assert r.json() == {"active": True, "unprotected": True, "page_path": "/wardrive/"}


async def test_status_reports_protected(api, monkeypatch):
    monkeypatch.setattr(
        admin_module,
        "settings",
        Settings(wardrive=True, basic_auth_username="o", basic_auth_password="p"),
    )
    r = await api.get("/api/wardrive-admin/status")
    assert r.json()["unprotected"] is False


async def test_enable_keeps_sessions(api):
    uid, _ = await _user(api, "mike")
    await api.patch(f"/api/wardrive-admin/users/{uid}", json={"disabled": False})
    assert (await api.get("/api/wardrive/me")).status_code == 200


async def test_admin_data_empty_group(api):
    await _user(api, "a")
    gid = (await api.post("/api/wardrive-admin/groups", json={"name": "empty"})).json()["id"]
    r = await api.get(
        f"/api/wardrive-admin/data?since={NOW_TS - 60}&until={NOW_TS + 60}&group_id={gid}"
    )
    assert r.status_code == 200
    assert r.json() == {"obs": [], "tracks": [], "truncated": False}


async def test_admin_data_window_out_of_range_is_a_validation_error(api):
    for query in (f"since={2**63}", f"until={2**63}", "since=-1"):
        r = await api.get(f"/api/wardrive-admin/data?{query}")
        assert r.status_code == 422, query
