"""Wardrive accounts end to end: challenge, register, login, add radio, sessions."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
from app.repository.wardrive import WardriveUserRepository
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import PASSWORD, client_for, wardrive_app
from tests.wardrive_helpers import make_radio as _radio
from tests.wardrive_helpers import register as _register
from tests.wardrive_helpers import signed as _signed


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    async with client_for(wardrive_app(router_module.router)) as client:
        yield client


async def test_challenge_message_is_what_the_radio_signs(api):
    _, pk = _radio()
    r = await api.post("/api/wardrive/challenge", json={"public_key": pk.lower()})
    body = r.json()
    assert bytes.fromhex(body["message_hex"]) == f"rtfm-ev-wardrive:{body['nonce']}:{pk}".encode()


async def test_challenge_rejects_bad_key(api):
    r = await api.post("/api/wardrive/challenge", json={"public_key": "abc"})
    assert r.status_code == 400


async def test_register_creates_account_with_radio(api):
    key, pk = _radio()
    r = await _register(api, radio=(key, pk))
    assert r.status_code == 200
    me = r.json()
    assert me["username"] == "mike"
    assert me["visibility"] == "own"
    assert me["radios"] == [{"public_key": pk, "name": "car"}]
    cookie = r.headers["set-cookie"]
    assert "rtfm_wardrive=" in cookie
    assert "HttpOnly" in cookie and "Path=/api/wardrive/" in cookie
    assert "samesite=strict" in cookie.lower() and "Secure" in cookie
    assert (await api.get("/api/wardrive/me")).json()["username"] == "mike"


async def test_register_rejects_short_password(api):
    assert (await _register(api, password="short")).status_code == 400


async def test_register_rejects_blank_username(api):
    assert (await _register(api, username="   ")).status_code == 400


async def test_register_rejects_unsigned_challenge(api):
    _, pk = _radio()
    other, _ = _radio()
    signed = await _signed(api, other, pk)
    r = await api.post(
        "/api/wardrive/register", json={"username": "mike", "password": PASSWORD, **signed}
    )
    assert r.status_code == 401


async def test_register_username_taken(api):
    assert (await _register(api, username="Mike")).status_code == 200
    assert (await _register(api, username="mike")).status_code == 409


async def test_register_same_radio_twice(api):
    radio = _radio()
    assert (await _register(api, username="a", radio=radio)).status_code == 200
    r = await _register(api, username="b", radio=radio)
    assert r.status_code == 409
    assert await WardriveUserRepository.get_by_username("b") is None


async def test_login_and_logout(api):
    await _register(api)
    api.cookies.clear()
    assert (await api.get("/api/wardrive/me")).status_code == 401
    r = await api.post("/api/wardrive/login", json={"username": "MIKE", "password": PASSWORD})
    assert r.status_code == 200
    assert (await api.get("/api/wardrive/me")).status_code == 200
    assert (await api.post("/api/wardrive/logout")).status_code == 204
    assert (await api.get("/api/wardrive/me")).status_code == 401


async def test_login_wrong_password(api):
    await _register(api)
    r = await api.post("/api/wardrive/login", json={"username": "mike", "password": "x" * 12})
    assert r.status_code == 401


async def test_login_unknown_user(api):
    r = await api.post("/api/wardrive/login", json={"username": "nobody", "password": PASSWORD})
    assert r.status_code == 401


async def test_login_throttled_after_five_failures(api):
    await _register(api)
    for _ in range(5):
        r = await api.post("/api/wardrive/login", json={"username": "mike", "password": "x" * 12})
        assert r.status_code == 401
    r = await api.post("/api/wardrive/login", json={"username": "mike", "password": PASSWORD})
    assert r.status_code == 429


async def test_login_disabled_user(api):
    uid = (await _register(api)).json()["user_id"]
    await WardriveUserRepository.update(uid, disabled=True)
    r = await api.post("/api/wardrive/login", json={"username": "mike", "password": PASSWORD})
    assert r.status_code == 403


async def test_add_radio_to_account(api):
    await _register(api)
    key, pk = _radio()
    signed = await _signed(api, key, pk)
    r = await api.post("/api/wardrive/radios", json={**signed, "name": "bike"})
    assert r.status_code == 200
    assert [x["public_key"] for x in r.json()["radios"]][-1] == pk


async def test_add_radio_needs_session(api):
    key, pk = _radio()
    signed = await _signed(api, key, pk)
    assert (await api.post("/api/wardrive/radios", json=signed)).status_code == 401


async def test_add_radio_taken(api):
    radio = _radio()
    await _register(api, username="a", radio=radio)
    await _register(api, username="b")
    signed = await _signed(api, *radio)
    assert (await api.post("/api/wardrive/radios", json=signed)).status_code == 409


async def test_disabled_user_session_refused_at_once(api):
    uid = (await _register(api)).json()["user_id"]
    assert (await api.get("/api/wardrive/me")).status_code == 200
    await WardriveUserRepository.update(uid, disabled=True)
    assert (await api.get("/api/wardrive/me")).status_code == 403


async def test_me_without_session(api):
    assert (await api.get("/api/wardrive/me")).status_code == 401


async def test_password_hashing_runs_off_the_event_loop(api, monkeypatch):
    """scrypt takes tens of milliseconds and 16 MiB; on the event loop it would
    stall the home radio connection for every register and login."""
    import threading

    from app.wardrive import crypto

    loop_thread = threading.get_ident()
    seen: list[int] = []
    real_hash, real_verify = crypto.hash_password, crypto.verify_password

    def spy_hash(password):
        seen.append(threading.get_ident())
        return real_hash(password)

    def spy_verify(password, stored):
        seen.append(threading.get_ident())
        return real_verify(password, stored)

    monkeypatch.setattr(router_module, "hash_password", spy_hash)
    monkeypatch.setattr(router_module, "verify_password", spy_verify)
    await _register(api)
    await api.post("/api/wardrive/login", json={"username": "mike", "password": PASSWORD})
    assert len(seen) == 2
    assert loop_thread not in seen


async def test_cookie_path_follows_the_proxy_prefix(api):
    radio = _radio()
    signed = await _signed(api, *radio)
    r = await api.post(
        "/api/wardrive/register",
        json={"username": "mike", "password": PASSWORD, **signed},
        headers={"x-forwarded-prefix": "/meshcore/"},
    )
    assert "Path=/meshcore/api/wardrive/" in r.headers["set-cookie"]


async def test_cookie_path_ignores_a_strange_prefix(api):
    radio = _radio()
    signed = await _signed(api, *radio)
    r = await api.post(
        "/api/wardrive/register",
        json={"username": "mike", "password": PASSWORD, **signed},
        headers={"x-forwarded-prefix": "/x; Domain=evil.example"},
    )
    cookie = r.headers["set-cookie"]
    assert "Path=/api/wardrive/" in cookie
    assert "evil" not in cookie


async def test_another_device_cannot_replace_or_use_my_challenge(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router)
    key, pk = _radio()
    async with client_for(app) as mine, client_for(app) as other:
        r = await mine.post("/api/wardrive/challenge", json={"public_key": pk})
        assert r.status_code == 200
        nonce = r.json()["nonce"]
        signature = key.sign(bytes.fromhex(r.json()["message_hex"])).signature.hex()
        # Someone else asks for a challenge for the same radio meanwhile.
        await other.post("/api/wardrive/challenge", json={"public_key": pk})
        body = {"public_key": pk, "nonce": nonce, "signature": signature}
        # Nor can they spend mine.
        stolen = await other.post(
            "/api/wardrive/register", json={"username": "thief", "password": PASSWORD, **body}
        )
        assert stolen.status_code == 401
        mine_again = await mine.post("/api/wardrive/challenge", json={"public_key": pk})
        nonce = mine_again.json()["nonce"]
        signature = key.sign(bytes.fromhex(mine_again.json()["message_hex"])).signature.hex()
        await other.post("/api/wardrive/challenge", json={"public_key": pk})
        r = await mine.post(
            "/api/wardrive/register",
            json={
                "username": "mike",
                "password": PASSWORD,
                "public_key": pk,
                "nonce": nonce,
                "signature": signature,
            },
        )
        assert r.status_code == 200
