"""Tests for channel sets (plan 08 slice 1): CRUD and additive apply to radio slots."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.models import ChannelSetEntry
from app.repository import ChannelRepository
from app.services.channel_set_apply import apply_channel_set

KEY_A = "A" * 32
KEY_B = "B" * 32
KEY_C = "C" * 32
KEY_OTHER = "D" * 32


def _event(event_type, payload=None):
    event = MagicMock()
    event.type = event_type
    event.payload = payload or {}
    return event


def _fake_radio(slots: dict[int, tuple[str, str]], limit: int, fail_keys=(), raise_keys=()):
    """A fake MeshCore whose channel slots are ``{idx: (name, key_hex)}``; others empty."""
    state = dict(slots)
    mc = MagicMock()

    async def get_channel(idx):
        if idx >= limit:
            return _event(EventType.ERROR)
        name, key = state.get(idx, ("", "00" * 16))
        return _event(
            EventType.CHANNEL_INFO,
            {"channel_idx": idx, "channel_name": name, "channel_secret": bytes.fromhex(key)},
        )

    async def set_channel(channel_idx, channel_name, channel_secret):
        key = channel_secret.hex().upper()
        if key in raise_keys:
            raise RuntimeError("serial glitch")
        if key in fail_keys:
            return _event(EventType.ERROR, {"reason": "bad"})
        state[channel_idx] = (channel_name, key)
        return _event(EventType.OK)

    mc.commands.get_channel = AsyncMock(side_effect=get_channel)
    mc.commands.set_channel = AsyncMock(side_effect=set_channel)
    return mc, state


def _entries(*pairs):
    return [ChannelSetEntry(key=k, name=n) for k, n in pairs]


class TestApplyChannelSet:
    @pytest.mark.asyncio
    async def test_loads_into_free_slots_skipping_send_slot_without_reuse(self):
        mc, state = _fake_radio({}, limit=4)

        items = await apply_channel_set(
            mc, _entries((KEY_A, "#alpha"), (KEY_B, "#bravo")), channel_limit=4, reuse_enabled=False
        )

        assert [(i.key, i.status, i.slot) for i in items] == [
            (KEY_A, "loaded", 1),
            (KEY_B, "loaded", 2),
        ]
        assert state[1] == ("#alpha", KEY_A)
        assert state[2] == ("#bravo", KEY_B)
        assert 0 not in state

    @pytest.mark.asyncio
    async def test_slot_zero_is_usable_when_slots_are_reused(self):
        mc, state = _fake_radio({}, limit=4)

        items = await apply_channel_set(
            mc, _entries((KEY_A, "#alpha")), channel_limit=4, reuse_enabled=True
        )

        assert (items[0].status, items[0].slot) == ("loaded", 0)
        assert state[0] == ("#alpha", KEY_A)

    @pytest.mark.asyncio
    async def test_channel_already_on_radio_is_not_rewritten(self):
        mc, state = _fake_radio({2: ("#alpha", KEY_A)}, limit=4)

        items = await apply_channel_set(
            mc, _entries((KEY_A, "#alpha")), channel_limit=4, reuse_enabled=False
        )

        assert (items[0].status, items[0].slot) == ("already_loaded", 2)
        mc.commands.set_channel.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_copy_in_send_slot_does_not_count_without_reuse(self):
        # Slot 0 is overwritten by the next channel send on TCP, so a copy there
        # is not a loaded channel.
        mc, state = _fake_radio({0: ("#alpha", KEY_A)}, limit=4)

        items = await apply_channel_set(
            mc, _entries((KEY_A, "#alpha")), channel_limit=4, reuse_enabled=False
        )

        assert (items[0].status, items[0].slot) == ("loaded", 1)

    @pytest.mark.asyncio
    async def test_other_channels_are_never_evicted(self):
        mc, state = _fake_radio({1: ("#other", KEY_OTHER)}, limit=3)

        items = await apply_channel_set(
            mc,
            _entries((KEY_A, "#alpha"), (KEY_B, "#bravo")),
            channel_limit=3,
            reuse_enabled=False,
        )

        assert [(i.status, i.slot, i.error) for i in items] == [
            ("loaded", 2, None),
            ("failed", None, "no_free_slot"),
        ]
        assert state[1] == ("#other", KEY_OTHER)

    @pytest.mark.asyncio
    async def test_failures_do_not_stop_the_remaining_channels(self):
        mc, state = _fake_radio({}, limit=5, fail_keys={KEY_A}, raise_keys={KEY_B})

        items = await apply_channel_set(
            mc,
            _entries((KEY_A, "#alpha"), (KEY_B, "#bravo"), (KEY_C, "#charlie")),
            channel_limit=5,
            reuse_enabled=False,
        )

        assert [(i.key, i.status, i.error) for i in items] == [
            (KEY_A, "failed", "radio_error"),
            (KEY_B, "failed", "radio_error"),
            (KEY_C, "loaded", None),
        ]
        # The slot a failed write targeted stays free for the next channel.
        assert items[2].slot == 1
        assert state[1] == ("#charlie", KEY_C)

    @pytest.mark.asyncio
    async def test_unreadable_slot_is_not_treated_as_free(self):
        mc, state = _fake_radio({}, limit=3)
        original = mc.commands.get_channel.side_effect

        async def get_channel(idx):
            if idx == 1:
                return _event(EventType.ERROR)
            return await original(idx)

        mc.commands.get_channel = AsyncMock(side_effect=get_channel)

        items = await apply_channel_set(
            mc, _entries((KEY_A, "#alpha")), channel_limit=3, reuse_enabled=False
        )

        assert (items[0].status, items[0].slot) == ("loaded", 2)


@pytest.fixture
def _no_channel_broadcast():
    with patch("app.routers.channels.broadcast_event"):
        yield


async def _seed_channels():
    await ChannelRepository.upsert(key=KEY_A, name="#alpha", is_hashtag=True)
    await ChannelRepository.upsert(key=KEY_B, name="Team", is_hashtag=False)


class TestChannelSetCrud:
    @pytest.mark.asyncio
    async def test_empty_list_by_default(self, test_db, client):
        response = await client.get("/api/channel-sets")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_create_list_rename_delete(self, test_db, client):
        await _seed_channels()

        created = await client.post(
            "/api/channel-sets",
            json={"name": " Field kit ", "channel_keys": [KEY_B, KEY_A.lower(), KEY_B]},
        )
        assert created.status_code == 200
        body = created.json()
        assert body["name"] == "Field kit"
        # Keys normalised to upper case, duplicates dropped, order kept, names from the DB.
        assert body["channels"] == [
            {"key": KEY_B, "name": "Team"},
            {"key": KEY_A, "name": "#alpha"},
        ]
        set_id = body["id"]

        listed = (await client.get("/api/channel-sets")).json()
        assert [s["id"] for s in listed] == [set_id]

        renamed = await client.patch(f"/api/channel-sets/{set_id}", json={"name": "Hike"})
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Hike"
        assert len(renamed.json()["channels"]) == 2

        trimmed = await client.patch(f"/api/channel-sets/{set_id}", json={"channel_keys": [KEY_A]})
        assert [c["key"] for c in trimmed.json()["channels"]] == [KEY_A]

        deleted = await client.delete(f"/api/channel-sets/{set_id}")
        assert deleted.status_code == 200
        assert (await client.get("/api/channel-sets")).json() == []

    @pytest.mark.asyncio
    async def test_unknown_channel_key_is_rejected(self, test_db, client):
        await _seed_channels()
        response = await client.post(
            "/api/channel-sets", json={"name": "Kit", "channel_keys": [KEY_A, KEY_C]}
        )
        assert response.status_code == 400
        assert KEY_C[:8] in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_blank_name_and_empty_channels_are_rejected(self, test_db, client):
        await _seed_channels()
        blank = await client.post("/api/channel-sets", json={"name": "  ", "channel_keys": [KEY_A]})
        assert blank.status_code == 422
        empty = await client.post("/api/channel-sets", json={"name": "Kit", "channel_keys": []})
        assert empty.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_set_is_404(self, test_db, client):
        assert (await client.patch("/api/channel-sets/nope", json={"name": "x"})).status_code == 404
        assert (await client.delete("/api/channel-sets/nope")).status_code == 404
        assert (await client.post("/api/channel-sets/nope/apply")).status_code == 404


def _mock_runtime(mc, *, reuse=False, max_channels=4):
    runtime = MagicMock()
    runtime.require_connected = MagicMock(return_value=mc)
    runtime.channel_slot_reuse_enabled = MagicMock(return_value=reuse)
    runtime.max_channels = max_channels
    runtime.note_channel_slot_loaded = MagicMock()

    @asynccontextmanager
    async def _op(*_args, **_kwargs):
        yield mc

    runtime.radio_operation = _op
    return runtime


class TestChannelSetApplyRoute:
    @pytest.mark.asyncio
    async def test_apply_uses_current_db_name_and_notes_slots(self, test_db, client):
        await _seed_channels()
        set_id = (
            await client.post(
                "/api/channel-sets", json={"name": "Kit", "channel_keys": [KEY_A, KEY_B]}
            )
        ).json()["id"]
        await ChannelRepository.upsert(key=KEY_B, name="Team renamed", is_hashtag=False)
        mc, state = _fake_radio({3: ("Team", KEY_B)}, limit=4)
        runtime = _mock_runtime(mc, reuse=True)

        with (
            patch("app.routers.channel_sets.radio_manager", runtime),
            patch("app.routers.channel_sets.get_radio_channel_limit", return_value=4),
        ):
            response = await client.post(f"/api/channel-sets/{set_id}/apply")

        assert response.status_code == 200
        body = response.json()
        assert body["loaded"] == 1
        assert body["already_loaded"] == 1
        assert body["failed"] == 0
        assert [(i["key"], i["status"], i["slot"]) for i in body["items"]] == [
            (KEY_A, "loaded", 0),
            (KEY_B, "already_loaded", 3),
        ]
        assert state[0] == ("#alpha", KEY_A)
        runtime.note_channel_slot_loaded.assert_any_call(KEY_A, 0)
        runtime.note_channel_slot_loaded.assert_any_call(KEY_B, 3)

    @pytest.mark.asyncio
    async def test_apply_uses_stored_name_when_channel_was_deleted(self, test_db, client):
        await _seed_channels()
        set_id = (
            await client.post("/api/channel-sets", json={"name": "Kit", "channel_keys": [KEY_A]})
        ).json()["id"]
        await ChannelRepository.delete(KEY_A)
        mc, state = _fake_radio({}, limit=4)

        with (
            patch("app.routers.channel_sets.radio_manager", _mock_runtime(mc)),
            patch("app.routers.channel_sets.get_radio_channel_limit", return_value=4),
        ):
            response = await client.post(f"/api/channel-sets/{set_id}/apply")

        assert response.json()["items"][0]["name"] == "#alpha"
        assert state[1] == ("#alpha", KEY_A)

    @pytest.mark.asyncio
    async def test_apply_without_radio_is_423(self, test_db, client):
        await _seed_channels()
        set_id = (
            await client.post("/api/channel-sets", json={"name": "Kit", "channel_keys": [KEY_A]})
        ).json()["id"]
        runtime = MagicMock()
        runtime.require_connected = MagicMock(
            side_effect=HTTPException(status_code=423, detail="Radio not connected")
        )

        with patch("app.routers.channel_sets.radio_manager", runtime):
            response = await client.post(f"/api/channel-sets/{set_id}/apply")

        assert response.status_code == 423
