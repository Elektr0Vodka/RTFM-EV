"""The filter profile file format (pure, no I/O).

One JSON document holds one profile and is used for export and import. A
document that fails any check is refused as a whole. The payload is checked by
the profile's kind afterwards; this module only knows the envelope.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.filter_profiles.kinds import ProfileError

FORMAT = "rtfm-ev-filter-profile"
VERSION = 1
MAX_FILE_BYTES = 256 * 1024
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 256
MAX_KIND_LENGTH = 32
_SLUG_LENGTH = 40
_NOT_SLUG = re.compile(r"[^a-z0-9]+")


def clean_name(value: str) -> str:
    """A profile name without surrounding spaces. Raises ValueError when empty."""
    name = value.strip()
    if not name:
        raise ValueError("a name is at least one character")
    return name


def first_problem(exc: ValidationError) -> str:
    """The first problem of a validation error as ``field: message``."""
    first = exc.errors()[0]
    where = ".".join(str(part) for part in first["loc"])
    # Pydantic prefixes the text of our own checks; the user sees this message.
    message = str(first["msg"]).removeprefix("Value error, ")
    return f"{where}: {message}" if where else message


class ProfileFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: str
    version: int
    kind: str = Field(min_length=1, max_length=MAX_KIND_LENGTH)
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)
    updated: str | None = Field(default=None, max_length=32)
    payload: dict[str, Any]

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return clean_name(value)


def parse_profile(raw: bytes | str) -> ProfileFile:
    """Parse and validate the text of a profile file. Raises ProfileError."""
    size = len(raw) if isinstance(raw, bytes) else len(raw.encode())
    if size > MAX_FILE_BYTES:
        raise ProfileError("too_large")
    if isinstance(raw, str):
        # Editors on Windows put a byte order mark in front; bytes are handled by json.
        raw = raw.removeprefix("﻿")
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        # RecursionError: brackets nested thousands deep, from a file someone else wrote.
        raise ProfileError("not_json") from exc
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise ProfileError("not_a_profile")
    # ``type() is int``: True is an int in Python and must not pass as version 1.
    if type(data.get("version")) is not int or data["version"] != VERSION:
        raise ProfileError("unsupported_version")
    try:
        return ProfileFile.model_validate(data)
    except ValidationError as exc:
        raise ProfileError("invalid_file", first_problem(exc)) from exc


def export_document(row: dict[str, Any]) -> dict[str, Any]:
    """A stored profile as a file document."""
    return {
        "format": FORMAT,
        "version": VERSION,
        "kind": row["kind"],
        "name": row["name"],
        "description": row["description"],
        "updated": time.strftime("%Y-%m-%d", time.gmtime(row["updated_at"])),
        "payload": row["payload"],
    }


def export_filename(kind: str, name: str) -> str:
    """A download name in plain ASCII: it travels in an HTTP header."""
    slug = _NOT_SLUG.sub("-", name.lower()).strip("-")[:_SLUG_LENGTH].strip("-")
    return f"rtfm-ev-profile-{kind}-{slug or 'profile'}.json"
