"""Tests for the bot list API."""

import json

import pytest

from app.repository.bot_lists import BotListRepository
from app.services.bot_lists import bot_lists

FILE = {
    "format": "rtfm-ev-bot-list",
    "version": 1,
    "name": "Shared",
    "entries": [{"name": "PingBot", "public_key": "ab" * 32}, {"name": "NewsBot"}],
}


@pytest.mark.asyncio
async def test_create_edit_enable_and_read_back(test_db, client):
    async with client:
        created = (await client.post("/api/bot-lists", json={"name": "Mine"})).json()
        list_id = created["lists"][0]["id"]

        put = await client.put(
            f"/api/bot-lists/{list_id}/entries",
            json={"entries": [{"name": "PingBot", "public_key": "AB" * 32, "note": "pong"}]},
        )
        assert put.status_code == 200

        added = await client.post(f"/api/bot-lists/{list_id}/entries", json={"name": "NewsBot"})
        assert added.status_code == 200

        state = (await client.patch(f"/api/bot-lists/{list_id}", json={"enabled": True})).json()
        assert state["effective"] == {"names": ["NewsBot", "PingBot"], "keys": ["ab" * 32]}

        entries = (await client.get(f"/api/bot-lists/{list_id}/entries")).json()
        assert entries == [
            {"name": "NewsBot", "public_key": None, "note": None},
            {"name": "PingBot", "public_key": "ab" * 32, "note": "pong"},
        ]
        assert (await client.get("/api/bot-lists")).json() == state


@pytest.mark.asyncio
async def test_import_then_export(test_db, client):
    async with client:
        response = await client.post("/api/bot-lists/import", content=json.dumps(FILE))
        assert response.status_code == 200
        imported = response.json()["lists"][0]
        assert (imported["name"], imported["source"], imported["enabled"]) == (
            "Shared",
            "local",
            False,
        )

        exported = await client.get(f"/api/bot-lists/{imported['id']}/export")
        assert exported.status_code == 200
        assert "attachment" in exported.headers["content-disposition"]
        document = exported.json()
        assert document["format"] == "rtfm-ev-bot-list"
        assert document["entries"] == [
            {"name": "NewsBot"},
            {"name": "PingBot", "public_key": "ab" * 32},
        ]


@pytest.mark.asyncio
async def test_import_refuses_a_bad_file_and_stores_nothing(test_db, client):
    async with client:
        newer = await client.post(
            "/api/bot-lists/import", content=json.dumps({**FILE, "version": 2})
        )
        assert newer.status_code == 400
        assert "unsupported bot list version 2" in newer.json()["detail"]

        broken = await client.post("/api/bot-lists/import", content="{broken")
        assert broken.status_code == 400
        assert "not valid JSON" in broken.json()["detail"]
    assert await BotListRepository.list_all() == []


@pytest.mark.asyncio
async def test_exceptions(test_db, client):
    async with client:
        state = (await client.put("/api/bot-lists/exceptions", json={"names": ["Alice"]})).json()
        assert state["exceptions"] == ["Alice"]


@pytest.mark.asyncio
async def test_error_codes(test_db, client):
    shipped = await BotListRepository.create("Shipped", "", "shipped")
    await bot_lists.refresh()
    async with client:
        assert (await client.patch("/api/bot-lists/999", json={"enabled": True})).status_code == 404
        assert (await client.get("/api/bot-lists/999/entries")).status_code == 404
        assert (await client.get("/api/bot-lists/999/export")).status_code == 404
        assert (await client.delete(f"/api/bot-lists/{shipped}")).status_code == 409
        assert (
            await client.put(f"/api/bot-lists/{shipped}/entries", json={"entries": []})
        ).status_code == 409
        assert (await client.post("/api/bot-lists", json={"name": ""})).status_code == 422
        created = await client.post("/api/bot-lists", json={"name": "Mine"})
        list_id = next(lst["id"] for lst in created.json()["lists"] if lst["source"] == "local")
        assert (
            await client.post(
                f"/api/bot-lists/{list_id}/entries", json={"name": "X", "public_key": "abc"}
            )
        ).status_code == 422
        assert (await client.delete(f"/api/bot-lists/{list_id}")).status_code == 200
