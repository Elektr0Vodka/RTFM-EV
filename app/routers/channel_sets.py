"""Channel sets (plan 08 slice 1): named sets of channels, loaded onto the radio in one action.

A set stores channel keys + names in ``app_settings.channel_sets`` (migration
``_122``). ``POST /channel-sets/{id}/apply`` writes the set's channels into
free radio slots (additive, see ``app/services/channel_set_apply.py``). It is a
point-in-time load: a reconnect or a full periodic sync offloads channel slots
again, as it does for every channel. Nothing here transmits.
"""

import logging
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.models import (
    ChannelSet,
    ChannelSetApplyResult,
    ChannelSetEntry,
)
from app.radio_sync import get_radio_channel_limit
from app.repository import AppSettingsRepository, ChannelRepository
from app.services.channel_set_apply import apply_channel_set
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/channel-sets", tags=["channel-sets"])


def _clean_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("name must not be blank")
    return name


def _clean_keys(value: list[str]) -> list[str]:
    keys: list[str] = []
    for raw in value:
        key = raw.strip().upper()
        if key not in keys:
            keys.append(key)
    if not keys:
        raise ValueError("a channel set needs at least one channel")
    return keys


class ChannelSetCreate(BaseModel):
    name: str = Field(max_length=64)
    channel_keys: list[str] = Field(description="Channel keys, in load order")

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("channel_keys")
    @classmethod
    def _keys(cls, value: list[str]) -> list[str]:
        return _clean_keys(value)


class ChannelSetUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    channel_keys: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @field_validator("channel_keys")
    @classmethod
    def _keys(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _clean_keys(value)


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
    now = int(time.time())
    channel_set = ChannelSet(
        id=uuid.uuid4().hex,
        name=body.name,
        channels=entries,
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
    """Load the set's channels into free radio slots (additive, per-channel results).

    Uses each channel's current name from the database; a channel deleted since
    the set was saved still loads under its saved name. Local radio commands
    only; nothing is transmitted.
    """
    channel_set = _find(await AppSettingsRepository.get_channel_sets(), set_id)
    entries: list[ChannelSetEntry] = []
    for entry in channel_set.channels:
        channel = await ChannelRepository.get_by_key(entry.key)
        entries.append(ChannelSetEntry(key=entry.key, name=channel.name if channel else entry.name))

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

    logger.info(
        "Channel set %r applied: %d loaded, %d already on radio, %d failed",
        channel_set.name,
        sum(1 for i in items if i.status == "loaded"),
        sum(1 for i in items if i.status == "already_loaded"),
        sum(1 for i in items if i.status == "failed"),
    )
    return ChannelSetApplyResult(
        set_id=set_id,
        items=items,
        loaded=sum(1 for i in items if i.status == "loaded"),
        already_loaded=sum(1 for i in items if i.status == "already_loaded"),
        failed=sum(1 for i in items if i.status == "failed"),
    )
