"""Remote CLI permission (contact flags bit 0x10, companion firmware 1.18)."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType

from app.models import Contact, ContactUpsert, apply_remote_cli, apply_telemetry_perms
from app.radio_sync import sync_contacts_from_radio
from app.repository import ContactRepository

KEY = "dd" * 32


def _result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload if payload is not None else {}
    return result


def _radio_contact(flags: int) -> dict:
    return {
        "public_key": KEY,
        "type": 1,
        "flags": flags,
        "out_path": "",
        "out_path_len": -1,
        "out_path_hash_mode": -1,
        "adv_name": "Node",
        "last_advert": 0,
        "adv_lat": 0.0,
        "adv_lon": 0.0,
    }


def _mc_with_snapshot(flags: int) -> MagicMock:
    mc = MagicMock()
    mc.commands.get_contacts = AsyncMock(
        return_value=_result(EventType.CONTACTS, {KEY: _radio_contact(flags)})
    )
    mc.commands.change_contact_flags = AsyncMock(return_value=_result())
    return mc


def test_apply_remote_cli_sets_and_clears_only_bit_4():
    assert apply_remote_cli(0x0B, True) == 0x1B
    assert apply_remote_cli(0x1B, False) == 0x0B


def test_telemetry_perms_leave_remote_cli_bit_alone():
    assert apply_telemetry_perms(0x11, 0) == 0x11


def test_to_radio_dict_overlays_remote_cli():
    assert Contact(public_key=KEY, flags=0x01, remote_cli=True).to_radio_dict()["flags"] == 0x11
    assert Contact(public_key=KEY, flags=0x11, remote_cli=False).to_radio_dict()["flags"] == 0x01
    assert Contact(public_key=KEY, flags=0x11).to_radio_dict()["flags"] == 0x11


@pytest.mark.asyncio
async def test_set_remote_cli_stores_and_mirrors_flag(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, flags=0x03))
    await ContactRepository.set_remote_cli(KEY, True)
    contact = await ContactRepository.get_by_key(KEY)
    assert contact is not None
    assert contact.remote_cli is True
    assert contact.flags == 0x13

    await ContactRepository.set_remote_cli(KEY, False)
    contact = await ContactRepository.get_by_key(KEY)
    assert contact is not None
    assert contact.remote_cli is False
    assert contact.flags == 0x03


@pytest.mark.asyncio
async def test_sync_reapplies_remote_cli(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, flags=0))
    await ContactRepository.set_remote_cli(KEY, True)
    mc = _mc_with_snapshot(0x01)

    await sync_contacts_from_radio(mc)

    _, flags = mc.commands.change_contact_flags.await_args.args
    assert flags == 0x11


@pytest.mark.asyncio
async def test_sync_never_clears_unset_remote_cli(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, flags=0))
    await ContactRepository.set_telemetry_perms(KEY, 0x01)
    # Radio already has 0x10 (set in the official app) and the telemetry bit.
    mc = _mc_with_snapshot(0x13)

    await sync_contacts_from_radio(mc)

    mc.commands.change_contact_flags.assert_not_awaited()


@pytest.mark.asyncio
async def test_endpoint_stores_when_radio_offline(test_db):
    from unittest.mock import patch

    from app.models import ContactRemoteCliRequest
    from app.routers.contacts import set_contact_remote_cli

    await ContactRepository.upsert(ContactUpsert(public_key=KEY, flags=0x01))
    with (
        patch("app.routers.contacts.radio_manager") as rm,
        patch("app.routers.contacts._broadcast_contact_update", AsyncMock()),
    ):
        rm.is_connected = False
        result = await set_contact_remote_cli(KEY, ContactRemoteCliRequest(enabled=True))

    assert result["remote_cli"] is True
    assert result["applied_to_radio"] is False
    stored = await ContactRepository.get_by_key(KEY)
    assert stored is not None
    assert stored.remote_cli is True
    assert stored.flags == 0x11


@pytest.mark.asyncio
async def test_endpoint_pushes_to_radio_keeping_other_bits(test_db):
    from contextlib import asynccontextmanager
    from unittest.mock import patch

    from app.models import ContactRemoteCliRequest
    from app.routers.contacts import set_contact_remote_cli

    await ContactRepository.upsert(ContactUpsert(public_key=KEY, flags=0x13))
    mc = MagicMock()
    mc.get_contact_by_key_prefix = MagicMock(return_value=_radio_contact(0x13))
    mc.commands.change_contact_flags = AsyncMock(return_value=_result())

    @asynccontextmanager
    async def _op(*_a, **_k):
        yield mc

    with (
        patch("app.routers.contacts.radio_manager") as rm,
        patch("app.routers.contacts._broadcast_contact_update", AsyncMock()),
    ):
        rm.is_connected = True
        rm.radio_operation = _op
        result = await set_contact_remote_cli(KEY, ContactRemoteCliRequest(enabled=False))

    _, flags = mc.commands.change_contact_flags.await_args.args
    assert flags == 0x03
    assert result["applied_to_radio"] is True
