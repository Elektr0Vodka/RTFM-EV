"""Tests for unread totals across radios in multi-radio mode (plan 30, part D)."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from gateway_fake_channels import PortRouter

from app.gateway.registry import RadioRegistry, TcpTransport
from app.gateway.supervisor import Worker
from app.gateway.unreads import (
    REFRESH_EVENTS,
    UnreadsHub,
    changes_unreads,
    new_alerts,
    summarize,
)

CHAN = "channel-8B3387E9C5CDEA6AC9E5EDBAA115CD72"
MUTED = "channel-" + "AA" * 16
ALICE = "contact-" + "11" * 32
BOB = "contact-" + "22" * 32


def make_worker(*, counts=None, mentions=None, muted=(), sound=True) -> FastAPI:
    app = FastAPI()
    app.state.unreads = {"counts": counts or {}, "mentions": mentions or {}}
    app.state.muted = set(muted)
    app.state.sound = sound
    app.state.fail = False

    @app.get("/api/read-state/unreads")
    async def unreads():
        if app.state.fail:
            raise HTTPException(status_code=500, detail="database is locked")
        return app.state.unreads

    @app.get("/api/channels")
    async def channels():
        return [{"key": key.removeprefix("channel-"), "muted": True} for key in app.state.muted]

    @app.get("/api/settings")
    async def settings():
        return {"mention_sound_enabled": app.state.sound}

    return app


class Supervisor:
    def __init__(self, radio_ids):
        self.workers = {
            i: Worker(i, state="running", port=9000 + i, token=f"tok-{i}") for i in radio_ids
        }

    def worker(self, radio_id):
        return self.workers.setdefault(radio_id, Worker(radio_id))


class NeverConnects:
    """Stands in for websockets.connect: the worker event stream is not under test."""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        await asyncio.Event().wait()

    async def __aexit__(self, *exc):
        return False


def _hub(tmp_path, apps, **kwargs):
    registry = RadioRegistry(tmp_path / "radios.json")
    for radio_id in apps:
        registry.add(name=f"r{radio_id}", transport=TcpTransport(host=f"10.0.0.{radio_id}"))
    supervisor = Supervisor(list(apps))
    client = httpx.AsyncClient(
        transport=PortRouter({9000 + radio_id: app for radio_id, app in apps.items()})
    )
    kwargs.setdefault("connect", NeverConnects)
    return supervisor, UnreadsHub(registry, supervisor, client, **kwargs)


def _drain(queue: asyncio.Queue) -> list[dict]:
    out = []
    while not queue.empty():
        out.append(queue.get_nowait())
    return out


def test_summarize_leaves_muted_channels_out():
    summary, dm_counts, mention_keys = summarize(
        {
            "counts": {CHAN: 3, MUTED: 9, ALICE: 2, BOB: 0},
            "mentions": {CHAN: True, MUTED: True, ALICE: False},
        },
        [{"key": "AA" * 16, "muted": True}, {"key": CHAN.removeprefix("channel-"), "muted": False}],
        True,
    )
    assert summary == {"unread": 5, "dms": 2, "mentions": 1, "sound": True}
    assert dm_counts == {ALICE: 2}
    assert mention_keys == frozenset({CHAN})


def test_summarize_of_an_empty_reply():
    summary, dm_counts, mention_keys = summarize({}, [], False)
    assert summary == {"unread": 0, "dms": 0, "mentions": 0, "sound": False}
    assert dm_counts == {} and mention_keys == frozenset()


def test_new_alerts_are_more_dms_and_first_mentions():
    assert new_alerts({ALICE: 1}, frozenset(), {ALICE: 2, BOB: 1}, frozenset({CHAN})) == [
        ALICE,
        BOB,
        CHAN,
    ]
    # Fewer unread (read elsewhere) or a mention that was already there: nothing new.
    assert new_alerts({ALICE: 3}, frozenset({CHAN}), {ALICE: 1}, frozenset({CHAN})) == []


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "api/read-state/mark-all-read", True),
        ("POST", f"api/contacts/{'11' * 32}/mark-read", True),
        ("POST", f"api/channels/{'AA' * 16}/mark-unread", True),
        ("PATCH", "api/settings", True),
        ("GET", "api/read-state/unreads", False),
        ("POST", "api/messages/direct", False),
    ],
)
def test_changes_unreads(method, path, expected):
    assert changes_unreads(method, path) is expected


def test_refresh_events_cover_messages_but_not_adverts():
    assert "message" in REFRESH_EVENTS
    assert "channel_deleted" in REFRESH_EVENTS
    assert "contact" not in REFRESH_EVENTS
    assert "health" not in REFRESH_EVENTS


async def test_first_step_publishes_totals_without_alerts(tmp_path):
    a = make_worker(counts={CHAN: 2, ALICE: 1}, mentions={CHAN: True})
    b = make_worker(counts={BOB: 4}, sound=False)
    _, hub = _hub(tmp_path, {1: a, 2: b})
    queue = hub.add_client()

    await hub.step()

    assert hub.snapshot() == {
        "radios": {
            "1": {"unread": 3, "dms": 1, "mentions": 1, "sound": True},
            "2": {"unread": 4, "dms": 4, "mentions": 0, "sound": False},
        }
    }
    assert _drain(queue) == [{"type": "unreads", **hub.snapshot()}]


async def test_new_dm_and_first_mention_raise_an_alert(tmp_path):
    a = make_worker(counts={ALICE: 1})
    b = make_worker()
    _, hub = _hub(tmp_path, {1: a, 2: b})
    await hub.step()
    queue = hub.add_client()

    a.state.unreads = {"counts": {ALICE: 2, CHAN: 1}, "mentions": {CHAN: True}}
    hub.mark_dirty(1)
    await hub.step()

    messages = _drain(queue)
    assert messages[0]["type"] == "unreads"
    assert messages[0]["radios"]["1"] == {"unread": 3, "dms": 2, "mentions": 1, "sound": True}
    assert messages[1] == {"type": "alert", "radio": 1, "keys": [ALICE, CHAN]}

    # Nothing changed: nothing is sent.
    hub.mark_dirty(1)
    await hub.step()
    assert _drain(queue) == []


async def test_only_dirty_radios_are_asked_between_full_refreshes(tmp_path):
    asked: list[int] = []
    a, b = make_worker(), make_worker()
    for radio_id, app in ((1, a), (2, b)):

        @app.middleware("http")
        async def record(request, call_next, radio_id=radio_id):
            asked.append(radio_id)
            return await call_next(request)

    now = [1000.0]
    _, hub = _hub(tmp_path, {1: a, 2: b}, clock=lambda: now[0], refresh_interval=20.0)
    await hub.step()
    assert set(asked) == {1, 2}

    asked.clear()
    hub.mark_dirty(2)
    await hub.step()
    assert set(asked) == {2}

    asked.clear()
    now[0] += 21
    await hub.step()
    assert set(asked) == {1, 2}


async def test_a_stopped_radio_drops_out(tmp_path):
    a, b = make_worker(counts={ALICE: 1}), make_worker(counts={BOB: 1})
    supervisor, hub = _hub(tmp_path, {1: a, 2: b})
    await hub.step()
    queue = hub.add_client()

    supervisor.worker(2).state = "stopped"
    await hub.step()

    assert list(hub.snapshot()["radios"]) == ["1"]
    assert _drain(queue) == [{"type": "unreads", **hub.snapshot()}]


async def test_a_failing_worker_keeps_its_last_totals(tmp_path):
    a, b = make_worker(counts={ALICE: 1}), make_worker()
    _, hub = _hub(tmp_path, {1: a, 2: b})
    await hub.step()
    a.state.fail = True
    hub.mark_dirty(1)
    await hub.step()
    assert hub.snapshot()["radios"]["1"]["unread"] == 1


async def test_worker_events_mark_the_radio_dirty(tmp_path):
    events = [
        json.dumps({"type": "health", "data": {}}),
        json.dumps({"type": "contact", "data": {}}),
        "not json",
        json.dumps({"type": "message", "data": {}}),
    ]
    opened: list[tuple[str, dict]] = []
    release = asyncio.Event()

    class Stream:
        def __init__(self, url, **kwargs):
            opened.append((url, kwargs))
            self.events = list(events) if ":9001/" in url else []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def __aiter__(self):
            return self

        async def __anext__(self):
            await release.wait()
            if self.events:
                return self.events.pop(0)
            await asyncio.Event().wait()

    a, b = make_worker(), make_worker()
    supervisor, hub = _hub(tmp_path, {1: a, 2: b}, connect=Stream)
    await hub.step()
    for _ in range(20):
        await asyncio.sleep(0)
    # Connecting marks a radio dirty; start clean to see what the events do.
    hub._dirty.clear()
    release.set()
    for _ in range(20):
        await asyncio.sleep(0)

    assert hub._dirty == {1}  # only radio 1's stream carried a message event
    url, kwargs = next(item for item in opened if ":9001/" in item[0])
    assert url == "ws://127.0.0.1:9001/api/ws?events=chat"
    assert kwargs["additional_headers"] == {"x-rtfm-worker-token": "tok-1"}
    await hub.close()


async def test_slow_client_does_not_block(tmp_path):
    a, b = make_worker(), make_worker()
    _, hub = _hub(tmp_path, {1: a, 2: b})
    queue = hub.add_client()
    for n in range(200):
        hub._broadcast({"type": "unreads", "n": n})
    assert queue.qsize() <= 50
    assert _drain(queue)[-1]["n"] == 199
    hub.remove_client(queue)
    hub._broadcast({"type": "unreads"})
    assert queue.empty()
