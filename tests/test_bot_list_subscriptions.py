"""Tests for URL subscriptions in the bot list service."""

import asyncio

import pytest

from app.bot_lists.format import validate_bot_list
from app.repository.bot_lists import BotListRepository
from app.services import bot_lists as service_module
from app.services.bot_list_fetch import BotListFetchError
from app.services.bot_lists import BotListError, BotListLimit, BotListReadOnly, bot_lists

URL = "https://example.org/lists/bots.json"


def _file(*names, name="Shared", updated="2026-10-13"):
    return validate_bot_list(
        {
            "format": "rtfm-ev-bot-list",
            "version": 1,
            "name": name,
            "updated": updated,
            "entries": [{"name": n} for n in names],
        }
    )


@pytest.fixture
def remote(monkeypatch):
    """What the URL serves: a file, or an error to raise. Counts the fetches."""
    box = {"result": _file("PingBot"), "calls": []}

    async def fake_fetch(url, **_kwargs):
        box["calls"].append(url)
        if isinstance(box["result"], Exception):
            raise box["result"]
        return box["result"]

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    return box


@pytest.mark.asyncio
async def test_preview_shows_the_file_and_stores_nothing(test_db, remote):
    preview = await bot_lists.preview_url(URL + "#section")
    assert preview == {
        "url": URL,
        "name": "Shared",
        "description": "",
        "updated": "2026-10-13",
        "entries": [{"name": "PingBot", "public_key": None, "note": None}],
    }
    assert await BotListRepository.list_all() == []


@pytest.mark.asyncio
async def test_subscribe_stores_a_read_only_list_that_is_off(test_db, remote):
    state = await bot_lists.subscribe(URL)
    made = next(lst for lst in state["lists"] if lst["id"] == state["created_id"])
    assert (made["source"], made["url"], made["enabled"], made["entry_count"]) == (
        "url",
        URL,
        False,
        1,
    )
    assert made["fetched_at"] is not None
    assert made["last_error"] is None
    assert state["effective"]["names"] == []
    with pytest.raises(BotListReadOnly):
        await bot_lists.add_entry(made["id"], _file("Other").entries[0])


@pytest.mark.asyncio
async def test_the_same_url_cannot_be_subscribed_twice(test_db, remote):
    await bot_lists.subscribe(URL)
    with pytest.raises(BotListError, match="already subscribed"):
        await bot_lists.subscribe(URL + "#other-fragment")
    assert await BotListRepository.count_by_source("url") == 1


@pytest.mark.asyncio
async def test_subscribing_stops_at_the_limit(test_db, remote, monkeypatch):
    monkeypatch.setattr(service_module, "MAX_SUBSCRIPTIONS", 1)
    await bot_lists.subscribe(URL)
    with pytest.raises(BotListLimit):
        await bot_lists.subscribe("https://example.org/second.json")
    assert len(remote["calls"]) == 1


@pytest.mark.asyncio
async def test_a_failed_subscribe_stores_nothing(test_db, remote):
    remote["result"] = BotListFetchError("unsafe_url", "10.0.0.5")
    with pytest.raises(BotListFetchError):
        await bot_lists.subscribe(URL)
    assert await BotListRepository.list_all() == []


@pytest.mark.asyncio
async def test_refresh_takes_names_and_title_from_the_file(test_db, remote):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    await bot_lists.update(list_id, enabled=True)

    remote["result"] = _file("PingBot", "NewsBot", name="Shared v2", updated="2026-11-01")
    state = await bot_lists.refresh_list(list_id)
    row = next(lst for lst in state["lists"] if lst["id"] == list_id)
    assert (row["name"], row["file_updated"], row["entry_count"]) == ("Shared v2", "2026-11-01", 2)
    assert state["effective"]["names"] == ["NewsBot", "PingBot"]


@pytest.mark.asyncio
async def test_a_failed_refresh_keeps_entries_and_records_the_error(test_db, remote):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    fetched_at = (await BotListRepository.get(list_id))["fetched_at"]

    remote["result"] = BotListFetchError("invalid_file", "unsupported bot list version 2")
    state = await bot_lists.refresh_list(list_id)
    row = next(lst for lst in state["lists"] if lst["id"] == list_id)
    assert row["entry_count"] == 1
    assert row["last_error"] == "invalid_file: unsupported bot list version 2"
    assert row["fetched_at"] == fetched_at

    remote["result"] = BotListFetchError("fetch_failed", "ConnectError: 93.184.216.34 refused")
    state = await bot_lists.refresh_list(list_id)
    row = next(lst for lst in state["lists"] if lst["id"] == list_id)
    assert row["last_error"] == "fetch_failed"

    remote["result"] = _file("PingBot")
    state = await bot_lists.refresh_list(list_id)
    assert next(lst for lst in state["lists"] if lst["id"] == list_id)["last_error"] is None


@pytest.mark.asyncio
async def test_a_refresh_that_would_pass_the_cap_is_refused(test_db, remote, monkeypatch):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    await bot_lists.update(list_id, enabled=True)
    monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 2)

    remote["result"] = _file("PingBot", "A", "B")
    state = await bot_lists.refresh_list(list_id)
    row = next(lst for lst in state["lists"] if lst["id"] == list_id)
    assert (row["entry_count"], row["last_error"]) == (1, "over_limit")


@pytest.mark.asyncio
async def test_only_a_subscription_can_be_refreshed(test_db, remote):
    state = await bot_lists.create_local("Mine")
    with pytest.raises(BotListReadOnly):
        await bot_lists.refresh_list(state["created_id"])
    assert remote["calls"] == []


@pytest.mark.asyncio
async def test_refresh_due_takes_only_lists_older_than_a_day(test_db, remote):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    await BotListRepository.update(list_id, {"fetched_at": 1_000_000})
    remote["calls"].clear()

    assert await bot_lists.refresh_due(now=1_000_000 + 86_399) == 0
    assert remote["calls"] == []
    assert await bot_lists.refresh_due(now=1_000_000 + 86_400) == 1
    assert remote["calls"] == [URL]
    assert (await BotListRepository.get(list_id))["fetched_at"] > 1_000_000


@pytest.mark.asyncio
async def test_a_failed_refresh_is_tried_again_at_the_next_check(test_db, remote):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    await BotListRepository.update(list_id, {"fetched_at": 1_000_000})
    remote["calls"].clear()
    remote["result"] = BotListFetchError("fetch_failed", "down")

    now = 1_000_000 + 86_400
    assert await bot_lists.refresh_due(now=now) == 1
    assert await bot_lists.refresh_due(now=now + 3600) == 1
    assert len(remote["calls"]) == 2
    assert (await BotListRepository.get(list_id))["last_error"] == "fetch_failed"


@pytest.mark.asyncio
async def test_one_failing_list_does_not_stop_the_others(test_db, monkeypatch):
    first = await BotListRepository.create("First", "", "url", "https://example.org/first.json")
    second = await BotListRepository.create("Second", "", "url", "https://example.org/second.json")

    async def fake_fetch(url, **_kwargs):
        if url.endswith("first.json"):
            raise BotListFetchError("http_error", "status 500")
        return _file("PingBot")

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    assert await bot_lists.refresh_due(now=2_000_000_000) == 2
    assert (await BotListRepository.get(first))["last_error"] == "http_error"
    assert (await BotListRepository.get(second))["entry_count"] == 1


@pytest.mark.asyncio
async def test_an_unexpected_error_in_one_list_does_not_stop_the_others(test_db, monkeypatch):
    first = await BotListRepository.create("First", "", "url", "https://example.org/first.json")
    second = await BotListRepository.create("Second", "", "url", "https://example.org/second.json")

    async def fake_fetch(url, **_kwargs):
        if url.endswith("first.json"):
            raise RuntimeError("something nobody planned for")
        return _file("PingBot")

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    assert await bot_lists.refresh_due(now=2_000_000_000) == 2
    assert (await BotListRepository.get(first))["last_error"] == "fetch_failed"
    assert (await BotListRepository.get(second))["entry_count"] == 1

    state = await bot_lists.refresh_list(first)
    assert next(lst for lst in state["lists"] if lst["id"] == first)["last_error"] == "fetch_failed"


@pytest.mark.asyncio
async def test_two_subscribes_of_one_address_at_once_make_one_list(test_db, monkeypatch):
    async def slow_fetch(url, **_kwargs):
        await asyncio.sleep(0.02)
        return _file("PingBot")

    monkeypatch.setattr(service_module, "fetch_bot_list", slow_fetch)
    results = await asyncio.gather(
        bot_lists.subscribe(URL),
        bot_lists.subscribe(URL.replace("example.org", "example.org:443")),
        return_exceptions=True,
    )
    refused = [r for r in results if isinstance(r, BotListError)]
    assert len(refused) == 1 and refused[0].code == "already_subscribed"
    assert await BotListRepository.count_by_source("url") == 1


@pytest.mark.asyncio
async def test_the_refusals_carry_a_code(test_db, remote, monkeypatch):
    await bot_lists.subscribe(URL)
    with pytest.raises(BotListError) as caught:
        await bot_lists.subscribe(URL)
    assert caught.value.code == "already_subscribed"

    monkeypatch.setattr(service_module, "MAX_SUBSCRIPTIONS", 1)
    with pytest.raises(BotListLimit) as caught:
        await bot_lists.subscribe("https://example.org/other.json")
    assert caught.value.code == "too_many_subscriptions"


@pytest.mark.asyncio
async def test_a_list_deleted_while_it_is_fetched_leaves_nothing_behind(
    test_db, remote, monkeypatch
):
    list_id = (await bot_lists.subscribe(URL))["created_id"]

    async def fetch_while_the_list_goes(url, **_kwargs):
        await BotListRepository.delete(list_id)
        return _file("PingBot", "NewBot")

    monkeypatch.setattr(service_module, "fetch_bot_list", fetch_while_the_list_goes)
    row = {"id": list_id, "url": URL, "enabled": False}
    await bot_lists._refresh_row(row)

    assert await BotListRepository.get(list_id) is None
    assert await BotListRepository.entries(list_id) == []


@pytest.mark.asyncio
async def test_a_refresh_that_swaps_names_is_not_counted_twice(test_db, remote, monkeypatch):
    remote["result"] = _file("A", "B")
    list_id = (await bot_lists.subscribe(URL))["created_id"]
    await bot_lists.update(list_id, enabled=True)
    monkeypatch.setattr(service_module, "MAX_EFFECTIVE", 2)

    remote["result"] = _file("C", "D")
    state = await bot_lists.refresh_list(list_id)
    row = next(r for r in state["lists"] if r["id"] == list_id)
    assert row["last_error"] is None
    assert state["effective"]["names"] == ["C", "D"]
