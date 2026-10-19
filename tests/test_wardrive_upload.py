"""Uploading the local copy: receptions (obs) and listening intervals (tracks)."""

from __future__ import annotations

import json

import pytest

import app.routers.wardrive as router_module
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import client_for, make_radio, obs, register, track, wardrive_app


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    async with client_for(wardrive_app(router_module.router)) as client:
        yield client


async def _count(db, table: str) -> int:
    async with db.readonly() as conn:
        async with conn.execute(f"SELECT COUNT(*) FROM {table}") as cur:
            return (await cur.fetchone())[0]


async def _setup(api):
    radio = make_radio()
    await register(api, radio=radio)
    return radio[1]


async def test_upload_stores_obs_and_tracks(api, test_db):
    pk = await _setup(api)
    r = await api.post(
        "/api/wardrive/upload", json={"radio_key": pk, "obs": [obs(pk)], "tracks": [track(pk)]}
    )
    assert r.status_code == 200
    assert r.json() == {
        "accepted_obs": 1,
        "duplicate_obs": 0,
        "accepted_tracks": 1,
        "duplicate_tracks": 0,
    }
    async with test_db.readonly() as conn:
        async with conn.execute(
            "SELECT radio_key, rx_ts, hash, route, path, rssi, snr, lat, lon, accuracy, src "
            "FROM wardrive_obs"
        ) as cur:
            row = dict(await cur.fetchone())
    assert row == {
        "radio_key": pk,
        "rx_ts": 1792404000,
        "hash": "0123456789abcdef",
        "route": "F",
        "path": '["a1", "b2"]',
        "rssi": -92.0,
        "snr": 6.5,
        "lat": 52.1,
        "lon": 5.1,
        "accuracy": 4.0,
        "src": "phone",
    }


async def test_upload_same_batch_twice_counts_duplicates(api, test_db):
    pk = await _setup(api)
    body = {"radio_key": pk, "obs": [obs(pk)], "tracks": [track(pk)]}
    await api.post("/api/wardrive/upload", json=body)
    r = await api.post("/api/wardrive/upload", json=body)
    assert r.json() == {
        "accepted_obs": 0,
        "duplicate_obs": 1,
        "accepted_tracks": 0,
        "duplicate_tracks": 1,
    }
    assert await _count(test_db, "wardrive_obs") == 1
    assert await _count(test_db, "wardrive_tracks") == 1


async def test_upload_radio_key_case_insensitive(api):
    pk = await _setup(api)
    r = await api.post(
        "/api/wardrive/upload",
        json={"radio_key": pk.lower(), "obs": [obs(pk.lower())], "tracks": []},
    )
    assert r.status_code == 200
    assert r.json()["accepted_obs"] == 1


async def test_upload_needs_session(api):
    pk = await _setup(api)
    api.cookies.clear()
    r = await api.post("/api/wardrive/upload", json={"radio_key": pk, "obs": [], "tracks": []})
    assert r.status_code == 401


async def test_upload_foreign_radio_refused(api, test_db):
    other = make_radio()
    await register(api, username="other", radio=other)
    await register(api, username="mike")
    r = await api.post(
        "/api/wardrive/upload",
        json={"radio_key": other[1], "obs": [obs(other[1])], "tracks": []},
    )
    assert r.status_code == 403
    assert await _count(test_db, "wardrive_obs") == 0


async def test_upload_origin_mismatch_rejects_batch(api, test_db):
    pk = await _setup(api)
    _, stranger = make_radio()
    r = await api.post(
        "/api/wardrive/upload",
        json={
            "radio_key": pk,
            "obs": [obs(pk), obs(stranger, rx_at="2026-10-19T10:00:05.000Z")],
            "tracks": [],
        },
    )
    assert r.status_code == 422
    assert await _count(test_db, "wardrive_obs") == 0


async def test_upload_bad_position_rejected(api):
    pk = await _setup(api)
    bad = obs(pk, pos={"lat": 91, "lon": 5.1})
    r = await api.post("/api/wardrive/upload", json={"radio_key": pk, "obs": [bad], "tracks": []})
    assert r.status_code == 422


async def test_upload_bad_hash_rejected(api):
    pk = await _setup(api)
    bad = obs(pk, hash="xyz")
    r = await api.post("/api/wardrive/upload", json={"radio_key": pk, "obs": [bad], "tracks": []})
    assert r.status_code == 422


async def test_upload_bad_timestamp_rejected(api):
    pk = await _setup(api)
    bad = obs(pk, rx_at="yesterday")
    r = await api.post("/api/wardrive/upload", json={"radio_key": pk, "obs": [bad], "tracks": []})
    assert r.status_code == 422


async def test_upload_limit(api):
    pk = await _setup(api)
    many = [obs(pk, rx_at=f"2026-10-19T10:{i // 60:02d}:{i % 60:02d}.000Z") for i in range(501)]
    r = await api.post("/api/wardrive/upload", json={"radio_key": pk, "obs": many, "tracks": []})
    assert r.status_code == 422


async def test_upload_obs_without_optional_fields(api):
    pk = await _setup(api)
    minimal = obs(pk)
    for field in ("pub_at", "len", "packet_type", "route", "payload_len", "RSSI", "SNR"):
        minimal.pop(field)
    minimal["pos"] = {"lat": 52.1, "lon": 5.1}
    r = await api.post(
        "/api/wardrive/upload", json={"radio_key": pk, "obs": [minimal], "tracks": []}
    )
    assert r.status_code == 200
    assert r.json()["accepted_obs"] == 1


async def test_upload_huge_numbers_rejected(api):
    pk = await _setup(api)
    for field in ("len", "payload_len"):
        bad = obs(pk, **{field: 2**63})
        r = await api.post(
            "/api/wardrive/upload", json={"radio_key": pk, "obs": [bad], "tracks": []}
        )
        assert r.status_code == 422, field
    bad_track = track(pk, rx_count=2**63)
    r = await api.post(
        "/api/wardrive/upload", json={"radio_key": pk, "obs": [], "tracks": [bad_track]}
    )
    assert r.status_code == 422


async def test_upload_infinite_signal_rejected(api):
    pk = await _setup(api)
    for field in ("RSSI", "SNR"):
        body = json.dumps(
            {"radio_key": pk, "obs": [obs(pk, **{field: float("inf")})], "tracks": []}
        )
        r = await api.post(
            "/api/wardrive/upload", content=body, headers={"content-type": "application/json"}
        )
        assert r.status_code == 422, field
    body = json.dumps(
        {
            "radio_key": pk,
            "obs": [obs(pk, pos={"lat": 52.1, "lon": 5.1, "accuracy": float("nan")})],
            "tracks": [],
        }
    )
    r = await api.post(
        "/api/wardrive/upload", content=body, headers={"content-type": "application/json"}
    )
    assert r.status_code == 422


async def test_upload_same_instant_in_another_format_is_a_duplicate(api, test_db):
    pk = await _setup(api)
    await api.post(
        "/api/wardrive/upload",
        json={"radio_key": pk, "obs": [obs(pk)], "tracks": [track(pk)]},
    )
    r = await api.post(
        "/api/wardrive/upload",
        json={
            "radio_key": pk,
            "obs": [obs(pk, rx_at="2026-10-19T12:00:00+02:00")],
            "tracks": [track(pk, t0="2026-10-19T10:00:00Z")],
        },
    )
    assert r.json()["duplicate_obs"] == 1
    assert r.json()["duplicate_tracks"] == 1
    assert await _count(test_db, "wardrive_obs") == 1


async def test_upload_timestamp_at_the_edge_of_the_calendar_is_a_422(api):
    pk = await _setup(api)
    for rx_at in ("9999-12-31T23:59:59-01:00", "0001-01-01T00:00:00+01:00"):
        r = await api.post(
            "/api/wardrive/upload",
            json={"radio_key": pk, "obs": [obs(pk, rx_at=rx_at)], "tracks": []},
        )
        assert r.status_code == 422, rx_at
