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


async def _contact(test_db, key: str, name: str, lat: float, lon: float) -> None:
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO contacts (public_key, name, type, lat, lon, last_advert) "
            "VALUES (?, ?, 2, ?, ?, ?)",
            (key, name, lat, lon, NOW_TS),
        )


async def test_admin_data_carries_every_stored_field_and_who_was_heard(api, test_db):
    from tests.wardrive_helpers import track

    radio = make_radio()
    pk = radio[1]
    await register(api, username="anna", radio=radio)
    await _contact(test_db, "b2" + "00" * 31, "Toren", 52.1, 5.1)
    r = await api.post(
        "/api/wardrive/upload",
        json={
            "radio_key": pk,
            "drive_uid": "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b",
            "obs": [obs(pk, NOW_ISO)],
            "tracks": [track(pk, NOW_ISO)],
        },
    )
    assert r.status_code == 200
    drive_id = (await api.get("/api/wardrive/drives")).json()["drives"][0]["id"]
    await api.patch(f"/api/wardrive/drives/{drive_id}", json={"name": "Ochtend"})
    body = (
        await api.get(
            "/api/wardrive-admin/data", params={"since": NOW_TS - 60, "until": NOW_TS + 60}
        )
    ).json()
    [o] = body["obs"]
    assert o["drive_id"] == drive_id
    assert o["drive_name"] == "Ochtend"
    assert o["radio_name"] == "car"
    assert o["pub_at"] == "2026-10-19T10:00:01.000Z"
    assert o["src"] == "phone"
    assert (o["len"], o["payload_len"]) == (6, 4)
    assert isinstance(o["uploaded_at"], int)
    assert (o["heard_id"], o["heard_name"], o["heard_guess"]) == ("b2", "Toren", True)
    assert "raw" not in o
    [t] = body["tracks"]
    assert t["drive_id"] == drive_id
    assert t["drive_name"] == "Ochtend"


async def test_live_lists_the_drivers_who_uploaded_lately(api):
    from datetime import UTC, datetime

    from tests.wardrive_helpers import track

    radio = make_radio()
    pk = radio[1]
    await register(api, username="anna", radio=radio)
    now = int(datetime.now(UTC).timestamp())

    def iso(ts: int) -> str:
        return (
            datetime.fromtimestamp(ts, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    r = await api.post(
        "/api/wardrive/upload",
        json={
            "radio_key": pk,
            "drive_uid": "1c7a4d2f-3b5e-4f90-8b2c-4d6e8fa02b3c",
            "obs": [obs(pk, iso(now - 30), hash="00000000000000a1", RSSI=-97, SNR=3.5)],
            "tracks": [track(pk, iso(now - 20), t1=iso(now - 10), lat=52.3, lon=5.3)],
        },
    )
    assert r.status_code == 200
    # bert stored rows long ago: not live.
    await _user(api, "bert")
    live = (await api.get("/api/wardrive-admin/live")).json()
    assert live["window_s"] == 600
    [d] = live["drivers"]
    assert (d["username"], d["radio_key"], d["radio_name"]) == ("anna", pk, "car")
    # The newest row in time is the track that ended 10 s ago.
    assert (d["lat"], d["lon"]) == (52.3, 5.3)
    assert d["last_ts"] == now - 10
    assert (d["last_rssi"], d["last_snr"]) == (-97, 3.5)
    assert d["receptions"] == 1
    assert d["drive_id"] is not None
    assert d["last_upload_at"] >= now - 5
