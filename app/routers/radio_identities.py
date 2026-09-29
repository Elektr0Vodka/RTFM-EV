"""Radio identity registry (plan 18 Phase 1): the radios that have fed this install.

Rows are created at connect (``app/services/radio_identity.py``). These
endpoints answer the connect-time question (new radio, replacement, or
whether pre-registry history belongs to the radio), edit a replacement link
and its carry-over flags, and set a note. Every change is one transaction
(``app/repository/radio_identities.py``) and is followed by a ``health``
broadcast so every open tab drops or updates its prompt. Nothing here touches
the radio or transmits.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models import RadioIdentity
from app.repository.radio_identities import (
    RadioIdentityConflict,
    RadioIdentityNotFound,
    RadioIdentityRepository,
)
from app.services.radio_runtime import radio_runtime as radio_manager
from app.websocket import broadcast_health

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/radio-identities", tags=["radio-identities"])


class RadioIdentityList(BaseModel):
    radios: list[RadioIdentity] = Field(description="Newest connect first")
    has_unassigned_history: bool = Field(
        description="Some stat samples were recorded before radio tracking and belong to no radio"
    )


class ReplaceRequest(BaseModel):
    old_id: int = Field(description="The radio this one replaces")
    carry_stats: bool = True
    carry_owned: bool = True
    carry_note: bool = True


class LinkUpdate(BaseModel):
    carry_stats: bool
    carry_owned: bool


class LegacyHistoryAnswer(BaseModel):
    adopt: bool = Field(description="True: the existing history belongs to this radio")


class NotesUpdate(BaseModel):
    notes: str | None = Field(default=None, max_length=500)


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RadioIdentityNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=409, detail=str(exc))


def _announce() -> None:
    broadcast_health(radio_manager.is_connected, radio_manager.connection_info)


@router.get("", response_model=RadioIdentityList)
async def list_radio_identities() -> RadioIdentityList:
    return RadioIdentityList(
        radios=await RadioIdentityRepository.list_all(),
        has_unassigned_history=await RadioIdentityRepository.has_unassigned_history(),
    )


@router.post("/{identity_id}/confirm-new", response_model=RadioIdentity)
async def confirm_new_radio(identity_id: int) -> RadioIdentity:
    """Answer "this is a new radio" for a pending radio."""
    try:
        identity = await RadioIdentityRepository.confirm_new(identity_id)
    except (RadioIdentityNotFound, RadioIdentityConflict) as exc:
        raise _http_error(exc) from exc
    _announce()
    return identity


@router.post("/{identity_id}/replace", response_model=RadioIdentity)
async def replace_radio(identity_id: int, request: ReplaceRequest) -> RadioIdentity:
    """Record that this radio replaces ``old_id``, with what it inherits."""
    try:
        identity = await RadioIdentityRepository.link_replacement(
            identity_id,
            request.old_id,
            carry_stats=request.carry_stats,
            carry_owned=request.carry_owned,
            carry_note=request.carry_note,
        )
    except (RadioIdentityNotFound, RadioIdentityConflict) as exc:
        raise _http_error(exc) from exc
    _announce()
    return identity


@router.post("/{identity_id}/legacy-history", response_model=RadioIdentity)
async def answer_legacy_history(identity_id: int, request: LegacyHistoryAnswer) -> RadioIdentity:
    """Answer whether history recorded before radio tracking belongs to this radio."""
    try:
        identity = await RadioIdentityRepository.resolve_legacy(identity_id, adopt=request.adopt)
    except (RadioIdentityNotFound, RadioIdentityConflict) as exc:
        raise _http_error(exc) from exc
    _announce()
    return identity


@router.patch("/{identity_id}/link", response_model=RadioIdentity)
async def update_replacement_link(identity_id: int, request: LinkUpdate) -> RadioIdentity:
    """Change what the replacing radio inherits from this (replaced) radio."""
    try:
        identity = await RadioIdentityRepository.update_link(
            identity_id, carry_stats=request.carry_stats, carry_owned=request.carry_owned
        )
    except (RadioIdentityNotFound, RadioIdentityConflict) as exc:
        raise _http_error(exc) from exc
    _announce()
    return identity


@router.delete("/{identity_id}/link", response_model=RadioIdentity)
async def remove_replacement_link(identity_id: int) -> RadioIdentity:
    """Undo a replacement: this radio stands alone again."""
    try:
        identity = await RadioIdentityRepository.remove_link(identity_id)
    except (RadioIdentityNotFound, RadioIdentityConflict) as exc:
        raise _http_error(exc) from exc
    _announce()
    return identity


@router.patch("/{identity_id}", response_model=RadioIdentity)
async def update_radio_identity(identity_id: int, request: NotesUpdate) -> RadioIdentity:
    try:
        return await RadioIdentityRepository.set_notes(identity_id, request.notes)
    except RadioIdentityNotFound as exc:
        raise _http_error(exc) from exc
