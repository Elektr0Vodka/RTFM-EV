"""Bot lists: which names are forward-blocked, and the review of added names."""

import asyncio

import pytest

from app.bot_lists.format import validate_bot_list
from app.repository.bot_lists import BotListRepository
from app.services import bot_lists as service_module
from app.services import spam_guard as spam_guard_module
from app.services.bot_lists import BotListNotFound, bot_lists
from app.services.host_repeater import HostRepeaterRuntime
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import SpamGuardRuntime

URL = "https://example.org/lists/bots.json"


def _file(*names):
    return validate_bot_list(
        {
            "format": "rtfm-ev-bot-list",
            "version": 1,
            "name": "Shared",
            "entries": [{"name": n} for n in names],
        }
    )


@pytest.fixture
def guard(test_db, monkeypatch):
    """A Spam Guard runtime of this test's own, in place of the global one."""
    runtime = SpamGuardRuntime()
    runtime.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(spam_guard_module, "spam_guard", runtime)
    return runtime


@pytest.fixture
def remote(monkeypatch):
    box = {"result": _file("PingBot")}

    async def fake_fetch(url, **_kwargs):
        return box["result"]

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    return box


async def _local(names, *, enabled=True, block=True):
    state = await bot_lists.create_local("Mine")
    list_id = state["created_id"]
    await BotListRepository.replace_entries(
        list_id, [{"name": n, "public_key": None, "note": None} for n in names]
    )
    await bot_lists.update(list_id, enabled=enabled, block_forward=block)
    return list_id


def _row(state, list_id):
    return next(row for row in state["lists"] if row["id"] == list_id)


@pytest.mark.asyncio
async def test_block_forward_is_off_until_switched_on(guard):
    list_id = await _local(["[NU]"], block=False)
    assert bot_lists.forward_names() == [] and guard.bot_senders == ()
    state = await bot_lists.update(list_id, block_forward=True)
    assert _row(state, list_id)["block_forward"] is True
    assert bot_lists.forward_names() == ["[NU]"] and guard.bot_senders == ("[NU]",)
    await bot_lists.update(list_id, block_forward=False)
    assert guard.bot_senders == ()


@pytest.mark.asyncio
async def test_a_list_that_is_switched_off_blocks_nothing(guard):
    list_id = await _local(["[NU]"], enabled=False)
    assert guard.bot_senders == ()
    await bot_lists.update(list_id, enabled=True)
    assert guard.bot_senders == ("[NU]",)


@pytest.mark.asyncio
async def test_names_of_every_blocking_list_are_joined(guard):
    await _local(["[NU]", "PingBot"])
    await _local(["PingBot", "[NOS]"])
    await _local(["Quiet"], block=False)
    assert guard.bot_senders == ("PingBot", "[NOS]", "[NU]")


@pytest.mark.asyncio
async def test_an_exception_takes_a_name_out_of_the_rules(guard):
    await _local(["[NU]", "PingBot"])
    await bot_lists.set_exceptions(["PingBot"])
    assert guard.bot_senders == ("[NU]",)
    await bot_lists.set_exceptions([])
    assert guard.bot_senders == ("PingBot", "[NU]")


@pytest.mark.asyncio
async def test_deleting_a_list_takes_its_names_out(guard):
    list_id = await _local(["[NU]"])
    await bot_lists.delete(list_id)
    assert guard.bot_senders == ()


@pytest.mark.asyncio
async def test_a_name_a_refresh_adds_is_not_forward_blocked_until_reviewed(guard, remote):
    state = await bot_lists.subscribe(URL)
    list_id = state["created_id"]
    await bot_lists.update(list_id, enabled=True, block_forward=True)
    assert guard.bot_senders == ("PingBot",)  # there at subscribe time: reviewed

    remote["result"] = _file("PingBot", "NewBot")
    state = await bot_lists.refresh_list(list_id)
    assert _row(state, list_id)["review_count"] == 1
    assert state["effective"]["names"] == ["NewBot", "PingBot"]  # marked in chat at once
    assert guard.bot_senders == ("PingBot",)
    assert await bot_lists.entries(list_id) == [
        {"name": "NewBot", "public_key": None, "note": None, "forward_reviewed": False},
        {"name": "PingBot", "public_key": None, "note": None, "forward_reviewed": True},
    ]

    state = await bot_lists.review(list_id, ["NewBot"])
    assert _row(state, list_id)["review_count"] == 0
    assert guard.bot_senders == ("NewBot", "PingBot")


@pytest.mark.asyncio
async def test_review_confirms_only_the_names_given(guard, remote):
    list_id = (await bot_lists.subscribe(URL))["created_id"]
    await bot_lists.update(list_id, enabled=True, block_forward=True)
    remote["result"] = _file("PingBot", "A", "B")
    await bot_lists.refresh_list(list_id)
    state = await bot_lists.review(list_id, ["A", "Not on the list"])
    assert _row(state, list_id)["review_count"] == 1
    assert guard.bot_senders == ("A", "PingBot")


@pytest.mark.asyncio
async def test_a_name_that_left_and_came_back_is_new_again(guard, remote):
    list_id = (await bot_lists.subscribe(URL))["created_id"]
    await bot_lists.update(list_id, enabled=True, block_forward=True)
    remote["result"] = _file("Other")
    await bot_lists.refresh_list(list_id)
    await bot_lists.review(list_id, ["Other"])
    remote["result"] = _file("Other", "PingBot")
    await bot_lists.refresh_list(list_id)
    assert guard.bot_senders == ("Other",)


@pytest.mark.asyncio
async def test_an_excepted_name_is_not_counted_for_review(guard, remote):
    list_id = (await bot_lists.subscribe(URL))["created_id"]
    remote["result"] = _file("PingBot", "Alice")
    state = await bot_lists.refresh_list(list_id)
    assert _row(state, list_id)["review_count"] == 1
    state = await bot_lists.set_exceptions(["Alice"])
    assert _row(state, list_id)["review_count"] == 0


@pytest.mark.asyncio
async def test_review_of_an_unknown_list_is_refused(guard):
    with pytest.raises(BotListNotFound):
        await bot_lists.review(999, ["A"])


@pytest.mark.asyncio
async def test_the_export_does_not_carry_the_review_flag(guard, remote):
    list_id = (await bot_lists.subscribe(URL))["created_id"]
    document = await bot_lists.export(list_id)
    assert document["entries"] == [{"name": "PingBot"}]


@pytest.mark.asyncio
async def test_the_snapshot_says_what_forward_blocking_is_doing(guard):
    await _local(["[NU]"])
    state = await bot_lists.snapshot()
    assert state["forward"] == {"state": "off", "channels": 0, "names": 1}


@pytest.mark.asyncio
async def test_the_shipped_list_can_block_forwards(guard, tmp_path):
    path = tmp_path / "bot_list.json"
    path.write_text(
        '{"format":"rtfm-ev-bot-list","version":1,"name":"Shipped",'
        '"entries":[{"name":"[NU]"},{"name":"[NOS]"}]}',
        encoding="utf-8",
    )
    await bot_lists.load_shipped(path)
    shipped = await BotListRepository.get_shipped()
    assert shipped is not None
    await bot_lists.update(shipped["id"], enabled=True, block_forward=True)
    assert guard.bot_senders == ("[NOS]", "[NU]")
    # A restart reloads the file: the switches and the names stay.
    await bot_lists.load_shipped(path)
    assert guard.bot_senders == ("[NOS]", "[NU]")


@pytest.mark.asyncio
async def test_names_reach_the_rules_of_a_loaded_spam_guard(guard):
    """End to end: a list's switch becomes a managed rule on the host engine."""
    from app.spam.settings import SpamConfig

    await guard.load()
    await guard.set_enabled(True)
    public = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
    config = SpamConfig(mode="protect", channels=[{"key": public, "name": "Public"}])
    assert await guard.save_config(guard.version, config) is not None
    try:
        list_id = await _local(["[NU]"])
        engine = guard.host._runtime.engine
        (rule,) = engine._managed_before
        assert rule.name == f"spam:bots:{public} (bot list)"
        assert rule.condition["all"][-1]["value"] == ["[NU]"]
        await bot_lists.set_exceptions(["[NU]"])
        assert engine._managed_before == ()
        await bot_lists.set_exceptions([])
        await bot_lists.update(list_id, block_forward=False)
        assert engine._managed_before == ()
    finally:
        await guard.stop()


async def _park_first_refresh(monkeypatch):
    """Make the first ``forward_names`` read wait after it has read; returns the gates."""
    real = BotListRepository.forward_names
    parked, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def slow_first():
        nonlocal calls
        calls += 1
        names = await real()
        if calls == 1:
            parked.set()
            await release.wait()
        return names

    monkeypatch.setattr(BotListRepository, "forward_names", staticmethod(slow_first))
    return parked, release


@pytest.mark.asyncio
async def test_an_older_refresh_cannot_put_back_a_list_just_switched_off(guard, monkeypatch):
    list_id = await _local(["PingBot"])
    assert guard.bot_senders == ("PingBot",)
    parked, release = await _park_first_refresh(monkeypatch)

    older = asyncio.create_task(bot_lists.refresh())
    await parked.wait()
    newer = asyncio.create_task(bot_lists.update(list_id, block_forward=False))
    await asyncio.sleep(0.05)
    release.set()
    await asyncio.gather(older, newer)

    assert bot_lists.forward_names() == [] and guard.bot_senders == ()


@pytest.mark.asyncio
async def test_an_older_refresh_cannot_put_back_an_excepted_name(guard, monkeypatch):
    await _local(["PingBot"])
    parked, release = await _park_first_refresh(monkeypatch)

    older = asyncio.create_task(bot_lists.refresh())
    await parked.wait()
    newer = asyncio.create_task(bot_lists.set_exceptions(["PingBot"]))
    await asyncio.sleep(0.05)
    release.set()
    await asyncio.gather(older, newer)

    assert guard.bot_senders == ()


@pytest.mark.asyncio
async def test_review_confirms_a_name_on_that_list_only(guard, monkeypatch):
    files = {URL: _file("PingBot"), URL + "2": _file("PingBot")}

    async def fake_fetch(url, **_kwargs):
        return files[url]

    monkeypatch.setattr(service_module, "fetch_bot_list", fake_fetch)
    first = (await bot_lists.subscribe(URL))["created_id"]
    second = (await bot_lists.subscribe(URL + "2"))["created_id"]
    files[URL] = files[URL + "2"] = _file("PingBot", "NewBot")
    await bot_lists.refresh_list(first)
    await bot_lists.refresh_list(second)

    state = await bot_lists.review(first, ["NewBot"])
    assert _row(state, first)["review_count"] == 0
    assert _row(state, second)["review_count"] == 1
