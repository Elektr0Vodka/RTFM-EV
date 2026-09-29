"""Load a channel set ("loadout") onto the radio: channel slots + contacts (plan 08).

Additive: channels already on the radio are left alone, other channels are
never evicted, and each channel of the set goes into a free slot. The radio is
read first (``get_channel`` per slot), so the result reflects what the radio
actually holds, not the app's send-slot cache.

When the transport does not reuse slots (TCP, or
``MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE``), every channel send writes its
channel into slot 0 first (``TEMP_RADIO_SLOT``). Slot 0 is then neither used
nor counted here, so the next send cannot overwrite a channel this loaded.

Contacts (slice 2) are added the same way: additive, nothing on the radio is
removed, and a full contact table fails the remaining contacts as
``table_full``. Contacts with ``radio_policy == 'excluded'`` are skipped.

Local radio commands only; nothing is transmitted. The caller holds the radio
operation lock.
"""

import logging
from typing import Literal

from meshcore import EventType

from app.models import (
    ChannelSetApplyItem,
    ChannelSetContact,
    ChannelSetContactApplyItem,
    ChannelSetEntry,
    Contact,
)

logger = logging.getLogger(__name__)

SEND_SLOT = 0
# Firmware ERR_CODE_TABLE_FULL on CMD_ADD_UPDATE_CONTACT.
TABLE_FULL_ERROR_CODE = 3
GET_CONTACTS_TIMEOUT = 10

ContactStatus = Literal["loaded", "already_loaded", "failed"]
ContactError = Literal["table_full", "unknown_contact", "excluded", "radio_error"]


def _slot_key(payload: dict) -> str | None:
    """Return the upper-case key of a populated slot, or None when the slot is empty."""
    name = payload.get("channel_name") or ""
    if not name or name == "\x00" * len(name):
        return None
    secret = payload.get("channel_secret", b"")
    key = (secret if isinstance(secret, bytes) else bytes(secret)).hex().upper()
    if not key or key == "0" * len(key):
        return None
    return key


async def apply_channel_set(
    mc,
    entries: list[ChannelSetEntry],
    *,
    channel_limit: int,
    reuse_enabled: bool,
) -> list[ChannelSetApplyItem]:
    """Load ``entries`` into free radio slots; one result item per entry, in order."""
    first_slot = 0 if reuse_enabled else SEND_SLOT + 1
    slot_by_key: dict[str, int] = {}
    free_slots: list[int] = []
    for idx in range(first_slot, channel_limit):
        result = await mc.commands.get_channel(idx)
        if result is None or result.type != EventType.CHANNEL_INFO:
            # Unknown contents: neither free nor a match.
            continue
        key = _slot_key(result.payload or {})
        if key is None:
            free_slots.append(idx)
        else:
            slot_by_key.setdefault(key, idx)

    items: list[ChannelSetApplyItem] = []
    for entry in entries:
        key = entry.key.upper()
        existing = slot_by_key.get(key)
        if existing is not None:
            items.append(
                ChannelSetApplyItem(
                    key=key, name=entry.name, status="already_loaded", slot=existing
                )
            )
            continue
        if not free_slots:
            items.append(
                ChannelSetApplyItem(key=key, name=entry.name, status="failed", error="no_free_slot")
            )
            continue

        slot = free_slots[0]
        try:
            result = await mc.commands.set_channel(
                channel_idx=slot,
                channel_name=entry.name,
                channel_secret=bytes.fromhex(key),
            )
            ok = result is not None and result.type != EventType.ERROR
            if not ok:
                logger.warning(
                    "Channel set: radio refused channel %s in slot %d: %s",
                    entry.name,
                    slot,
                    result.payload if result is not None else "no response",
                )
        except Exception as exc:
            logger.warning("Channel set: failed to load %s into slot %d: %s", entry.name, slot, exc)
            ok = False

        if not ok:
            items.append(
                ChannelSetApplyItem(key=key, name=entry.name, status="failed", error="radio_error")
            )
            continue

        free_slots.pop(0)
        slot_by_key[key] = slot
        items.append(ChannelSetApplyItem(key=key, name=entry.name, status="loaded", slot=slot))

    return items


async def _radio_contact_keys(mc) -> set[str] | None:
    """Return the lower-case keys on the radio, or None when the radio cannot be read."""
    try:
        result = await mc.commands.get_contacts(timeout=GET_CONTACTS_TIMEOUT)
    except Exception as exc:
        logger.warning("Channel set: could not read radio contacts: %s", exc)
        return None
    if result is None or result.type == EventType.ERROR:
        logger.warning("Channel set: could not read radio contacts: %s", result)
        return None
    return {key.lower() for key in (result.payload or {})}


async def _add_one(
    mc, key: str, contact: Contact | None, on_radio: set[str] | None, table_full: bool
) -> tuple[ContactStatus, ContactError | None]:
    """Return ``(status, error)`` for one contact, adding it to the radio when needed."""
    if contact is None or len(contact.public_key) < 64:
        return "failed", "unknown_contact"
    if contact.radio_policy == "excluded":
        return "failed", "excluded"
    if on_radio is not None:
        already = key in on_radio
    else:
        already = bool(mc.get_contact_by_key_prefix(key[:12]))
    if already:
        return "already_loaded", None
    if table_full:
        return "failed", "table_full"

    try:
        result = await mc.commands.add_contact(contact.to_radio_dict())
    except Exception as exc:
        logger.warning("Channel set: failed to add contact %s: %s", key[:12], exc)
        return "failed", "radio_error"
    if result is not None and result.type == EventType.OK:
        return "loaded", None
    reason = result.payload if result is not None else None
    if isinstance(reason, dict) and reason.get("error_code") == TABLE_FULL_ERROR_CODE:
        logger.warning("Channel set: radio contact table full at %s", key[:12])
        return "failed", "table_full"
    logger.warning("Channel set: radio refused contact %s: %s", key[:12], reason)
    return "failed", "radio_error"


async def apply_contacts(
    mc,
    entries: list[tuple[ChannelSetContact, Contact | None]],
) -> list[ChannelSetContactApplyItem]:
    """Add each contact to the radio unless it is there already; one item per entry, in order.

    ``entries`` pairs each saved contact with its current DB row (None when the
    contact is no longer known). When the radio's contact list cannot be read,
    the library's cached copy decides what counts as already loaded.
    """
    on_radio = await _radio_contact_keys(mc)
    table_full = False
    items: list[ChannelSetContactApplyItem] = []

    for entry, contact in entries:
        key = entry.public_key.lower()
        status, error = await _add_one(mc, key, contact, on_radio, table_full)
        if error == "table_full":
            table_full = True
        elif status == "loaded" and on_radio is not None:
            on_radio.add(key)
        items.append(
            ChannelSetContactApplyItem(
                public_key=key,
                name=(contact.name if contact else None) or entry.name,
                status=status,
                error=error,
            )
        )

    return items
