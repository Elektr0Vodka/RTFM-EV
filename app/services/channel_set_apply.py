"""Load a channel set onto the radio's channel slots (plan 08 slice 1).

Additive: channels already on the radio are left alone, other channels are
never evicted, and each channel of the set goes into a free slot. The radio is
read first (``get_channel`` per slot), so the result reflects what the radio
actually holds, not the app's send-slot cache.

When the transport does not reuse slots (TCP, or
``MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE``), every channel send writes its
channel into slot 0 first (``TEMP_RADIO_SLOT``). Slot 0 is then neither used
nor counted here, so the next send cannot overwrite a channel this loaded.

Local radio commands only; nothing is transmitted. The caller holds the radio
operation lock.
"""

import logging

from meshcore import EventType

from app.models import ChannelSetApplyItem, ChannelSetEntry

logger = logging.getLogger(__name__)

SEND_SLOT = 0


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
