"""The bot list file format (pure, no I/O).

One JSON document is used for export, import, URL subscriptions and the list
shipped in the repo. A document that fails any check is refused as a whole; the
error message names the first problem.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

FORMAT = "rtfm-ev-bot-list"
VERSION = 1
MAX_FILE_BYTES = 256 * 1024
MAX_ENTRIES = 1000
MAX_NAME_LENGTH = 128
MAX_NOTE_LENGTH = 256
MAX_DESCRIPTION_LENGTH = 1024
_HEX = frozenset("0123456789abcdef")


class BotListFormatError(ValueError):
    """The document is not a valid bot list. The message says why."""


class BotEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    public_key: str | None = None
    note: str | None = Field(default=None, max_length=MAX_NOTE_LENGTH)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        # Names match exactly, so a padded name would be stored and never match.
        if value != value.strip():
            raise ValueError("a name must not start or end with spaces")
        return value

    @field_validator("public_key")
    @classmethod
    def _check_key(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        key = value.strip().lower()
        if len(key) != 64 or not set(key) <= _HEX:
            raise ValueError("a public key is 64 hex characters")
        return key


class BotListFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    format: str
    version: int
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_DESCRIPTION_LENGTH)
    updated: str | None = Field(default=None, max_length=32)
    entries: list[BotEntry] = Field(default_factory=list, max_length=MAX_ENTRIES)

    @model_validator(mode="after")
    def _check_document(self) -> BotListFile:
        if self.format != FORMAT:
            raise ValueError(f"not a bot list file (format is {self.format!r})")
        if self.version != VERSION:
            raise ValueError(f"unsupported bot list version {self.version}")
        seen: set[str] = set()
        for entry in self.entries:
            if entry.name in seen:
                raise ValueError(f"the name {entry.name!r} appears more than once")
            seen.add(entry.name)
        return self


def validate_bot_list(data: Any) -> BotListFile:
    """Validate an already parsed document."""
    if not isinstance(data, dict):
        raise BotListFormatError("the file is not a bot list object")
    try:
        return BotListFile.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        # Pydantic prefixes the text of our own checks; the user sees this message.
        message = str(first["msg"]).removeprefix("Value error, ")
        raise BotListFormatError(f"{where}: {message}" if where else message) from exc


def parse_bot_list(raw: bytes | str) -> BotListFile:
    """Parse and validate the text of a bot list file."""
    size = len(raw) if isinstance(raw, bytes) else len(raw.encode())
    if size > MAX_FILE_BYTES:
        raise BotListFormatError(f"the file is larger than {MAX_FILE_BYTES // 1024} KiB")
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise BotListFormatError("the file is not valid JSON") from exc
    return validate_bot_list(data)
