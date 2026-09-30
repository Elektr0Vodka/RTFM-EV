"""Host repeater neighbours table and the neighbour poll (DMC observer ``neighbors``).

The poll transmits, so every test here patches ``radio_manager``, ``radio_snapshot``
and ``ContactRepository`` in ``host_repeater_neighbor_poll``: nothing reaches a transport.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from meshcore.events import EventType
from nacl.signing import SigningKey

from app.services import host_repeater_neighbor_poll as poll_module
from app.services.host_repeater import HostRepeaterRuntime
from app.services.host_repeater_engine import RadioParams
from app.services.host_repeater_link import RadioSnapshot
from app.services.host_repeater_neighbor_poll import NeighbourPoller
from app.services.host_repeater_neighbors import (
    MAX_NEIGHBOURS,
    NeighbourTable,
    zero_hop_repeater_advert,
)
from app.services.host_repeater_settings import HostRepeaterSettings

OWN_KEY = bytes(range(32))
NB1 = "aa" * 32
NB2 = "bb" * 32


def _advert(key: SigningKey, node_type: int) -> bytes:
    pub = bytes(key.verify_key)
    stamp = (1).to_bytes(4, "little")
    app_data = bytes([0x80 | node_type]) + b"node"
    sig = key.sign(pub + stamp + app_data).signature
    return pub + stamp + sig + app_data


# ── table ───────────────────────────────────────────────────────────────


def test_put_updates_known_and_replaces_least_recently_heard():
    table = NeighbourTable()
    for i in range(MAX_NEIGHBOURS):
        table.put(f"{i:064x}", float(i), heard_at=1000.0 + i)
    table.put(f"{5:064x}", 9.0, heard_at=5000.0)  # known: updated in place
    assert len(table.entries) == MAX_NEIGHBOURS
    table.put(NB1, 1.0, heard_at=6000.0)  # full: replaces the oldest (index 0)
    assert f"{0:064x}" not in table.entries and NB1 in table.entries
    assert table.ordered()[0].public_key == NB1
    assert table.ordered()[1].snr == 9.0


def test_snapshot_orders_newest_then_strongest():
    table = NeighbourTable()
    table.put(NB1, 2.0, heard_at=100.0)
    table.put(NB2, 8.0, heard_at=100.0)
    snap = table.snapshot(now=160.0)
    assert [n["pubkey"] for n in snap["neighbors"]] == [NB2, NB1]
    assert snap["neighbors"][0]["heard_secs_ago"] == 60
    assert snap["neighbors"][0]["status"] == "unsent"


def test_zero_hop_repeater_advert_rule():
    key = SigningKey.generate()
    repeater = _advert(key, 2)
    assert zero_hop_repeater_advert(0x04, 0, repeater) == bytes(key.verify_key).hex()
    assert zero_hop_repeater_advert(0x04, 1, repeater) is None  # relayed, not a neighbour
    assert zero_hop_repeater_advert(0x04, 0, _advert(key, 1)) is None  # a companion
    tampered = repeater[:-1] + b"X"
    assert zero_hop_repeater_advert(0x04, 0, tampered) is None  # bad signature
    assert zero_hop_repeater_advert(0x05, 0, repeater) is None


# ── poll ────────────────────────────────────────────────────────────────


def snap(**overrides) -> RadioSnapshot:
    base = {
        "connected": True,
        "public_key": OWN_KEY,
        "name": "me",
        "radio": RadioParams(freq_mhz=869.618, bw_khz=62.5, sf=8, cr=8),
        "firmware_ver_code": 13,
        "device_model": "T-Echo",
        "client_repeat": False,
        "lock_busy": False,
    }
    base.update(overrides)
    return RadioSnapshot(**base)


class FakeRadio:
    """Records every command; discover replies and region replies are scripted."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.discover_replies: list[dict] = []
        self.region_replies: dict[str, object] = {}
        self._subs: list = []

    @asynccontextmanager
    async def radio_operation(self, name: str, **kwargs):
        self.calls.append(("op", name))
        yield SimpleNamespace(subscribe=self._subscribe, commands=self)

    def _subscribe(self, event_type, callback, filters):
        assert event_type == EventType.DISCOVER_RESPONSE
        sub = SimpleNamespace(callback=callback, filters=filters, active=True)
        sub.unsubscribe = lambda: setattr(sub, "active", False)
        self._subs.append(sub)
        return sub

    async def send_node_discover_req(self, filter, prefix_only=True, tag=None, since=None):
        self.calls.append(("discover", filter, prefix_only, since))
        tag_hex = tag.to_bytes(4, "little").hex()
        for reply in self.discover_replies:
            for sub in self._subs:
                if sub.active and sub.filters["tag"] == tag_hex:
                    sub.callback(SimpleNamespace(payload=reply))
        return SimpleNamespace(type=EventType.OK, payload={})

    async def add_contact(self, contact):
        self.calls.append(("add", contact["public_key"], contact["out_path_len"]))
        return SimpleNamespace(type=EventType.OK, payload={})

    async def req_regions_sync(self, key, timeout=0, min_timeout=0):
        self.calls.append(("regions", key))
        reply = self.region_replies.get(key)
        if isinstance(reply, Exception):
            raise reply
        return reply

    async def remove_contact(self, key):
        self.calls.append(("remove", key))
        return SimpleNamespace(type=EventType.OK, payload={})


class FakeContacts:
    known: dict = {}

    @classmethod
    async def get_by_key(cls, key):
        return cls.known.get(key)


@pytest.fixture
def setup(monkeypatch):
    runtime = HostRepeaterRuntime()
    runtime.settings = HostRepeaterSettings(shadow_enabled=True, neighbor_poll_enabled=True)
    radio = FakeRadio()
    current = {"snap": snap()}
    FakeContacts.known = {}
    monkeypatch.setattr(poll_module, "radio_manager", radio)
    monkeypatch.setattr(poll_module, "radio_snapshot", lambda: current["snap"])
    monkeypatch.setattr(poll_module, "ContactRepository", FakeContacts)
    monkeypatch.setattr(poll_module, "DISCOVER_WINDOW_SECONDS", 0.05)
    monkeypatch.setattr(poll_module, "REGION_SETTLE_SECONDS", 0.0)
    return SimpleNamespace(
        runtime=runtime, radio=radio, current=current, poller=NeighbourPoller(runtime)
    )


async def test_poll_discovers_then_queries_each_neighbour_zero_hop(setup):
    radio = setup.radio
    radio.discover_replies = [
        {"pubkey": NB1, "node_type": 2, "SNR": 6.5},
        {"pubkey": NB2, "node_type": 2, "SNR": 3.0},
        {"pubkey": "cc" * 32, "node_type": 1, "SNR": 9.0},  # not a repeater
        {"pubkey": OWN_KEY.hex(), "node_type": 2, "SNR": 9.0},  # ourselves
    ]
    radio.region_replies = {NB1: "*,nl,nl-ut", NB2: None}
    contact = SimpleNamespace(
        on_radio=True,
        to_radio_dict=lambda: {
            "public_key": NB1,
            "out_path": "1122",
            "out_path_len": 2,
            "out_path_hash_mode": 0,
        },
    )
    FakeContacts.known = {NB1: contact}

    await setup.poller.poll_once()

    table = setup.runtime.neighbors
    assert set(table.entries) == {NB1, NB2}
    assert ("discover", 1 << 2, False, 0) in radio.calls
    # Each request goes out zero-hop (path length 0); NB1's stored route is restored,
    # NB2 (not on the radio before) is removed again.
    assert ("add", NB1, 0) in radio.calls and ("add", NB1, 2) in radio.calls
    assert ("add", NB2, 0) in radio.calls and ("remove", NB2) in radio.calls
    assert ("remove", NB1) not in radio.calls
    assert table.entries[NB1].status == "responded"
    assert table.entries[NB1].scopes == "*,nl,nl-ut"
    assert table.entries[NB2].status == "timeout"
    poll = table.poll
    assert (poll.discovered, poll.queried, poll.responded) == (2, 2, 1)
    assert poll.running is False and poll.last_finished is not None
    assert table.version == 1


async def test_region_send_failure_is_recorded(setup):
    setup.runtime.neighbors.put(NB1, 1.0)
    setup.radio.region_replies = {NB1: RuntimeError("boom")}
    await setup.poller.poll_once()
    assert setup.runtime.neighbors.entries[NB1].status == "send_failed"


async def test_tick_waits_for_eligibility_and_the_interval(setup, monkeypatch):
    ran: list[float] = []

    async def fake_poll():
        ran.append(1.0)
        setup.runtime.neighbors.poll.last_finished = now["t"]

    monkeypatch.setattr(setup.poller, "poll_once", fake_poll)
    now = {"t": 10_000.0}
    assert not await setup.poller.tick(now["t"])  # first eligible tick: start the delay
    now["t"] += poll_module.FIRST_POLL_DELAY_SECONDS
    assert await setup.poller.tick(now["t"])
    now["t"] += 3600.0
    assert not await setup.poller.tick(now["t"])  # 24 h interval not over
    now["t"] += 24 * 3600.0
    assert await setup.poller.tick(now["t"])
    assert len(ran) == 2

    # Not eligible: poll off, host repeater off, disconnected, OpenHop.
    for change in (
        lambda: setattr(setup.runtime, "settings", HostRepeaterSettings(shadow_enabled=True)),
        lambda: setattr(
            setup.runtime, "settings", HostRepeaterSettings(neighbor_poll_enabled=True)
        ),
        lambda: setup.current.update(snap=snap(connected=False)),
        lambda: setup.current.update(snap=snap(device_model="OpenHop")),
    ):
        setup.runtime.settings = HostRepeaterSettings(
            shadow_enabled=True, neighbor_poll_enabled=True
        )
        setup.current["snap"] = snap()
        change()
        now["t"] += 10 * 24 * 3600.0
        assert not await setup.poller.tick(now["t"])
        assert setup.runtime.neighbors.poll.next_due is None
    assert len(ran) == 2


def test_interval_bounds():
    with pytest.raises(ValueError):
        HostRepeaterSettings(neighbor_poll_interval_hours=11)
    with pytest.raises(ValueError):
        HostRepeaterSettings(neighbor_poll_interval_hours=337)
    assert HostRepeaterSettings().neighbor_poll_enabled is False
