"""The owner-managed broker list served to wardrive drivers."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.wardrive import sessions
from app.wardrive.brokers import MAX_CUSTOM_BROKERS
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import client_for, register, wardrive_app


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        assert (await register(client)).status_code == 200
        yield client


def custom(**over) -> dict:
    return {
        "id": "club-mqtt",
        "name": "Club MQTT",
        "url": "wss://mqtt.example.org:8084/mqtt",
        "auth": "password",
        "username": "club",
        "password": "s3cret-pass",
        "format": "packets",
        "region": "ams",
        **over,
    }


async def served(api) -> list[dict]:
    r = await api.get("/api/wardrive/config")
    assert r.status_code == 200
    return r.json()["brokers"]


async def test_built_ins_are_served_in_order(api):
    brokers = await served(api)
    assert [b["id"] for b in brokers] == ["dmc-hunter", "dmc-wardriver", "meshcore-analyzer"]
    hunter, wardriver, analyzer = brokers
    assert (hunter["url"], hunter["label"], hunter["format"]) == (
        "wss://collector1.dutchmeshcore.nl:443",
        "hunter",
        "wardrive",
    )
    assert wardriver["label"] == "wardriver"
    assert analyzer == {
        "id": "meshcore-analyzer",
        "name": "meshcore-analyzer.eu",
        "url": "wss://mqtt.meshcore-analyzer.eu:443",
        "audience": "mqtt.meshcore-analyzer.eu",
        "auth": "companion",
        "format": "packets",
        "region": "nl",
        "builtin": True,
    }
    assert all(b["builtin"] for b in brokers)
    assert all(b["audience"] for b in brokers)


async def test_the_owner_adds_a_broker_drivers_then_see(api):
    r = await api.put("/api/wardrive-admin/config", json={"brokers": [custom()]})
    assert r.status_code == 200, r.text
    assert r.json()["brokers"] == [custom()]
    club = (await served(api))[3]
    assert club["id"] == "club-mqtt"
    assert (club["username"], club["password"]) == ("club", "s3cret-pass")
    assert club["audience"] == "mqtt.example.org"
    assert club["builtin"] is False


async def test_the_analyzer_region_is_an_owner_setting(api):
    r = await api.put("/api/wardrive-admin/config", json={"analyzer_region": "be"})
    assert r.json()["analyzer_region"] == "be"
    assert (await served(api))[2]["region"] == "be"


async def test_a_companion_broker_needs_no_password(api):
    body = custom(id="club-sign", auth="companion", username=None, password=None)
    r = await api.put("/api/wardrive-admin/config", json={"brokers": [body]})
    assert r.status_code == 200, r.text
    assert "password" not in (await served(api))[3]


@pytest.mark.parametrize(
    "bad",
    [
        custom(url="http://mqtt.example.org/mqtt"),
        custom(url="wss://"),
        custom(id="dmc-hunter"),
        custom(id="Bad Id"),
        custom(password=None),
        custom(format="wardrive", label=None),
        custom(format="packets", region=None),
        custom(name=""),
    ],
)
async def test_a_bad_broker_is_refused(api, bad):
    r = await api.put("/api/wardrive-admin/config", json={"brokers": [bad]})
    assert r.status_code == 422


async def test_duplicate_ids_and_too_many_are_refused(api):
    r = await api.put("/api/wardrive-admin/config", json={"brokers": [custom(), custom()]})
    assert r.status_code == 422
    many = [custom(id=f"b-{i}") for i in range(MAX_CUSTOM_BROKERS + 1)]
    assert (await api.put("/api/wardrive-admin/config", json={"brokers": many})).status_code == 422


@pytest.mark.parametrize("region", ["", "NL!", "a" * 17])
async def test_a_bad_region_is_refused(api, region):
    r = await api.put("/api/wardrive-admin/config", json={"analyzer_region": region})
    assert r.status_code == 422


async def test_the_owner_sees_the_built_ins_and_the_custom_list(api):
    await api.put("/api/wardrive-admin/config", json={"brokers": [custom()]})
    body = (await api.get("/api/wardrive-admin/config")).json()
    assert [b["id"] for b in body["builtin_brokers"]] == [
        "dmc-hunter",
        "dmc-wardriver",
        "meshcore-analyzer",
    ]
    assert body["brokers"] == [custom()]
    assert body["analyzer_region"] == "nl"
