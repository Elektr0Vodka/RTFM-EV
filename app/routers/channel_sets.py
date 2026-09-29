"""Channel sets ("loadouts" in the UI, plan 08): named sets of channels and
contacts, loaded onto the radio in one action.

A set stores channel keys + names and contact keys + names in
``app_settings.channel_sets`` (migration ``_122``; contacts added in slice 2,
no migration). ``POST /channel-sets/{id}/apply`` writes the set's channels into
free radio slots and adds its contacts (additive, see
``app/services/channel_set_apply.py``). Channels are a point-in-time load: a
reconnect or a full periodic sync offloads channel slots again. Contacts that
end up on the radio stay in the first residency tier until the next connect
(``radio_sync.protect_loadout_contacts``), so a full sync does not remove them.
Nothing here transmits.
"""

import logging
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import (
    ChannelSet,
    ChannelSetApplyResult,
    ChannelSetContact,
    ChannelSetEntry,
)
from app.radio_sync import get_radio_channel_limit, protect_loadout_contacts
from app.repository import AppSettingsRepository, ChannelRepository, ContactRepository
from app.services.channel_set_apply import apply_channel_set, apply_contacts
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/channel-sets", tags=["channel-sets"])


def _clean_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("name must not be blank")
    return name


EMPTY_SET_ERROR = "a channel set needs at least one channel or contact"


def _dedupe(value: list[str], *, upper: bool) -> list[str]:
    keys: list[str] = []
    for raw in value:
        key = raw.strip().upper() if upper else raw.strip().lower()
        if key and key not in keys:
            keys.append(key)
    return keys


class ChannelSetCreate(BaseModel):
    name: str = Field(max_length=64)
    channel_keys: list[str] = Field(default_factory=list, description="Channel keys, in load order")
    contact_keys: list[str] = Field(
        default_factory=list, description="Full contact public keys, in load order"
    )

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("channel_keys")
    @classmethod
    def _channel_keys(cls, value: list[str]) -> list[str]:
        return _dedupe(value, upper=True)

    @field_validator("contact_keys")
    @classmethod
    def _contact_keys(cls, value: list[str]) -> list[str]:
        return _dedupe(value, upper=False)

    @model_validator(mode="after")
    def _not_empty(self) -> "ChannelSetCreate":
        if not self.channel_keys and not self.contact_keys:
            raise ValueError(EMPTY_SET_ERROR)
        return self


class ChannelSetUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    channel_keys: list[str] | None = None
    contact_keys: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @field_validator("channel_keys")
    @classmethod
    def _channel_keys(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _dedupe(value, upper=True)

    @field_validator("contact_keys")
    @classmethod
    def _contact_keys(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _dedupe(value, upper=False)


async def _entries_for_keys(keys: list[str]) -> list[ChannelSetEntry]:
    entries: list[ChannelSetEntry] = []
    unknown: list[str] = []
    for key in keys:
        channel = await ChannelRepository.get_by_key(key)
        if channel is None:
            unknown.append(key[:8])
        else:
            entries.append(ChannelSetEntry(key=channel.key.upper(), name=channel.name))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown channel(s): {', '.join(unknown)}")
    return entries


async def _contacts_for_keys(keys: list[str]) -> list[ChannelSetContact]:
    contacts: list[ChannelSetContact] = []
    unknown: list[str] = []
    for key in keys:
        contact = await ContactRepository.get_by_key(key) if len(key) == 64 else None
        if contact is None:
            unknown.append(key[:12])
        else:
            contacts.append(ChannelSetContact(public_key=contact.public_key, name=contact.name))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown contact(s): {', '.join(unknown)}")
    return contacts


def _find(sets: list[ChannelSet], set_id: str) -> ChannelSet:
    for channel_set in sets:
        if channel_set.id == set_id:
            return channel_set
    raise HTTPException(status_code=404, detail="Channel set not found")


@router.get("", response_model=list[ChannelSet])
async def list_channel_sets() -> list[ChannelSet]:
    return await AppSettingsRepository.get_channel_sets()


@router.post("", response_model=ChannelSet)
async def create_channel_set(body: ChannelSetCreate) -> ChannelSet:
    entries = await _entries_for_keys(body.channel_keys)
    contacts = await _contacts_for_keys(body.contact_keys)
    now = int(time.time())
    channel_set = ChannelSet(
        id=uuid.uuid4().hex,
        name=body.name,
        channels=entries,
        contacts=contacts,
        created_at=now,
        updated_at=now,
    )
    sets = await AppSettingsRepository.get_channel_sets()
    await AppSettingsRepository.set_channel_sets([*sets, channel_set])
    return channel_set


@router.patch("/{set_id}", response_model=ChannelSet)
async def update_channel_set(set_id: str, body: ChannelSetUpdate) -> ChannelSet:
    sets = await AppSettingsRepository.get_channel_sets()
    channel_set = _find(sets, set_id)
    if body.name is not None:
        channel_set.name = body.name
    if body.channel_keys is not None:
        channel_set.channels = await _entries_for_keys(body.channel_keys)
    if body.contact_keys is not None:
        channel_set.contacts = await _contacts_for_keys(body.contact_keys)
    if not channel_set.channels and not channel_set.contacts:
        raise HTTPException(status_code=400, detail=EMPTY_SET_ERROR)
    channel_set.updated_at = int(time.time())
    await AppSettingsRepository.set_channel_sets(sets)
    return channel_set


@router.delete("/{set_id}")
async def delete_channel_set(set_id: str) -> dict:
    sets = await AppSettingsRepository.get_channel_sets()
    _find(sets, set_id)
    await AppSettingsRepository.set_channel_sets([s for s in sets if s.id != set_id])
    return {"deleted": set_id}


@router.post("/{set_id}/apply", response_model=ChannelSetApplyResult)
async def apply_channel_set_to_radio(set_id: str) -> ChannelSetApplyResult:
    """Load the set's channels into free radio slots and add its contacts.

    Additive, with one result per channel and per contact. Uses each channel's
    current name from the database; a channel deleted since the set was saved
    still loads under its saved name. A contact no longer in the database fails
    as ``unknown_contact`` (the radio needs the stored contact record). Contacts
    that end up on the radio are protected until the next connect. Local radio
    commands only; nothing is transmitted.
    """
    channel_set = _find(await AppSettingsRepository.get_channel_sets(), set_id)
    entries: list[ChannelSetEntry] = []
    for entry in channel_set.channels:
        channel = await ChannelRepository.get_by_key(entry.key)
        entries.append(ChannelSetEntry(key=entry.key, name=channel.name if channel else entry.name))
    contact_entries = [
        (entry, await ContactRepository.get_by_key(entry.public_key))
        for entry in channel_set.contacts
    ]

    radio_manager.require_connected()
    async with radio_manager.radio_operation("channel_set_apply") as mc:
        reuse_enabled = radio_manager.channel_slot_reuse_enabled()
        items = await apply_channel_set(
            mc,
            entries,
            channel_limit=get_radio_channel_limit(),
            reuse_enabled=reuse_enabled,
        )
        for item in items:
            if item.slot is not None:
                radio_manager.note_channel_slot_loaded(item.key, item.slot)
        contact_items = await apply_contacts(mc, contact_entries) if contact_entries else []

    protect_loadout_contacts(
        [i.public_key for i in contact_items if i.status in ("loaded", "already_loaded")]
    )
    statuses = [i.status for i in items] + [i.status for i in contact_items]
    result = ChannelSetApplyResult(
        set_id=set_id,
        items=items,
        contact_items=contact_items,
        loaded=statuses.count("loaded"),
        already_loaded=statuses.count("already_loaded"),
        failed=statuses.count("failed"),
    )
    logger.info(
        "Channel set %r applied (%d channels, %d contacts): %d loaded, "
        "%d already on radio, %d failed",
        channel_set.name,
        len(items),
        len(contact_items),
        result.loaded,
        result.already_loaded,
        result.failed,
    )
    return result
