"""Bot lists: lists of known bots that users keep, share as files and enable.

An enabled list marks its senders in chat; Hide bots (an app setting) hides
them; Block forwards asks Spam Guard to keep them off the air. Nothing here
transmits.
"""

import logging
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
from app.services.bot_list_fetch import MAX_URL_LENGTH, BotListFetchError
from app.services.bot_lists import (
    MAX_EFFECTIVE,
    BotListError,
    BotListNotFound,
    BotListReadOnly,
    bot_lists,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bot-lists", tags=["bot-lists"])


class BotListCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)


class BotListUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    enabled: bool | None = Field(default=None, description="Mark this list's senders in chat")
    block_forward: bool | None = Field(
        default=None,
        description="Stop this repeater relaying channel text from the list's names",
    )


class BotListReviewRequest(BaseModel):
    names: list[str] = Field(
        max_length=MAX_ENTRIES, description="Names a refresh added that the user confirms"
    )


class BotListEntriesRequest(BaseModel):
    entries: list[BotEntry] = Field(max_length=MAX_ENTRIES)


class BotExceptionsRequest(BaseModel):
    names: list[str] = Field(max_length=MAX_EFFECTIVE, description="Names never treated as a bot")


class BotListUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_URL_LENGTH, description="https URL of a list")


def _refusal(exc: BotListError) -> HTTPException:
    # A code the UI words in the user's language, or else the sentence as it is.
    detail = exc.code or str(exc)
    if isinstance(exc, BotListNotFound):
        return HTTPException(status_code=404, detail=detail)
    if isinstance(exc, BotListReadOnly):
        return HTTPException(status_code=409, detail=detail)
    return HTTPException(status_code=400, detail=detail)


@router.get("")
async def get_bot_lists() -> dict[str, Any]:
    """Lists, exceptions and the effective set of names and keys."""
    return await bot_lists.snapshot()


@router.post("")
async def create_bot_list(body: BotListCreateRequest) -> dict[str, Any]:
    return await bot_lists.create_local(body.name, body.description)


@router.put("/exceptions")
async def set_bot_exceptions(body: BotExceptionsRequest) -> dict[str, Any]:
    try:
        return await bot_lists.set_exceptions(body.names)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.post("/import")
async def import_bot_list(request: Request) -> dict[str, Any]:
    """Store an uploaded bot list file as a new local list (switched off)."""
    try:
        parsed = parse_bot_list(await request.body())
    except BotListFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await bot_lists.import_file(parsed)


@router.post("/preview-url")
async def preview_bot_list_url(body: BotListUrlRequest) -> dict[str, Any]:
    """Fetch and validate a list by URL without storing it."""
    try:
        return await bot_lists.preview_url(body.url)
    except BotListFetchError as exc:
        logger.warning("Bot list URL refused (%s): %s", exc.code, exc.detail)
        raise HTTPException(status_code=400, detail=exc.public_text()) from exc


@router.post("/subscribe")
async def subscribe_bot_list(body: BotListUrlRequest) -> dict[str, Any]:
    """Subscribe to a list by URL. It is stored read-only and switched off."""
    try:
        return await bot_lists.subscribe(body.url)
    except BotListFetchError as exc:
        logger.warning("Bot list URL refused (%s): %s", exc.code, exc.detail)
        raise HTTPException(status_code=400, detail=exc.public_text()) from exc
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.patch("/{list_id}")
async def update_bot_list(list_id: int, body: BotListUpdateRequest) -> dict[str, Any]:
    try:
        return await bot_lists.update(
            list_id,
            name=body.name,
            description=body.description,
            enabled=body.enabled,
            block_forward=body.block_forward,
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


@router.post("/{list_id}/refresh")
async def refresh_bot_list(list_id: int) -> dict[str, Any]:
    """Refresh a subscription now. A failed fetch shows as the list's ``last_error``."""
    try:
        return await bot_lists.refresh_list(list_id)
    except BotListError as exc:
        raise _refusal(exc) from exc


@router.post("/{list_id}/review")
async def review_bot_list(list_id: int, body: BotListReviewRequest) -> dict[str, Any]:
    """Confirm names a refresh added. Until then Block forwards leaves them out."""
    try:
        return await bot_lists.review(list_id, body.names)
    except BotListError as exc:
        raise _refusal(exc) from exc
