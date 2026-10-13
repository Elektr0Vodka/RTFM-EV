"""Bot lists: lists of known bots that users keep, share as files and enable.

An enabled list marks its senders in chat; Hide bots (an app setting) hides
them. Nothing here transmits.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.bot_lists.format import (
    MAX_DESCRIPTION_LENGTH,
    MAX_ENTRIES,
    MAX_NAME_LENGTH,
    BotEntry,
    BotListFormatError,
    parse_bot_list,
)
from app.services.bot_lists import (
    MAX_EFFECTIVE,
    BotListError,
    BotListNotFound,
    BotListReadOnly,
    bot_lists,
)

router = APIRouter(prefix="/bot-lists", tags=["bot-lists"])


class BotListCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)


class BotListUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    enabled: bool | None = Field(default=None, description="Mark this list's senders in chat")


class BotListEntriesRequest(BaseModel):
    entries: list[BotEntry] = Field(max_length=MAX_ENTRIES)


class BotExceptionsRequest(BaseModel):
    names: list[str] = Field(max_length=MAX_EFFECTIVE, description="Names never treated as a bot")


def _refusal(exc: BotListError) -> HTTPException:
    if isinstance(exc, BotListNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, BotListReadOnly):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("")
async def get_bot_lists() -> dict[str, Any]:
    """Lists, exceptions and the effective set of names and keys."""
    return await bot_lists.snapshot()


@router.post("")
async def create_bot_list(body: BotListCreateRequest) -> dict[str, Any]:
    return await bot_lists.create_local(body.name, body.description)


@router.put("/exceptions")
async def set_bot_exceptions(body: BotExceptionsRequest) -> dict[str, Any]:
    return await bot_lists.set_exceptions(body.names)


@router.post("/import")
async def import_bot_list(request: Request) -> dict[str, Any]:
    """Store an uploaded bot list file as a new local list (switched off)."""
    try:
        parsed = parse_bot_list(await request.body())
    except BotListFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await bot_lists.import_file(parsed)


@router.patch("/{list_id}")
async def update_bot_list(list_id: int, body: BotListUpdateRequest) -> dict[str, Any]:
    try:
        return await bot_lists.update(
            list_id, name=body.name, description=body.description, enabled=body.enabled
        )
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.delete("/{list_id}")
async def delete_bot_list(list_id: int) -> dict[str, Any]:
    try:
        return await bot_lists.delete(list_id)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.get("/{list_id}/entries")
async def get_bot_list_entries(list_id: int) -> list[dict[str, Any]]:
    try:
        return await bot_lists.entries(list_id)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.put("/{list_id}/entries")
async def replace_bot_list_entries(list_id: int, body: BotListEntriesRequest) -> dict[str, Any]:
    try:
        return await bot_lists.replace_entries(list_id, body.entries)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.post("/{list_id}/entries")
async def add_bot_list_entry(list_id: int, body: BotEntry) -> dict[str, Any]:
    try:
        return await bot_lists.add_entry(list_id, body)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.get("/{list_id}/export")
async def export_bot_list(list_id: int) -> JSONResponse:
    """The list as a bot list file, offered as a download."""
    try:
        document = await bot_lists.export(list_id)
    except BotListError as exc:
        raise _refusal(exc) from exc
    return JSONResponse(
        content=document,
        headers={"Content-Disposition": f'attachment; filename="bot-list-{list_id}.json"'},
    )
