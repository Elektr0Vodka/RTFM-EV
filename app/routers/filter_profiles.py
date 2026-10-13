"""Filter library: saved profiles of filter settings, applied by hand and shared as files.

Applying a profile changes the settings of the feature it belongs to (Spam
Guard is the first kind). Importing a file only stores it. Nothing here
transmits.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.filter_profiles.format import (
    MAX_DESCRIPTION_LENGTH,
    MAX_KIND_LENGTH,
    MAX_NAME_LENGTH,
    clean_name,
    parse_profile,
)
from app.filter_profiles.kinds import ProfileError
from app.services.filter_profiles import filter_profiles

router = APIRouter(prefix="/filter-profiles", tags=["filter-profiles"])


class ProfileCreateRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=MAX_KIND_LENGTH)
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return clean_name(value)


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    capture: bool = Field(
        default=False, description="Overwrite the profile with the live values (Save to profile)"
    )

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else clean_name(value)


class ProfileApplyRequest(BaseModel):
    confirm_protect: bool = Field(
        default=False,
        description="The user's yes to a profile that switches Spam Guard to Protect",
    )


def _refusal(exc: ProfileError) -> HTTPException:
    # The code is what the UI words in the user's language.
    return HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("")
async def get_filter_profiles(
    kind: str = Query(max_length=MAX_KIND_LENGTH, description="Which library, e.g. spam_guard"),
) -> dict[str, Any]:
    """The profiles of one kind and which one is in use."""
    try:
        return await filter_profiles.snapshot(kind)
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.post("")
async def create_filter_profile(body: ProfileCreateRequest) -> dict[str, Any]:
    """Save the live values as a new profile."""
    try:
        return await filter_profiles.create(body.kind, body.name, body.description)
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.post("/import")
async def import_filter_profile(request: Request) -> dict[str, Any]:
    """Store an uploaded profile file. It is not applied."""
    try:
        return await filter_profiles.import_file(parse_profile(await request.body()))
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.patch("/{profile_id}")
async def update_filter_profile(profile_id: int, body: ProfileUpdateRequest) -> dict[str, Any]:
    try:
        return await filter_profiles.update(
            profile_id, name=body.name, description=body.description, capture=body.capture
        )
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.delete("/{profile_id}")
async def delete_filter_profile(profile_id: int) -> dict[str, Any]:
    try:
        return await filter_profiles.delete(profile_id)
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.get("/{profile_id}/export")
async def export_filter_profile(profile_id: int) -> JSONResponse:
    """The profile in the file format, offered as a download."""
    try:
        filename, document = await filter_profiles.export(profile_id)
    except ProfileError as exc:
        raise _refusal(exc) from exc
    return JSONResponse(
        content=document,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{profile_id}/changes")
async def get_filter_profile_changes(profile_id: int) -> dict[str, Any]:
    """What applying the profile would change, old and new value per setting."""
    try:
        return await filter_profiles.changes(profile_id)
    except ProfileError as exc:
        raise _refusal(exc) from exc


@router.post("/{profile_id}/apply")
async def apply_filter_profile(profile_id: int, body: ProfileApplyRequest) -> dict[str, Any]:
    """Apply a profile. 409 ``needs_confirm`` for a switch to Protect without the yes."""
    try:
        return await filter_profiles.apply(profile_id, confirmed=body.confirm_protect)
    except ProfileError as exc:
        raise _refusal(exc) from exc
