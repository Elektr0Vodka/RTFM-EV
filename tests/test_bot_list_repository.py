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
        {"name": "Bot 🤖", "public_key": None, "note": None, "forward_reviewed": True},
        {
            "name": "PingBot",
            "public_key": "ab" * 32,
            "note": "pong",
            "forward_reviewed": True,
        },
    ]
    await BotListRepository.add_entry(list_id, "NewsBot", None, "news")
    await BotListRepository.add_entry(list_id, "PingBot", None, None)
    entries = {e["name"]: e for e in await BotListRepository.entries(list_id)}
    assert set(entries) == {"Bot 🤖", "PingBot", "NewsBot"}
    assert entries["PingBot"] == {
        "name": "PingBot",
        "public_key": "ab" * 32,
        "note": "pong",
        "forward_reviewed": True,
    }
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


async def _reviewed(test_db, list_id):
    async with test_db.readonly() as conn:
        async with conn.execute(
            "SELECT name, public_key, note, forward_reviewed FROM bot_list_entries "
            "WHERE list_id = ? ORDER BY name",
            (list_id,),
        ) as cursor:
            return [tuple(row) for row in await cursor.fetchall()]


@pytest.mark.asyncio
async def test_apply_refresh_is_a_diff_by_name(test_db):
    list_id = await BotListRepository.create("Feed", "", "url", "https://example.org/b.json")
    await BotListRepository.replace_entries(
        list_id,
        [
            {"name": "Stays", "public_key": None, "note": "old note"},
            {"name": "Goes", "public_key": None, "note": None},
        ],
    )
    assert await _reviewed(test_db, list_id) == [
        ("Goes", None, None, 1),
        ("Stays", None, "old note", 1),
    ]

    added, removed = await BotListRepository.apply_refresh(
        list_id,
        [
            {"name": "Stays", "public_key": "ab" * 32, "note": "new note"},
            {"name": "New", "public_key": None, "note": None},
        ],
    )
    assert (added, removed) == (1, 1)
    assert await _reviewed(test_db, list_id) == [
        ("New", None, None, 0),
        ("Stays", "ab" * 32, "new note", 1),
    ]


@pytest.mark.asyncio
async def test_a_name_that_leaves_and_returns_is_new_again(test_db):
    list_id = await BotListRepository.create("Feed", "", "url", "https://example.org/b.json")
    await BotListRepository.replace_entries(
        list_id, [{"name": "Bot", "public_key": None, "note": None}]
    )
    await BotListRepository.apply_refresh(list_id, [])
    await BotListRepository.apply_refresh(
        list_id, [{"name": "Bot", "public_key": None, "note": None}]
    )
    assert await _reviewed(test_db, list_id) == [("Bot", None, None, 0)]


@pytest.mark.asyncio
async def test_find_count_and_due(test_db):
    local = await BotListRepository.create("Mine", "", "local")
    fresh = await BotListRepository.create("Fresh", "", "url", "https://example.org/fresh.json")
    stale = await BotListRepository.create("Stale", "", "url", "https://example.org/stale.json")
    never = await BotListRepository.create("Never", "", "url", "https://example.org/never.json")
    await BotListRepository.update(fresh, {"fetched_at": 2000})
    await BotListRepository.update(stale, {"fetched_at": 500})

    assert (await BotListRepository.find_by_url("https://example.org/stale.json"))["id"] == stale
    assert await BotListRepository.find_by_url("https://example.org/other.json") is None
    assert await BotListRepository.count_by_source("url") == 3
    assert await BotListRepository.count_by_source("local") == 1
    assert [row["id"] for row in await BotListRepository.due_url_lists(1000)] == [never, stale]
    assert local not in [row["id"] for row in await BotListRepository.due_url_lists(10**10)]
