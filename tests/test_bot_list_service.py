"""Tests for the bot list service."""

import json

import pytest

from app.bot_lists.format import BotEntry, parse_bot_list
from app.repository.bot_lists import BotListRepository
from app.services import bot_lists as service_module
from app.services.bot_lists import (
    BotListLimit,
    BotListNotFound,
    BotListReadOnly,
    bot_lists,
)


def _entry(name, key=None, note=None):
    return BotEntry(name=name, public_key=key, note=note)


async def _list_with(names, *, enabled=True, source="local"):
    list_id = await BotListRepository.create("L", "", source)
    await BotListRepository.replace_entries(
        list_id, [{"name": n, "public_key": None, "note": None} for n in names]
    )
    if enabled:
        await BotListRepository.update(list_id, {"enabled": 1})
    await bot_lists.refresh()
    return list_id


@pytest.mark.asyncio
async def test_a_new_list_is_off_and_empty(test_db):
    state = await bot_lists.create_local("Mine", "my bots")
    assert [(lst["name"], lst["enabled"], lst["entry_count"]) for lst in state["lists"]] == [
        ("Mine", False, 0)
    ]
    assert state["effective"] == {"names": [], "keys": []}
    assert state["limits"] == {"entries_per_list": 1000, "effective": 5000}


@pytest.mark.asyncio
async def test_entries_count_only_while_the_list_is_enabled(test_db):
    state = await bot_lists.create_local("Mine")
    list_id = state["lists"][0]["id"]
    state = await bot_lists.replace_entries(list_id, [_entry("PingBot", "AB" * 32)])
    assert state["effective"] == {"names": [], "keys": []}
    state = await bot_lists.update(list_id, enabled=True)
    assert state["effective"] == {"names": ["PingBot"], "keys": ["ab" * 32]}
    state = await bot_lists.update(list_id, enabled=False)
    assert state["effective"] == {"names": [], "keys": []}


@pytest.mark.asyncio
async def test_a_name_on_two_lists_stays_while_one_is_enabled(test_db):
    first = await _list_with(["PingBot"])
    await _list_with(["PingBot"])
    state = await bot_lists.update(first, enabled=False)
    assert state["effective"]["names"] == ["PingBot"]


@pytest.mark.asyncio
async def test_an_exception_removes_name_and_key(test_db):
    list_id = await _list_with([])
    await bot_lists.replace_entries(list_id, [_entry("Alice", "cd" * 32), _entry("PingBot")])
    state = await bot_lists.set_exceptions(["Alice", "  "])
    assert state["exceptions"] == ["Alice"]
    assert state["effective"] == {"names": ["PingBot"], "keys": []}


@pytest.mark.asyncio
async def test_matching_is_case_sensitive(test_db):
    await _list_with(["PingBot"])
    state = await bot_lists.set_exceptions(["pingbot"])
    assert state["effective"]["names"] == ["PingBot"]


@pytest.mark.asyncio
async def test_enabling_past_the_cap_is_refused_and_changes_nothing(test_db, monkeypatch):
    monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 3)
    await _list_with(["a", "b"])
    second = await _list_with(["c", "d"], enabled=False)
    with pytest.raises(BotListLimit):
        await bot_lists.update(second, enabled=True)
    assert (await BotListRepository.get(second))["enabled"] is False
    assert (await bot_lists.snapshot())["effective"]["names"] == ["a", "b"]


@pytest.mark.asyncio
async def test_adding_to_an_enabled_list_past_the_cap_is_refused(test_db, monkeypatch):
    monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 2)
    list_id = await _list_with(["a", "b"])
    with pytest.raises(BotListLimit):
        await bot_lists.add_entry(list_id, _entry("c"))
    assert [e["name"] for e in await bot_lists.entries(list_id)] == ["a", "b"]


@pytest.mark.asyncio
async def test_only_local_lists_can_be_edited(test_db):
    shipped = await _list_with(["PingBot"], enabled=False, source="shipped")
    with pytest.raises(BotListReadOnly):
        await bot_lists.replace_entries(shipped, [_entry("Other")])
    with pytest.raises(BotListReadOnly):
        await bot_lists.add_entry(shipped, _entry("Other"))
    with pytest.raises(BotListReadOnly):
        await bot_lists.update(shipped, name="Renamed")
    with pytest.raises(BotListReadOnly):
        await bot_lists.delete(shipped)
    state = await bot_lists.update(shipped, enabled=True)
    assert state["effective"]["names"] == ["PingBot"]


@pytest.mark.asyncio
async def test_an_unknown_list_is_not_found(test_db):
    with pytest.raises(BotListNotFound):
        await bot_lists.update(12345, enabled=True)
    with pytest.raises(BotListNotFound):
        await bot_lists.entries(12345)


@pytest.mark.asyncio
async def test_export_then_import_gives_the_same_entries(test_db):
    list_id = await _list_with([], enabled=False)
    await bot_lists.replace_entries(
        list_id, [_entry("Bot 🤖", "ab" * 32, "weather"), _entry("PingBot")]
    )
    document = await bot_lists.export(list_id)
    assert document["format"] == "rtfm-ev-bot-list"
    assert document["entries"] == [
        {"name": "Bot 🤖", "public_key": "ab" * 32, "note": "weather"},
        {"name": "PingBot"},
    ]

    state = await bot_lists.import_file(parse_bot_list(json.dumps(document)))
    imported = [lst for lst in state["lists"] if lst["id"] != list_id]
    assert len(imported) == 1
    assert (imported[0]["source"], imported[0]["enabled"], imported[0]["entry_count"]) == (
        "local",
        False,
        2,
    )
    assert await bot_lists.entries(imported[0]["id"]) == await bot_lists.entries(list_id)


def _shipped_doc(*names):
    return {
        "format": "rtfm-ev-bot-list",
        "version": 1,
        "name": "Shipped",
        "updated": "2026-10-13",
        "entries": [{"name": name} for name in names],
    }


@pytest.mark.asyncio
async def test_the_shipped_file_becomes_one_read_only_list(test_db, tmp_path):
    path = tmp_path / "bot_list.json"
    path.write_text(json.dumps(_shipped_doc("PingBot")), encoding="utf-8")
    await bot_lists.load_shipped(path)
    await bot_lists.load_shipped(path)
    shipped = [lst for lst in (await bot_lists.snapshot())["lists"] if lst["source"] == "shipped"]
    assert len(shipped) == 1
    assert (shipped[0]["name"], shipped[0]["enabled"], shipped[0]["entry_count"]) == (
        "Shipped",
        False,
        1,
    )
    assert shipped[0]["file_updated"] == "2026-10-13"


@pytest.mark.asyncio
async def test_a_new_shipped_file_replaces_entries_and_keeps_the_switch(test_db, tmp_path):
    path = tmp_path / "bot_list.json"
    path.write_text(json.dumps(_shipped_doc("A")), encoding="utf-8")
    await bot_lists.load_shipped(path)
    shipped_id = (await BotListRepository.get_shipped())["id"]
    await bot_lists.update(shipped_id, enabled=True)

    path.write_text(json.dumps(_shipped_doc("B")), encoding="utf-8")
    await bot_lists.load_shipped(path)
    state = await bot_lists.snapshot()
    assert state["effective"]["names"] == ["B"]
    assert (await BotListRepository.get(shipped_id))["enabled"] is True


@pytest.mark.asyncio
async def test_a_broken_shipped_file_keeps_entries_and_records_the_error(test_db, tmp_path):
    path = tmp_path / "bot_list.json"
    path.write_text(json.dumps(_shipped_doc("A")), encoding="utf-8")
    await bot_lists.load_shipped(path)
    path.write_text("{broken", encoding="utf-8")
    await bot_lists.load_shipped(path)
    shipped = await BotListRepository.get_shipped()
    assert shipped["entry_count"] == 1
    assert "not valid JSON" in shipped["last_error"]

    await bot_lists.load_shipped(tmp_path / "missing.json")
    assert (await BotListRepository.get_shipped())["last_error"]


@pytest.mark.asyncio
async def test_a_missing_shipped_file_on_first_start_still_gives_a_list(test_db, tmp_path):
    await bot_lists.load_shipped(tmp_path / "missing.json")
    shipped = await BotListRepository.get_shipped()
    assert shipped is not None
    assert shipped["entry_count"] == 0
    assert shipped["last_error"]


def test_the_file_in_the_repo_is_valid_and_holds_the_confirmed_names():
    parsed = parse_bot_list(service_module.SHIPPED_PATH.read_bytes())
    assert [entry.name for entry in parsed.entries] == [
        "[AT5]",
        "[NH]",
        "[NOS]",
        "[NU]",
        "NL-EIN-PA3JH-HA",
        "NL-OV-ENS-NL1CTM-BOT",
    ]
    assert all(entry.public_key is None for entry in parsed.entries)


@pytest.mark.asyncio
async def test_a_change_is_broadcast(test_db, monkeypatch, captured_broadcasts):
    broadcasts, mock_broadcast = captured_broadcasts
    monkeypatch.setattr(service_module, "broadcast_event", mock_broadcast)
    state = await bot_lists.create_local("Mine")
    created_id = state.pop("created_id")
    assert created_id == state["lists"][0]["id"]
    assert broadcasts == [{"type": "bot_lists", "data": state}]
