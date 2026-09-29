"""Tests for channel sets / loadouts (plan 08): CRUD, additive apply of channels + contacts."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.models import ChannelSetContact, ChannelSetEntry
from app.radio_sync import (
    clear_loadout_protection,
    get_loadout_protected_keys,
    get_radio_residency,
    protect_loadout_contacts,
)
from app.repository import ChannelRepository, ContactRepository
from app.services.channel_set_apply import apply_channel_set, apply_contacts

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


# --- Slice 2: contacts in a channel set ("loadout") ---------------------------

CONTACT_A = "a1" * 32
CONTACT_B = "b2" * 32
CONTACT_C = "c3" * 32


@pytest.fixture(autouse=True)
def _clear_loadout_protection():
    clear_loadout_protection()
    yield
    clear_loadout_protection()


async def _insert_contact(public_key, name, **overrides):
    data = {
        "public_key": public_key,
        "name": name,
        "type": 1,
        "flags": 0,
        "direct_path": None,
        "direct_path_len": -1,
        "direct_path_hash_mode": -1,
        "last_advert": None,
        "lat": None,
        "lon": None,
        "last_seen": None,
        "on_radio": False,
        "last_contacted": None,
        "first_seen": None,
    }
    data.update(overrides)
    await ContactRepository.upsert(data)
    contact = await ContactRepository.get_by_key(public_key)
    assert contact is not None
    return contact


def _fake_contact_radio(on_radio=(), *, full_after=None, fail_keys=(), list_fails=False):
    """A fake MeshCore contact table. ``full_after`` = adds accepted before TABLE_FULL."""
    state = {key: {"public_key": key} for key in on_radio}
    added: list[str] = []
    mc = MagicMock()

    async def get_contacts(timeout=None):
        if list_fails:
            return _event(EventType.ERROR, {"reason": "timeout"})
        return _event(EventType.CONTACTS, dict(state))

    async def add_contact(payload):
        key = payload["public_key"]
        if key in fail_keys:
            return _event(EventType.ERROR, {"error_code": 1})
        if full_after is not None and len(added) >= full_after:
            return _event(EventType.ERROR, {"error_code": 3})
        added.append(key)
        state[key] = payload
        return _event(EventType.OK)

    mc.commands.get_contacts = AsyncMock(side_effect=get_contacts)
    mc.commands.add_contact = AsyncMock(side_effect=add_contact)
    mc.get_contact_by_key_prefix = MagicMock(
        side_effect=lambda prefix: next((v for k, v in state.items() if k.startswith(prefix)), None)
    )
    return mc, added


def _contact_entry(contact_or_key, name=None):
    key = contact_or_key if isinstance(contact_or_key, str) else contact_or_key.public_key
    return ChannelSetContact(public_key=key, name=name)


class TestApplyContacts:
    @pytest.mark.asyncio
    async def test_adds_missing_and_reports_already_loaded(self, test_db):
        a = await _insert_contact(CONTACT_A, "Alice")
        b = await _insert_contact(CONTACT_B, "Bob")
        mc, added = _fake_contact_radio(on_radio=[CONTACT_B])

        items = await apply_contacts(mc, [(_contact_entry(a), a), (_contact_entry(b), b)])

        assert [(i.public_key, i.status, i.error) for i in items] == [
            (CONTACT_A, "loaded", None),
            (CONTACT_B, "already_loaded", None),
        ]
        assert [i.name for i in items] == ["Alice", "Bob"]
        assert added == [CONTACT_A]

    @pytest.mark.asyncio
    async def test_table_full_fails_the_rest_without_sending(self, test_db):
        a = await _insert_contact(CONTACT_A, "Alice")
        b = await _insert_contact(CONTACT_B, "Bob")
        c = await _insert_contact(CONTACT_C, "Carol")
        mc, added = _fake_contact_radio(full_after=1)

        items = await apply_contacts(
            mc, [(_contact_entry(a), a), (_contact_entry(b), b), (_contact_entry(c), c)]
        )

        assert [(i.status, i.error) for i in items] == [
            ("loaded", None),
            ("failed", "table_full"),
            ("failed", "table_full"),
        ]
        # Two adds sent: the one accepted and the one refused; Carol never sent.
        assert mc.commands.add_contact.await_count == 2
        assert added == [CONTACT_A]

    @pytest.mark.asyncio
    async def test_unknown_excluded_and_radio_error(self, test_db):
        b = await _insert_contact(CONTACT_B, "Bob")
        await ContactRepository.set_radio_policy(CONTACT_B, "excluded")
        b = await ContactRepository.get_by_key(CONTACT_B)
        c = await _insert_contact(CONTACT_C, "Carol")
        mc, added = _fake_contact_radio(fail_keys=[CONTACT_C])

        items = await apply_contacts(
            mc,
            [
                (_contact_entry(CONTACT_A, "Gone"), None),
                (_contact_entry(b), b),
                (_contact_entry(c), c),
            ],
        )

        assert [(i.name, i.status, i.error) for i in items] == [
            ("Gone", "failed", "unknown_contact"),
            ("Bob", "failed", "excluded"),
            ("Carol", "failed", "radio_error"),
        ]
        assert added == []

    @pytest.mark.asyncio
    async def test_falls_back_to_library_cache_when_radio_list_fails(self, test_db):
        a = await _insert_contact(CONTACT_A, "Alice")
        b = await _insert_contact(CONTACT_B, "Bob")
        mc, added = _fake_contact_radio(on_radio=[CONTACT_A], list_fails=True)

        items = await apply_contacts(mc, [(_contact_entry(a), a), (_contact_entry(b), b)])

        assert [i.status for i in items] == ["already_loaded", "loaded"]
        assert added == [CONTACT_B]


class TestChannelSetContactsCrud:
    @pytest.mark.asyncio
    async def test_contacts_only_set_round_trips(self, test_db, client):
        await _insert_contact(CONTACT_A, "Alice")

        created = await client.post(
            "/api/channel-sets",
            json={"name": "Buddies", "contact_keys": [CONTACT_A.upper(), CONTACT_A]},
        )

        assert created.status_code == 200
        body = created.json()
        assert body["channels"] == []
        assert body["contacts"] == [{"public_key": CONTACT_A, "name": "Alice"}]

    @pytest.mark.asyncio
    async def test_existing_sets_without_contacts_still_load(self, test_db, client):
        await _seed_channels()
        created = await client.post(
            "/api/channel-sets", json={"name": "Kit", "channel_keys": [KEY_A]}
        )
        assert created.json()["contacts"] == []

    @pytest.mark.asyncio
    async def test_unknown_or_prefix_contact_is_rejected(self, test_db, client):
        response = await client.post(
            "/api/channel-sets", json={"name": "Kit", "contact_keys": [CONTACT_B, "a1a1a1"]}
        )
        assert response.status_code == 400
        assert CONTACT_B[:12] in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_update_cannot_empty_the_set(self, test_db, client):
        await _seed_channels()
        await _insert_contact(CONTACT_A, "Alice")
        set_id = (
            await client.post(
                "/api/channel-sets",
                json={"name": "Kit", "channel_keys": [KEY_A], "contact_keys": [CONTACT_A]},
            )
        ).json()["id"]

        only_contacts = await client.patch(f"/api/channel-sets/{set_id}", json={"channel_keys": []})
        assert only_contacts.status_code == 200
        assert only_contacts.json()["channels"] == []

        emptied = await client.patch(f"/api/channel-sets/{set_id}", json={"contact_keys": []})
        assert emptied.status_code == 400


class TestChannelSetContactApplyRoute:
    @pytest.mark.asyncio
    async def test_apply_adds_contacts_and_protects_them_in_residency(self, test_db, client):
        await _seed_channels()
        await _insert_contact(CONTACT_A, "Alice")
        await _insert_contact(CONTACT_B, "Bob")
        set_id = (
            await client.post(
                "/api/channel-sets",
                json={
                    "name": "Kit",
                    "channel_keys": [KEY_A],
                    "contact_keys": [CONTACT_A, CONTACT_B],
                },
            )
        ).json()["id"]
        mc, _state = _fake_radio({}, limit=4)
        contact_mc, added = _fake_contact_radio(full_after=1)
        mc.commands.get_contacts = contact_mc.commands.get_contacts
        mc.commands.add_contact = contact_mc.commands.add_contact
        mc.get_contact_by_key_prefix = contact_mc.get_contact_by_key_prefix

        with (
            patch("app.routers.channel_sets.radio_manager", _mock_runtime(mc)),
            patch("app.routers.channel_sets.get_radio_channel_limit", return_value=4),
        ):
            response = await client.post(f"/api/channel-sets/{set_id}/apply")

        assert response.status_code == 200
        body = response.json()
        assert [(i["public_key"], i["status"], i["error"]) for i in body["contact_items"]] == [
            (CONTACT_A, "loaded", None),
            (CONTACT_B, "failed", "table_full"),
        ]
        # Totals cover channels and contacts.
        assert (body["loaded"], body["already_loaded"], body["failed"]) == (2, 0, 1)
        assert added == [CONTACT_A]
        # Only the contact that reached the radio is protected.
        assert get_loadout_protected_keys() == [CONTACT_A]

        with patch(
            "app.radio_sync.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=MagicMock(max_radio_contacts=200, tracked_telemetry_repeaters=[]),
        ):
            residency = await client.get("/api/contacts/radio-residency")
        by_key = {e["public_key"]: e["reason"] for e in residency.json()}
        assert by_key.get(CONTACT_A) == "loadout"


class TestLoadoutProtection:
    @pytest.mark.asyncio
    async def test_protected_contacts_sit_between_pinned_and_favorites(self, test_db):
        await _insert_contact(CONTACT_A, "Pinned")
        await ContactRepository.set_radio_policy(CONTACT_A, "pinned")
        await _insert_contact(CONTACT_B, "Fav")
        await ContactRepository.set_favorite(CONTACT_B, True)
        await _insert_contact(CONTACT_C, "Loadout")
        protect_loadout_contacts([CONTACT_C.upper(), CONTACT_A])

        with patch(
            "app.radio_sync.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=MagicMock(max_radio_contacts=200, tracked_telemetry_repeaters=[]),
        ):
            residency = await get_radio_residency()

        assert [(c.public_key, reason) for c, reason in residency[:3]] == [
            (CONTACT_A, "pinned"),
            (CONTACT_C, "loadout"),
            (CONTACT_B, "favorite"),
        ]

    @pytest.mark.asyncio
    async def test_excluded_contact_is_not_protected(self, test_db):
        await _insert_contact(CONTACT_A, "Excluded")
        await ContactRepository.set_radio_policy(CONTACT_A, "excluded")
        protect_loadout_contacts([CONTACT_A])

        with patch(
            "app.radio_sync.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=MagicMock(max_radio_contacts=200, tracked_telemetry_repeaters=[]),
        ):
            residency = await get_radio_residency()

        assert all(c.public_key != CONTACT_A for c, _ in residency)

    def test_protection_accumulates_and_clears(self):
        protect_loadout_contacts([CONTACT_A])
        protect_loadout_contacts([CONTACT_B, CONTACT_A])
        assert get_loadout_protected_keys() == [CONTACT_A, CONTACT_B]
        clear_loadout_protection()
        assert get_loadout_protected_keys() == []
