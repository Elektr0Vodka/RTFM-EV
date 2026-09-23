"""Per-contact telemetry permissions: flag-bit layout and radio snapshot re-apply.

Firmware layout (companion_radio MyMesh.cpp, SensorManager.h): contact.flags
bit 0 is the radio favourite bit; the TELEM_PERM_* bits (0x01 base, 0x02
location, 0x04 environment) sit in flags shifted left by one.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType

from app.models import Contact, ContactUpsert
from app.radio_sync import sync_contacts_from_radio
from app.repository import ContactRepository

KEY_A = "aa" * 32
KEY_B = "bb" * 32


def _result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload if payload is not None else {}
    return result


def _radio_contact(public_key: str, flags: int) -> dict:
    return {
        "public_key": public_key,
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


def _mc_with_snapshot(*radio_contacts: dict) -> MagicMock:
    mc = MagicMock()
    mc.commands.get_contacts = AsyncMock(
        return_value=_result(EventType.CONTACTS, {c["public_key"]: c for c in radio_contacts})
    )
    mc.commands.change_contact_flags = AsyncMock(return_value=_result())
    return mc


class TestToRadioDictTelemetryPerms:
    def test_app_perms_overlay_radio_flags(self):
        contact = Contact(public_key=KEY_A, flags=0x01, telemetry_perms=0x05)

        assert contact.to_radio_dict()["flags"] == 0x01 | 0x0A

    def test_app_perms_clear_radio_bits(self):
        contact = Contact(public_key=KEY_A, flags=0x0F, telemetry_perms=0)

        assert contact.to_radio_dict()["flags"] == 0x01

    def test_unset_perms_leave_flags_alone(self):
        contact = Contact(public_key=KEY_A, flags=0x0B)

        assert contact.to_radio_dict()["flags"] == 0x0B


class TestSnapshotReappliesAppPerms:
    @pytest.mark.asyncio
    async def test_radio_copy_differs_pushes_app_perms(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key=KEY_A, flags=0))
        await ContactRepository.set_telemetry_perms(KEY_A, 0x03)
        # Radio auto-added the contact with no permission bits (favourite set).
        mc = _mc_with_snapshot(_radio_contact(KEY_A, 0x01))

        await sync_contacts_from_radio(mc)

        mc.commands.change_contact_flags.assert_awaited_once()
        radio_contact, flags = mc.commands.change_contact_flags.await_args.args
        assert radio_contact["public_key"] == KEY_A
        assert flags == 0x01 | 0x06
        stored = await ContactRepository.get_by_key(KEY_A)
        assert stored is not None
        assert stored.flags == 0x07
        assert stored.telemetry_perms == 0x03

    @pytest.mark.asyncio
    async def test_matching_radio_copy_is_left_alone(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key=KEY_A, flags=0))
        await ContactRepository.set_telemetry_perms(KEY_A, 0x03)
        mc = _mc_with_snapshot(_radio_contact(KEY_A, 0x07))

        await sync_contacts_from_radio(mc)

        mc.commands.change_contact_flags.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_contacts_without_app_perms_keep_radio_flags(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key=KEY_B, flags=0))
        mc = _mc_with_snapshot(_radio_contact(KEY_B, 0x0E))

        await sync_contacts_from_radio(mc)

        mc.commands.change_contact_flags.assert_not_awaited()
        stored = await ContactRepository.get_by_key(KEY_B)
        assert stored is not None
        assert stored.flags == 0x0E
        assert stored.telemetry_perms is None

    @pytest.mark.asyncio
    async def test_radio_rejects_push_keeps_app_perms(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key=KEY_A, flags=0))
        await ContactRepository.set_telemetry_perms(KEY_A, 0x01)
        mc = _mc_with_snapshot(_radio_contact(KEY_A, 0))
        mc.commands.change_contact_flags = AsyncMock(return_value=_result(EventType.ERROR))

        result = await sync_contacts_from_radio(mc)

        assert "error" not in result
        stored = await ContactRepository.get_by_key(KEY_A)
        assert stored is not None
        assert stored.telemetry_perms == 0x01
