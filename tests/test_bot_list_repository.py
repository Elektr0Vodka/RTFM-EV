"""Tests for bot list storage."""

import pytest

from app.repository.bot_lists import BotListRepository


@pytest.mark.asyncio
async def test_create_get_and_list(test_db):
    list_id = await BotListRepository.create("Mine", "my bots", "local")
    row = await BotListRepository.get(list_id)
    assert row is not None
    assert (row["name"], row["description"], row["source"], row["url"]) == (
        "Mine",
        "my bots",
        "local",
        None,
    )
    assert (row["enabled"], row["block_forward"], row["entry_count"]) == (False, False, 0)
    assert [r["id"] for r in await BotListRepository.list_all()] == [list_id]
    assert await BotListRepository.get(list_id + 99) is None


@pytest.mark.asyncio
async def test_the_shipped_list_sorts_first(test_db):
    await BotListRepository.create("Aaa", "", "local")
    shipped = await BotListRepository.create("Zzz", "", "shipped")
    assert (await BotListRepository.list_all())[0]["id"] == shipped
    assert (await BotListRepository.get_shipped())["id"] == shipped


@pytest.mark.asyncio
async def test_update_changes_only_the_given_fields(test_db):
    list_id = await BotListRepository.create("Mine", "", "local")
    await BotListRepository.update(list_id, {"enabled": 1, "last_error": "boom"})
    row = await BotListRepository.get(list_id)
    assert (row["enabled"], row["last_error"], row["name"]) == (True, "boom", "Mine")
    await BotListRepository.update(list_id, {"last_error": None})
    assert (await BotListRepository.get(list_id))["last_error"] is None


@pytest.mark.asyncio
async def test_update_refuses_an_unknown_field(test_db):
    list_id = await BotListRepository.create("Mine", "", "local")
    with pytest.raises(ValueError):
        await BotListRepository.update(list_id, {"source": "shipped"})


@pytest.mark.asyncio
async def test_entries_replace_add_and_count(test_db):
    list_id = await BotListRepository.create("Mine", "", "local")
    await BotListRepository.replace_entries(
        list_id,
        [
            {"name": "PingBot", "public_key": "ab" * 32, "note": "pong"},
            {"name": "Bot 🤖", "public_key": None, "note": None},
        ],
    )
    assert await BotListRepository.entries(list_id) == [
        {"name": "Bot 🤖", "public_key": None, "note": None},
        {"name": "PingBot", "public_key": "ab" * 32, "note": "pong"},
    ]
    await BotListRepository.add_entry(list_id, "NewsBot", None, "news")
    await BotListRepository.add_entry(list_id, "PingBot", None, None)
    entries = {e["name"]: e for e in await BotListRepository.entries(list_id)}
    assert set(entries) == {"Bot 🤖", "PingBot", "NewsBot"}
    assert entries["PingBot"] == {"name": "PingBot", "public_key": "ab" * 32, "note": "pong"}
    assert (await BotListRepository.get(list_id))["entry_count"] == 3

    await BotListRepository.replace_entries(
        list_id, [{"name": "Only", "public_key": None, "note": None}]
    )
    assert [e["name"] for e in await BotListRepository.entries(list_id)] == ["Only"]


@pytest.mark.asyncio
async def test_enabled_entries_come_from_enabled_lists_only(test_db):
    on = await BotListRepository.create("On", "", "local")
    off = await BotListRepository.create("Off", "", "local")
    await BotListRepository.update(on, {"enabled": 1})
    await BotListRepository.replace_entries(
        on, [{"name": "A", "public_key": "aa" * 32, "note": None}]
    )
    await BotListRepository.replace_entries(off, [{"name": "B", "public_key": None, "note": None}])
    assert await BotListRepository.enabled_entries() == [("A", "aa" * 32)]


@pytest.mark.asyncio
async def test_delete_removes_the_list_and_its_entries(test_db):
    list_id = await BotListRepository.create("Mine", "", "local")
    await BotListRepository.replace_entries(
        list_id, [{"name": "A", "public_key": None, "note": None}]
    )
    await BotListRepository.delete(list_id)
    assert await BotListRepository.get(list_id) is None
    assert await BotListRepository.entries(list_id) == []


@pytest.mark.asyncio
async def test_exceptions_round_trip(test_db):
    assert await BotListRepository.exceptions() == []
    await BotListRepository.set_exceptions(["Alice", "Bob"])
    assert sorted(await BotListRepository.exceptions()) == ["Alice", "Bob"]
    await BotListRepository.set_exceptions(["Bob"])
    assert await BotListRepository.exceptions() == ["Bob"]
