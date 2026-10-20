"""The owner's channel list for drivers and the driver config endpoint."""

from __future__ import annotations

import aiosqlite
import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.migrations._161_create_wardrive_config import migrate
from app.repository.channels import ChannelRepository
from app.wardrive import sessions
from app.wardrive.config import (
    MAX_HASHTAG_CHANNELS,
    default_hashtag_channels,
    hashtag_key,
    normalize_hashtag,
)
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import client_for, register, wardrive_app


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        yield client


async def _home_channels() -> None:
    """Exactly these home channels (the test database seeds its own)."""
    for channel in await ChannelRepository.get_all():
        await ChannelRepository.delete(channel.key)
    await ChannelRepository.upsert(hashtag_key("#test"), "#test", is_hashtag=True, on_radio=True)
    await ChannelRepository.upsert("00112233445566778899AABBCCDDEEFF", "#priv", is_hashtag=True)
    await ChannelRepository.upsert("8B3387E9C5CDEA6AC9E5EDBAA115CD72", "Public")


def test_normalize_hashtag():
    assert normalize_hashtag(" ##Zwolle ") == "#Zwolle"
    assert normalize_hashtag("zwolle") == "#zwolle"
    assert normalize_hashtag("#") is None
    assert normalize_hashtag("   ") is None
    assert normalize_hashtag("#" + "x" * 40) is None


def test_hashtag_key_matches_the_radio_derivation():
    assert hashtag_key("#test") == "9CD8FCF22A47333B591D96A2B848B73F"


async def test_default_list_is_hashtags_with_a_derived_key(test_db):
    await _home_channels()
    assert await default_hashtag_channels() == ["#test"]


async def test_driver_config_needs_a_session(api):
    r = await api.get("/api/wardrive/config")
    assert r.status_code == 401


async def test_driver_config_serves_the_default(api):
    await _home_channels()
    assert (await register(api)).status_code == 200
    r = await api.get("/api/wardrive/config")
    assert r.status_code == 200
    assert r.json()["hashtag_channels"] == ["#test"]


async def test_owner_list_is_normalised_sorted_and_served(api):
    await _home_channels()
    await register(api)
    r = await api.put("/api/wardrive-admin/config", json={"hashtag_channels": ["zwolle", "#test"]})
    assert r.status_code == 200
    assert r.json()["hashtag_channels"] == ["#test", "#zwolle"]
    assert r.json()["default_hashtag_channels"] == ["#test"]
    assert (await api.get("/api/wardrive-admin/config")).json()["hashtag_channels"] == [
        "#test",
        "#zwolle",
    ]
    driver = await api.get("/api/wardrive/config")
    assert driver.json()["hashtag_channels"] == ["#test", "#zwolle"]


async def test_owner_list_sorts_case_insensitively_and_keeps_spelling(api):
    r = await api.put(
        "/api/wardrive-admin/config", json={"hashtag_channels": ["#Zwolle", "#apeldoorn"]}
    )
    assert r.json()["hashtag_channels"] == ["#apeldoorn", "#Zwolle"]


async def test_owner_null_brings_back_the_default(api):
    await _home_channels()
    await register(api)
    await api.put("/api/wardrive-admin/config", json={"hashtag_channels": ["#zwolle"]})
    r = await api.put("/api/wardrive-admin/config", json={"hashtag_channels": None})
    assert r.status_code == 200
    assert r.json()["hashtag_channels"] is None
    assert (await api.get("/api/wardrive/config")).json()["hashtag_channels"] == ["#test"]


async def test_owner_rejects_a_long_name(api):
    r = await api.put("/api/wardrive-admin/config", json={"hashtag_channels": ["#" + "x" * 40]})
    assert r.status_code == 422


async def test_owner_rejects_too_many_names(api):
    names = [f"#c{i}" for i in range(MAX_HASHTAG_CHANNELS + 1)]
    r = await api.put("/api/wardrive-admin/config", json={"hashtag_channels": names})
    assert r.status_code == 422


async def test_migration_is_idempotent():
    conn = await aiosqlite.connect(":memory:")
    try:
        await migrate(conn)
        await migrate(conn)
        cols = {
            c[1]
            for c in await (await conn.execute("PRAGMA table_info(wardrive_config)")).fetchall()
        }
        assert cols == {"key", "value", "updated_at"}
    finally:
        await conn.close()


async def test_rssi_calibration_defaults_to_zero_and_reaches_drivers(api):
    assert (await register(api)).status_code == 200
    r = await api.get("/api/wardrive/config")
    assert r.json()["rssi_calibration_db"] == 0
    r = await api.put("/api/wardrive-admin/config", json={"rssi_calibration_db": 12})
    assert r.status_code == 200, r.text
    assert r.json()["rssi_calibration_db"] == 12
    assert (await api.get("/api/wardrive/config")).json()["rssi_calibration_db"] == 12


async def test_a_partial_owner_put_leaves_the_rest(api):
    await api.put("/api/wardrive-admin/config", json={"hashtag_channels": ["#zwolle"]})
    await api.put("/api/wardrive-admin/config", json={"rssi_calibration_db": -5})
    body = (await api.get("/api/wardrive-admin/config")).json()
    assert body["hashtag_channels"] == ["#zwolle"]
    assert body["rssi_calibration_db"] == -5


@pytest.mark.parametrize("value", [31, -31, 2.5])
async def test_rssi_calibration_is_bounded(api, value):
    r = await api.put("/api/wardrive-admin/config", json={"rssi_calibration_db": value})
    assert r.status_code == 422
