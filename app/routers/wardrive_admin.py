"""Wardrive owner admin (``MESHCORE_WARDRIVE``): users, radios, groups,
visibility and all stored data.

Stays behind the main app's Basic login (never under the exempt
``/api/wardrive/`` prefix). Registered only when the module is active.
"""

import sqlite3
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.repository.wardrive import (
    WardriveConfigRepository,
    WardriveDataRepository,
    WardriveGroupRepository,
    WardriveRadioRepository,
    WardriveSessionRepository,
    WardriveUserRepository,
)
from app.wardrive.config import (
    HASHTAG_CHANNELS,
    MAX_HASHTAG_CHANNELS,
    default_hashtag_channels,
    normalize_hashtag,
    owner_hashtag_channels,
    sort_names,
)
from app.wardrive.crypto import normalize_key
from app.wardrive.models import MAX_TS
from app.wardrive.module import PAGE_PREFIX, wardrive_active, wardrive_unprotected

router = APIRouter(prefix="/wardrive-admin", tags=["wardrive"])

DEFAULT_WINDOW_S = 86400


class UserUpdate(BaseModel):
    visibility: Literal["own", "groups", "all"] | None = None
    disabled: bool | None = None


class GroupBody(BaseModel):
    name: str = Field(max_length=64)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A group needs a name")
        return v


class GroupMembers(BaseModel):
    user_ids: list[int]


class ConfigBody(BaseModel):
    hashtag_channels: list[str] | None = Field(
        description="Hashtag channel names drivers may decode; null uses the home radio's"
    )

    @field_validator("hashtag_channels")
    @classmethod
    def _channels(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if len(v) > MAX_HASHTAG_CHANNELS:
            raise ValueError(f"At most {MAX_HASHTAG_CHANNELS} channels")
        names: list[str] = []
        for raw in v:
            name = normalize_hashtag(raw)
            if name is None:
                raise ValueError(f"Not a usable channel name: {raw!r}")
            names.append(name)
        return sort_names(names)


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != "password_hash"}


def _key_or_404(public_key: str) -> str:
    try:
        return normalize_key(public_key)
    except ValueError:
        raise HTTPException(status_code=404, detail="No such radio") from None


async def _group_or_404(group_id: int) -> dict[str, Any]:
    group = next((g for g in await WardriveGroupRepository.list_all() if g["id"] == group_id), None)
    if group is None:
        raise HTTPException(status_code=404, detail="No such group")
    return group


@router.get("/status")
async def wardrive_admin_status() -> dict[str, Any]:
    return {
        "active": wardrive_active(settings),
        "unprotected": wardrive_unprotected(settings),
        "page_path": PAGE_PREFIX + "/",
    }


@router.get("/users")
async def wardrive_admin_users() -> list[dict[str, Any]]:
    return [_public_user(u) for u in await WardriveUserRepository.list_all()]


@router.patch("/users/{user_id}")
async def wardrive_admin_update_user(user_id: int, body: UserUpdate) -> dict[str, Any]:
    if not await WardriveUserRepository.update(
        user_id, visibility=body.visibility, disabled=body.disabled
    ):
        raise HTTPException(status_code=404, detail="No such user")
    if body.disabled:
        await WardriveSessionRepository.delete_for_user(user_id)
    user = await WardriveUserRepository.get(user_id)
    assert user is not None
    return _public_user(user)


@router.delete("/users/{user_id}")
async def wardrive_admin_delete_user(user_id: int) -> dict[str, str]:
    if not await WardriveUserRepository.delete(user_id):
        raise HTTPException(status_code=404, detail="No such user")
    return {"status": "deleted"}


@router.delete("/radios/{public_key}")
async def wardrive_admin_delete_radio(public_key: str) -> dict[str, str]:
    if not await WardriveRadioRepository.delete(_key_or_404(public_key)):
        raise HTTPException(status_code=404, detail="No such radio")
    return {"status": "deleted"}


@router.get("/groups")
async def wardrive_admin_groups() -> list[dict[str, Any]]:
    return await WardriveGroupRepository.list_all()


@router.post("/groups")
async def wardrive_admin_create_group(body: GroupBody) -> dict[str, Any]:
    try:
        group_id = await WardriveGroupRepository.create(body.name, now=int(time.time()))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A group with this name exists") from None
    return await _group_or_404(group_id)


@router.patch("/groups/{group_id}")
async def wardrive_admin_rename_group(group_id: int, body: GroupBody) -> dict[str, Any]:
    try:
        renamed = await WardriveGroupRepository.rename(group_id, body.name)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A group with this name exists") from None
    if not renamed:
        raise HTTPException(status_code=404, detail="No such group")
    return await _group_or_404(group_id)


@router.delete("/groups/{group_id}")
async def wardrive_admin_delete_group(group_id: int) -> dict[str, str]:
    if not await WardriveGroupRepository.delete(group_id):
        raise HTTPException(status_code=404, detail="No such group")
    return {"status": "deleted"}


@router.put("/groups/{group_id}/members")
async def wardrive_admin_set_members(group_id: int, body: GroupMembers) -> dict[str, Any]:
    await _group_or_404(group_id)
    known = {u["id"] for u in await WardriveUserRepository.list_all()}
    unknown = sorted(set(body.user_ids) - known)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown user ids: {unknown}")
    await WardriveGroupRepository.set_members(group_id, sorted(set(body.user_ids)))
    return await _group_or_404(group_id)


@router.get("/data")
async def wardrive_admin_data(
    since: int | None = Query(
        default=None, ge=0, le=MAX_TS, description="Unix seconds, default 24 h ago"
    ),
    until: int | None = Query(
        default=None, ge=0, le=MAX_TS, description="Unix seconds, default now"
    ),
    user_id: int | None = None,
    group_id: int | None = None,
    radio_key: str | None = None,
) -> dict[str, Any]:
    """All stored wardrive data, optionally narrowed to a user, group or radio."""
    end = until if until is not None else int(time.time())
    start = since if since is not None else end - DEFAULT_WINDOW_S
    user_ids: set[int] | None = None
    if group_id is not None:
        user_ids = set((await _group_or_404(group_id))["member_ids"])
    if user_id is not None:
        user_ids = {user_id} if user_ids is None else user_ids & {user_id}
    key = _key_or_404(radio_key) if radio_key else None
    return await WardriveDataRepository.query(user_ids, start, end, key)


async def _config() -> dict[str, Any]:
    return {
        "hashtag_channels": await owner_hashtag_channels(),
        "default_hashtag_channels": await default_hashtag_channels(),
    }


@router.get("/config")
async def wardrive_admin_config() -> dict[str, Any]:
    """The channel list served to drivers: the owner's list (null when unset)
    and the home radio's hashtag channels used when it is unset."""
    return await _config()


@router.put("/config")
async def wardrive_admin_set_config(body: ConfigBody) -> dict[str, Any]:
    if body.hashtag_channels is None:
        await WardriveConfigRepository.delete(HASHTAG_CHANNELS)
    else:
        await WardriveConfigRepository.set_json(
            HASHTAG_CHANNELS, body.hashtag_channels, int(time.time())
        )
    return await _config()
