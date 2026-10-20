"""Node names and advertised positions served to wardrive drivers."""

from __future__ import annotations

import pytest

import app.routers.wardrive as router_module
import app.wardrive.nodes as nodes_module
from app.models import ExternalMapNode
from app.repository.contacts import ContactRepository
from app.repository.external_map import ExternalMapRepository
from app.wardrive import sessions
from app.wardrive.crypto import ChallengeStore
from tests.wardrive_helpers import client_for, register, wardrive_app

BOX = {"min_lat": 52.0, "max_lat": 53.0, "min_lon": 5.0, "max_lon": 7.0}
KEY_A = "aa" * 32
KEY_B = "bb" * 32
KEY_C = "cc" * 32


@pytest.fixture
async def api(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router)
    async with client_for(app) as client:
        yield client


@pytest.fixture
async def driver(api):
    assert (await register(api)).status_code == 200
    return api


async def _contact(key: str, **over) -> None:
    row = {"public_key": key, "name": "Node", "type": 2, "last_advert": 1000, **over}
    await ContactRepository.upsert(row)


async def _external(*nodes: ExternalMapNode) -> None:
    await ExternalMapRepository.replace_all(list(nodes), source="test", synced_at=1)


async def _nodes(client, **box) -> dict:
    r = await client.get("/api/wardrive/nodes", params={**BOX, **box})
    assert r.status_code == 200, r.text
    return r.json()


def _by_key(body: dict) -> dict[str, dict]:
    return {n["public_key"]: n for n in body["nodes"]}


async def test_needs_a_session(api):
    r = await api.get("/api/wardrive/nodes", params=BOX)
    assert r.status_code == 401


async def test_contact_serves_advertised_position_and_nothing_private(driver):
    await _contact(
        KEY_A,
        name="Toren",
        lat=52.5,
        lon=6.1,
        manual_lat=10.0,
        manual_lon=20.0,
        notes="secret note",
    )
    body = await _nodes(driver)
    node = _by_key(body)[KEY_A]
    assert node == {
        "public_key": KEY_A,
        "name": "Toren",
        "role": "Repeater",
        "lat": 52.5,
        "lon": 6.1,
        "seen": 1000,
    }
    assert "secret note" not in str(body)
    assert "notes" not in str(body)
    assert body["truncated"] is False


async def test_zero_position_is_no_position(driver):
    await _contact(KEY_A, lat=0.0, lon=0.0)
    node = _by_key(await _nodes(driver))[KEY_A]
    assert node["lat"] is None and node["lon"] is None


async def test_prefix_only_contact_is_left_out(driver):
    await _contact("aabbccddeeff")
    assert (await _nodes(driver))["nodes"] == []


async def test_contact_never_heard_advertising_is_left_out(driver):
    """A contact the owner added by hand (no advert heard) carries the owner's
    own label, not public advert data."""
    await _contact(KEY_A, name="My label", last_advert=None)
    await _contact(KEY_B, name="Zero", last_advert=0)
    assert (await _nodes(driver))["nodes"] == []


async def test_contacts_are_served_outside_the_box(driver):
    await _contact(KEY_A, lat=40.0, lon=-3.0)
    assert KEY_A in _by_key(await _nodes(driver))


async def test_external_nodes_follow_the_box(driver):
    await _external(
        ExternalMapNode(pubkey=KEY_B, name="Inside", role="Repeater", lat=52.5, lon=6.0),
        ExternalMapNode(pubkey=KEY_C, name="Outside", role="Room Server", lat=48.0, lon=2.0),
    )
    got = _by_key(await _nodes(driver))
    assert set(got) == {KEY_B}
    assert got[KEY_B]["role"] == "Repeater"


async def test_external_roles_are_mapped(driver):
    await _external(
        ExternalMapNode(pubkey=KEY_A, name="a", role="ROOM_SERVER", lat=52.5, lon=6.0),
        ExternalMapNode(pubkey=KEY_B, name="b", role="companion", lat=52.5, lon=6.0),
        ExternalMapNode(pubkey=KEY_C, name="", role="weird", lat=52.5, lon=6.0),
    )
    got = _by_key(await _nodes(driver))
    assert got[KEY_A]["role"] == "Room Server"
    assert got[KEY_B]["role"] == "Chat Node"
    assert got[KEY_C]["role"] is None
    assert got[KEY_C]["name"] is None


async def test_key_in_both_newer_name_contact_position(driver):
    await _contact(KEY_A, name="Old", lat=52.1, lon=5.1, last_advert=1000)
    await _external(
        ExternalMapNode(
            pubkey=KEY_A, name="New", role="Repeater", lat=52.9, lon=6.9, last_seen=2000
        )
    )
    node = _by_key(await _nodes(driver))[KEY_A]
    assert node["name"] == "New"
    assert (node["lat"], node["lon"]) == (52.1, 5.1)
    assert node["seen"] == 2000


async def test_key_in_both_external_position_when_contact_has_none(driver):
    await _contact(KEY_A, name="Newer", last_advert=3000)
    await _external(
        ExternalMapNode(
            pubkey=KEY_A, name="Older", role="Repeater", lat=52.9, lon=6.9, last_seen=2000
        )
    )
    node = _by_key(await _nodes(driver))[KEY_A]
    assert node["name"] == "Newer"
    assert (node["lat"], node["lon"]) == (52.9, 6.9)


async def test_box_too_big_is_rejected(driver):
    r = await driver.get("/api/wardrive/nodes", params={**BOX, "min_lat": 50, "max_lat": 55})
    assert r.status_code == 422
    r = await driver.get("/api/wardrive/nodes", params={**BOX, "min_lon": 0, "max_lon": 7})
    assert r.status_code == 422
    r = await driver.get("/api/wardrive/nodes", params={**BOX, "min_lat": 53, "max_lat": 52})
    assert r.status_code == 422


async def test_box_is_required(driver):
    r = await driver.get("/api/wardrive/nodes", params={"min_lat": 52})
    assert r.status_code == 422


async def test_capped_to_the_newest(driver, monkeypatch):
    monkeypatch.setattr(nodes_module, "MAX_NODES", 2)
    await _contact(KEY_A, last_advert=1000)
    await _contact(KEY_B, last_advert=3000)
    await _contact(KEY_C, last_advert=2000)
    body = await _nodes(driver)
    assert [n["public_key"] for n in body["nodes"]] == [KEY_B, KEY_C]
    assert body["truncated"] is True
