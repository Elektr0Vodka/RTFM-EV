"""Tests for the bot list API."""

import json

import pytest

from app.bot_lists.format import validate_bot_list
from app.repository.bot_lists import BotListRepository
from app.services import bot_lists as service_module
from app.services.bot_list_fetch import BotListFetchError
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
            {"name": "NewsBot", "public_key": None, "note": None, "forward_reviewed": True},
            {
                "name": "PingBot",
                "public_key": "ab" * 32,
                "note": "pong",
                "forward_reviewed": True,
            },
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


@pytest.mark.asyncio
async def test_create_names_the_new_list_even_when_it_does_not_sort_first(test_db, client):
    shipped = await BotListRepository.create("Aaa shipped", "", "shipped")
    await BotListRepository.create("Aaa other", "", "local")
    await bot_lists.refresh()
    async with client:
        created = (await client.post("/api/bot-lists", json={"name": "Zzz mine"})).json()
    made = next(lst for lst in created["lists"] if lst["id"] == created["created_id"])
    assert made["name"] == "Zzz mine"
    assert created["created_id"] != shipped
    assert created["lists"][0]["id"] == shipped


SUB_URL = "https://example.org/lists/bots.json"


@pytest.fixture
def remote(monkeypatch):
    box = {"result": validate_bot_list(FILE)}

    async def fake_fetch(url, **_kwargs):
        if isinstance(box["result"], Exception):
            raise box["result"]
        return box["result"]

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    return box


@pytest.mark.asyncio
async def test_preview_subscribe_and_refresh(test_db, client, remote):
    async with client:
        preview = await client.post("/api/bot-lists/preview-url", json={"url": SUB_URL})
        assert preview.status_code == 200
        assert preview.json()["name"] == "Shared"
        assert [e["name"] for e in preview.json()["entries"]] == ["PingBot", "NewsBot"]
        assert (await client.get("/api/bot-lists")).json()["lists"] == []

        subscribed = (await client.post("/api/bot-lists/subscribe", json={"url": SUB_URL})).json()
        list_id = subscribed["created_id"]
        assert subscribed["lists"][0]["source"] == "url"

        again = await client.post("/api/bot-lists/subscribe", json={"url": SUB_URL})
        assert again.status_code == 400
        assert again.json()["detail"] == "already_subscribed"

        remote["result"] = BotListFetchError("fetch_failed", "ConnectError: 93.184.216.34")
        refreshed = await client.post(f"/api/bot-lists/{list_id}/refresh")
        assert refreshed.status_code == 200
        assert refreshed.json()["lists"][0]["last_error"] == "fetch_failed"
        assert refreshed.json()["lists"][0]["entry_count"] == 2


@pytest.mark.asyncio
async def test_fetch_errors_answer_with_a_code_and_no_detail(test_db, client, remote):
    async with client:
        not_https = await client.post(
            "/api/bot-lists/preview-url", json={"url": "http://example.org/b.json"}
        )
        assert (not_https.status_code, not_https.json()["detail"]) == (400, "not_https")

        remote["result"] = BotListFetchError("unsafe_url", "resolves to 10.0.0.5")
        unsafe = await client.post("/api/bot-lists/subscribe", json={"url": SUB_URL})
        assert (unsafe.status_code, unsafe.json()["detail"]) == (400, "unsafe_url")

        remote["result"] = BotListFetchError("invalid_file", "unsupported bot list version 2")
        invalid = await client.post("/api/bot-lists/preview-url", json={"url": SUB_URL})
        assert invalid.json()["detail"] == "invalid_file: unsupported bot list version 2"

        local = (await client.post("/api/bot-lists", json={"name": "Mine"})).json()["created_id"]
        assert (await client.post(f"/api/bot-lists/{local}/refresh")).status_code == 409
        assert (await client.post("/api/bot-lists/999/refresh")).status_code == 404


@pytest.mark.asyncio
async def test_block_forward_is_switched_through_patch(test_db, client):
    async with client:
        created = (await client.post("/api/bot-lists", json={"name": "Mine"})).json()
        list_id = created["created_id"]
        assert created["forward"] == {"state": "off", "channels": 0, "names": 0}
        await client.post(f"/api/bot-lists/{list_id}/entries", json={"name": "[NU]"})

        state = (
            await client.patch(
                f"/api/bot-lists/{list_id}", json={"enabled": True, "block_forward": True}
            )
        ).json()
        row = next(r for r in state["lists"] if r["id"] == list_id)
        assert (row["block_forward"], row["review_count"]) == (True, 0)
        assert state["forward"]["names"] == 1

        state = (
            await client.patch(f"/api/bot-lists/{list_id}", json={"block_forward": False})
        ).json()
        assert state["forward"]["names"] == 0


@pytest.mark.asyncio
async def test_review_confirms_names(test_db, client, monkeypatch):
    box = {"file": {**FILE, "entries": [{"name": "PingBot"}]}}

    async def fake_fetch(url, **_kwargs):
        return validate_bot_list(box["file"])

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    async with client:
        sub = (
            await client.post(
                "/api/bot-lists/subscribe", json={"url": "https://example.org/b.json"}
            )
        ).json()
        list_id = sub["created_id"]
        box["file"] = {**FILE, "entries": [{"name": "PingBot"}, {"name": "NewBot"}]}
        state = (await client.post(f"/api/bot-lists/{list_id}/refresh")).json()
        assert next(r for r in state["lists"] if r["id"] == list_id)["review_count"] == 1

        done = await client.post(f"/api/bot-lists/{list_id}/review", json={"names": ["NewBot"]})
        assert done.status_code == 200
        assert next(r for r in done.json()["lists"] if r["id"] == list_id)["review_count"] == 0

        missing = await client.post("/api/bot-lists/999/review", json={"names": ["A"]})
        assert missing.status_code == 404
        assert (await client.post(f"/api/bot-lists/{list_id}/review", json={})).status_code == 422


@pytest.mark.asyncio
async def test_refusals_the_ui_words_itself_are_answered_as_codes(test_db, client, monkeypatch):
    async with client:
        created = (await client.post("/api/bot-lists", json={"name": "Mine"})).json()
        list_id = created["created_id"]
        await client.post(f"/api/bot-lists/{list_id}/entries", json={"name": "A"})

        monkeypatch.setattr(service_module, "MAX_ENTRIES", 1)
        full = await client.post(f"/api/bot-lists/{list_id}/entries", json={"name": "B"})
        assert (full.status_code, full.json()["detail"]) == (400, "too_many_entries")

        monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 0)
        over = await client.patch(f"/api/bot-lists/{list_id}", json={"enabled": True})
        assert (over.status_code, over.json()["detail"]) == (400, "over_limit")

        # A refusal without a code keeps its sentence.
        gone = await client.patch("/api/bot-lists/999", json={"enabled": True})
        assert (gone.status_code, gone.json()["detail"]) == (404, "That bot list does not exist")


@pytest.mark.asyncio
async def test_taking_an_exception_away_past_the_cap_is_a_refusal_not_a_crash(
    test_db, client, monkeypatch
):
    async with client:
        created = (await client.post("/api/bot-lists", json={"name": "Mine"})).json()
        list_id = created["created_id"]
        for name in ("A", "B", "C"):
            await client.post(f"/api/bot-lists/{list_id}/entries", json={"name": name})
        await client.patch(f"/api/bot-lists/{list_id}", json={"enabled": True})
        await client.put("/api/bot-lists/exceptions", json={"names": ["C"]})

        monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 2)
        refused = await client.put("/api/bot-lists/exceptions", json={"names": []})
        assert (refused.status_code, refused.json()["detail"]) == (400, "over_limit")
        assert (await client.get("/api/bot-lists")).json()["exceptions"] == ["C"]
