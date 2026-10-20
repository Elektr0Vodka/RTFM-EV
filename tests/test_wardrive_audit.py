"""Wardrive management: last login, the audit log and the owner setting a
driver's password."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
import app.wardrive.audit as audit_module
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import PASSWORD, client_for, make_radio, register, wardrive_app


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        r = await register(client, username="anna", radio=make_radio())
        assert r.status_code == 200
        client.cookies.clear()
        yield client, r.json()["user_id"]


async def login(client, password: str = PASSWORD, name: str = "anna"):
    client.cookies.clear()
    return await client.post("/api/wardrive/login", json={"username": name, "password": password})


async def audit(client, **params) -> list[dict]:
    r = await client.get("/api/wardrive-admin/audit", params=params)
    assert r.status_code == 200, r.text
    return r.json()["entries"]


async def test_login_sets_last_login_and_is_logged(api):
    client, uid = api
    assert (await login(client)).status_code == 200
    users = (await client.get("/api/wardrive-admin/users")).json()
    assert users[0]["last_login_at"] is not None
    entries = await audit(client)
    assert entries[0]["action"] == "login"
    assert entries[0]["actor_kind"] == "driver"
    assert entries[0]["actor_id"] == uid
    assert entries[0]["actor_name"] == "anna"


async def test_refused_login_is_logged_without_the_password(api):
    client, _ = api
    assert (await login(client, password="wrong password!")).status_code == 401
    entry = (await audit(client))[0]
    assert entry["action"] == "login_refused"
    assert entry["detail"] == {"username": "anna"}
    assert "wrong password!" not in str(entry)


async def test_registration_is_logged(api):
    client, uid = api
    actions = [e["action"] for e in await audit(client)]
    assert "register" in actions


async def test_owner_sets_a_password(api):
    client, uid = api
    assert (await login(client)).status_code == 200
    old_cookie = dict(client.cookies)
    r = await client.post(
        f"/api/wardrive-admin/users/{uid}/password", json={"password": "a new secret"}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "set"}
    # The driver's sessions ended.
    client.cookies.clear()
    client.cookies.update(old_cookie)
    assert (await client.get("/api/wardrive/me")).status_code == 401
    assert (await login(client)).status_code == 401
    assert (await login(client, password="a new secret")).status_code == 200
    entry = next(e for e in await audit(client) if e["action"] == "password_set")
    assert entry["actor_kind"] == "owner"
    assert entry["target_id"] == str(uid)
    assert "a new secret" not in str(entry)


async def test_password_rules(api):
    client, uid = api
    r = await client.post(f"/api/wardrive-admin/users/{uid}/password", json={"password": "short"})
    assert r.status_code == 422
    r = await client.post(
        "/api/wardrive-admin/users/999/password", json={"password": "long enough!"}
    )
    assert r.status_code == 404


async def test_owner_changes_are_logged(api):
    client, uid = api
    await client.patch(f"/api/wardrive-admin/users/{uid}", json={"visibility": "all"})
    g = (await client.post("/api/wardrive-admin/groups", json={"name": "Team"})).json()
    await client.put(f"/api/wardrive-admin/groups/{g['id']}/members", json={"user_ids": [uid]})
    actions = [e["action"] for e in await audit(client)]
    assert actions[:3] == ["group_members", "group_create", "user_update"]
    entry = next(e for e in await audit(client) if e["action"] == "user_update")
    assert entry["detail"] == {"visibility": "all"}


async def test_audit_is_newest_first_and_limited(api):
    client, _ = api
    for _ in range(3):
        await login(client)
    entries = await audit(client, limit=2)
    assert len(entries) == 2
    assert entries[0]["id"] > entries[1]["id"]


async def test_the_log_keeps_its_newest_rows(api, monkeypatch):
    client, _ = api
    monkeypatch.setattr(audit_module, "MAX_ROWS", 3)
    for _ in range(5):
        await login(client)
    assert len(await audit(client, limit=500)) == 3


async def test_drive_edits_are_logged(api):
    from tests.wardrive_helpers import obs

    client, uid = api
    radio = make_radio()
    client.cookies.clear()
    r = await register(client, username="bert", radio=radio)
    bert = r.json()["user_id"]
    pk = radio[1]
    up = await client.post(
        "/api/wardrive/upload",
        json={"radio_key": pk, "obs": [obs(pk, "2026-10-19T10:00:00.000Z", hash="0" * 16)]},
    )
    assert up.status_code == 200
    drive = (await client.get("/api/wardrive/drives", params={"since": 0})).json()["drives"][0]
    await client.patch(f"/api/wardrive/drives/{drive['id']}", json={"name": "Ochtend"})
    entry = next(e for e in await audit(client) if e["action"] == "drive_update")
    assert entry["actor_id"] == bert
    assert entry["target_id"] == str(drive["id"])
