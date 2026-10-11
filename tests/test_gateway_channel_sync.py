"""Tests for the shared channel list of multi-radio mode (plan 30, part C)."""

from __future__ import annotations

import json

import httpx
import pytest
from gateway_fake_channels import PortRouter, channel, hashtag_key, make_channel_worker

from app.gateway.channel_sync import ChannelSync, changes_channels, deleted_keys
from app.gateway.registry import RadioRegistry, TcpTransport
from app.gateway.supervisor import Worker

KEY_PRIVATE = "AA" * 16
KEY_CUSTOM = "BB" * 16
HASHTAG = channel("#mesh")
PRIVATE = channel("Family", KEY_PRIVATE, is_hashtag=False)
CUSTOM = channel("#imported", KEY_CUSTOM, is_hashtag=True)
PUBLIC = channel("Public", "8B3387E9C5CDEA6AC9E5EDBAA115CD72", is_hashtag=False)


class Supervisor:
    def __init__(self, radio_ids: list[int]) -> None:
        self.workers = {
            i: Worker(i, state="running", port=9000 + i, token=f"tok-{i}") for i in radio_ids
        }

    def worker(self, radio_id: int) -> Worker:
        return self.workers.setdefault(radio_id, Worker(radio_id))


def _setup(tmp_path, apps: dict[int, object]):
    registry = RadioRegistry(tmp_path / "radios.json")
    for radio_id in apps:
        registry.add(name=f"r{radio_id}", transport=TcpTransport(host=f"10.0.0.{radio_id}"))
    supervisor = Supervisor(list(apps))
    client = httpx.AsyncClient(
        transport=PortRouter({9000 + radio_id: app for radio_id, app in apps.items()})
    )
    return registry, supervisor, ChannelSync(registry, supervisor, client)


def _keys(app) -> set[str]:
    return set(app.state.channels)


async def test_every_radio_ends_up_with_every_channel(tmp_path):
    a = make_channel_worker(PUBLIC, HASHTAG)
    b = make_channel_worker(PUBLIC, PRIVATE)
    c = make_channel_worker(PUBLIC, CUSTOM)
    _, _, sync = _setup(tmp_path, {1: a, 2: b, 3: c})

    await sync.reconcile()

    everything = {PUBLIC["key"], HASHTAG["key"], KEY_PRIVATE, KEY_CUSTOM}
    assert _keys(a) == _keys(b) == _keys(c) == everything
    for app in (a, b, c):
        assert app.state.channels[HASHTAG["key"]] == HASHTAG
        assert app.state.channels[KEY_PRIVATE] == PRIVATE
        assert app.state.channels[KEY_CUSTOM] == CUSTOM

    before = [list(app.state.calls) for app in (a, b, c)]
    await sync.reconcile()
    assert [list(app.state.calls) for app in (a, b, c)] == before


async def test_worker_token_is_sent(tmp_path):
    seen: list[str | None] = []
    a = make_channel_worker(PUBLIC, HASHTAG)
    b = make_channel_worker(PUBLIC)

    @b.middleware("http")
    async def record(request, call_next):
        seen.append(request.headers.get("x-rtfm-worker-token"))
        return await call_next(request)

    _, _, sync = _setup(tmp_path, {1: a, 2: b})
    await sync.reconcile()
    assert seen and set(seen) == {"tok-2"}


async def test_delete_is_replayed_and_not_brought_back(tmp_path):
    a = make_channel_worker(PUBLIC)  # the user deleted #mesh here
    b = make_channel_worker(PUBLIC, HASHTAG)
    c = make_channel_worker(PUBLIC, HASHTAG)
    registry, _, sync = _setup(tmp_path, {1: a, 2: b, 3: c})

    sync.note_deleted(1, [HASHTAG["key"]])
    assert registry.get(2).pending_channel_deletes == [HASHTAG["key"]]
    assert registry.get(1).pending_channel_deletes == []

    await sync.reconcile()

    assert _keys(a) == _keys(b) == _keys(c) == {PUBLIC["key"]}
    assert registry.get(2).pending_channel_deletes == []
    assert registry.get(3).pending_channel_deletes == []


async def test_stopped_radio_gets_the_delete_when_it_starts(tmp_path):
    a = make_channel_worker(PUBLIC)
    b = make_channel_worker(PUBLIC, HASHTAG)
    registry, supervisor, sync = _setup(tmp_path, {1: a, 2: b})
    supervisor.worker(2).state = "stopped"

    sync.note_deleted(1, [HASHTAG["key"]])
    await sync.reconcile()
    assert HASHTAG["key"] in _keys(b)

    saved = json.loads((tmp_path / "radios.json").read_text())
    assert saved["radios"][1]["pending_channel_deletes"] == [HASHTAG["key"]]

    supervisor.worker(2).state = "running"
    await sync.reconcile()
    assert _keys(a) == _keys(b) == {PUBLIC["key"]}
    assert registry.get(2).pending_channel_deletes == []


async def test_failed_delete_stays_pending_and_does_not_spread(tmp_path):
    a = make_channel_worker(PUBLIC)
    b = make_channel_worker(PUBLIC, HASHTAG, fail_delete=True)
    registry, _, sync = _setup(tmp_path, {1: a, 2: b})

    sync.note_deleted(1, [HASHTAG["key"]])
    await sync.reconcile()

    assert registry.get(2).pending_channel_deletes == [HASHTAG["key"]]
    assert _keys(a) == {PUBLIC["key"]}


async def test_failed_add_is_tried_once_per_worker_run(tmp_path):
    a = make_channel_worker(PUBLIC, HASHTAG, PRIVATE)
    b = make_channel_worker(PUBLIC, refuse_create=True)
    _, supervisor, sync = _setup(tmp_path, {1: a, 2: b})

    await sync.reconcile()
    await sync.reconcile()
    assert len(b.state.calls) == 2  # one attempt per channel, not repeated

    supervisor.worker(2).token = "tok-2-restarted"
    await sync.reconcile()
    assert len(b.state.calls) == 4


async def test_nothing_to_do_with_a_single_running_radio(tmp_path):
    a = make_channel_worker(PUBLIC, HASHTAG)
    b = make_channel_worker(PUBLIC)
    _, supervisor, sync = _setup(tmp_path, {1: a, 2: b})
    supervisor.worker(2).state = "crashed"
    await sync.reconcile()
    assert _keys(b) == {PUBLIC["key"]}
    assert b.state.calls == []


async def test_unreachable_worker_is_skipped(tmp_path):
    a = make_channel_worker(PUBLIC, HASHTAG)
    b = make_channel_worker(PUBLIC)
    registry, supervisor, _ = _setup(tmp_path, {1: a, 2: b})

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    sync = ChannelSync(
        registry, supervisor, httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    )
    await sync.reconcile()  # must not raise


@pytest.mark.parametrize(
    ("method", "path", "body", "expected"),
    [
        ("DELETE", f"api/channels/{'ab' * 16}", b"", ["AB" * 16]),
        ("DELETE", "api/channels/not-a-key", b"", []),
        ("DELETE", f"api/contacts/{'ab' * 16}", b"", []),
        (
            "POST",
            "api/channels/bulk-delete",
            json.dumps({"keys": ["ab" * 16, "zz", 5, "CD" * 16]}).encode(),
            ["AB" * 16, "CD" * 16],
        ),
        ("POST", "api/channels/bulk-delete", b"not json", []),
        ("POST", "api/channels", b'{"name": "#x"}', []),
    ],
)
def test_deleted_keys(method, path, body, expected):
    assert deleted_keys(method, path, body) == expected


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "api/channels", True),
        ("POST", "api/channels/import", True),
        ("DELETE", f"api/channels/{'ab' * 16}", True),
        ("POST", "api/communities", True),
        ("POST", "api/communities/abc/hashtags", True),
        ("GET", "api/channels", False),
        ("POST", "api/contacts", False),
        ("POST", "api/channelsets", False),
    ],
)
def test_changes_channels(method, path, expected):
    assert changes_channels(method, path) is expected


def test_fake_hashtag_key_matches_the_real_derivation():
    # sha256("#mesh")[:16], the rule in app/routers/channels.py
    assert hashtag_key("#mesh") == HASHTAG["key"]
    assert len(HASHTAG["key"]) == 32


async def test_a_new_worker_run_asks_for_a_reconcile(tmp_path):
    a = make_channel_worker(PUBLIC)
    b = make_channel_worker(PUBLIC)
    _, supervisor, sync = _setup(tmp_path, {1: a, 2: b})

    sync.note_worker_alive(1)
    assert sync._wake.is_set()
    sync._wake.clear()

    sync.note_worker_alive(1)
    assert not sync._wake.is_set()

    supervisor.worker(1).token = "tok-1-restarted"
    sync.note_worker_alive(1)
    assert sync._wake.is_set()
