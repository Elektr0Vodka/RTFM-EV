"""Wardrive obs and track messages, in core-hunter's ``app/src/wardrive.js``
shape: what the page publishes to the DutchMeshCore collectors and uploads
here as the local copy."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_BATCH = 500
# Counts and lengths above this are not real (and would not fit SQLite).
MAX_COUNT = 2**31 - 1
# Unix seconds a data window may name (year 36812; SQLite takes 2**63).
MAX_TS = 2**40

_HEX = "0123456789abcdefABCDEF"


def _hex(value: str, *, length: int | None = None) -> str:
    if not value or any(c not in _HEX for c in value) or len(value) % 2:
        raise ValueError("expected hex")
    if length is not None and len(value) != length:
        raise ValueError(f"expected {length} hex characters")
    return value


def iso_to_ts(value: str) -> int:
    """Unix seconds of an ISO 8601 timestamp (a bare one is read as UTC)."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp())


def _iso(value: str) -> str:
    """An ISO 8601 timestamp, rewritten as UTC with milliseconds
    (``2026-10-19T10:00:00.000Z``, what the page sends), so the same instant
    is the same text and a re-sent row is recognised as a duplicate."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        # An offset at the edge of the calendar overflows the conversion.
        utc = parsed.astimezone(UTC)
    except (ValueError, OverflowError):
        raise ValueError("expected an ISO 8601 timestamp") from None
    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Infinity and NaN are valid JSON to Python but not a signal or a distance.
_FINITE = ConfigDict(allow_inf_nan=False)


class ObsPos(BaseModel):
    model_config = _FINITE

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)
    src: str | None = Field(default=None, max_length=16)


class Obs(BaseModel):
    model_config = _FINITE

    v: Literal[1]
    origin_id: str
    rx_at: str
    pub_at: str | None = None
    hash: str
    raw: str = Field(max_length=1024)
    len: int | None = Field(default=None, ge=0, le=MAX_COUNT)
    packet_type: int | None = Field(default=None, ge=0, le=15)
    route: Literal["F", "D"] | None = None
    payload_len: int | None = Field(default=None, ge=0, le=MAX_COUNT)
    path: list[str] = Field(default_factory=list, max_length=64)
    RSSI: float | None = None
    SNR: float | None = None
    pos: ObsPos

    @field_validator("rx_at")
    @classmethod
    def _rx_at(cls, v: str) -> str:
        return _iso(v)

    @field_validator("pub_at")
    @classmethod
    def _pub_at(cls, v: str | None) -> str | None:
        return None if v is None else _iso(v)

    @field_validator("hash")
    @classmethod
    def _hash(cls, v: str) -> str:
        return _hex(v, length=16).lower()

    @field_validator("raw")
    @classmethod
    def _raw(cls, v: str) -> str:
        return _hex(v).lower()

    @field_validator("path")
    @classmethod
    def _path(cls, v: list[str]) -> list[str]:
        return [_hex(h).lower() for h in v]


class Track(BaseModel):
    model_config = _FINITE

    v: Literal[1]
    origin_id: str
    t0: str
    t1: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)
    rx_count: int = Field(ge=0, le=MAX_COUNT)
    listening: bool
    src: str | None = Field(default=None, max_length=16)

    @field_validator("t0", "t1")
    @classmethod
    def _times(cls, v: str) -> str:
        return _iso(v)


class UploadBody(BaseModel):
    radio_key: str
    # RTFM-EV's own drive id from the page (a UUID); never forwarded. Absent
    # from older pages: their rows join a drive by the 10-minute gap rule.
    drive_uid: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    )
    obs: list[Obs] = Field(default_factory=list, max_length=MAX_BATCH)
    tracks: list[Track] = Field(default_factory=list, max_length=MAX_BATCH)


class UploadResult(BaseModel):
    accepted_obs: int
    duplicate_obs: int
    accepted_tracks: int
    duplicate_tracks: int
