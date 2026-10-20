"""The brokers the wardrive page may forward to (owner answer 2): the DMC
hunter and wardriver streams and meshcore-analyzer.eu are built in; the owner
adds or removes others in Settings > Wardrive. Drivers switch them on per
radio in the page and cannot add their own.

A broker either takes core-hunter's wardrive obs/track messages under a
stream label (``wardrive``) or observer ``packets`` messages under a region
(``packets``, what RTFM-EV's own community MQTT publisher sends). Sign-in is a
token the driver's radio signs for the broker host (``companion``) or a
username and password the owner enters (``password``). Those passwords reach
logged-in drivers' browsers: they must, to connect."""

import re
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

from app.repository.wardrive import WardriveConfigRepository

CUSTOM_BROKERS = "brokers"
ANALYZER_REGION = "analyzer_region"
DEFAULT_ANALYZER_REGION = "nl"
MAX_CUSTOM_BROKERS = 20

_ID = re.compile(r"^[a-z0-9-]{2,32}$")
_LABEL = re.compile(r"^[a-z0-9-]{1,32}$")
REGION_RE = re.compile(r"^[a-z0-9-]{1,16}$")

BUILTIN_BROKERS: list[dict[str, Any]] = [
    {
        "id": "dmc-hunter",
        "name": "DutchMeshCore hunter",
        "url": "wss://collector1.dutchmeshcore.nl:443",
        "auth": "companion",
        "format": "wardrive",
        "label": "hunter",
    },
    {
        "id": "dmc-wardriver",
        "name": "DutchMeshCore wardriver",
        "url": "wss://collector2.dutchmeshcore.nl:443",
        "auth": "companion",
        "format": "wardrive",
        "label": "wardriver",
    },
    {
        "id": "meshcore-analyzer",
        "name": "meshcore-analyzer.eu",
        "url": "wss://mqtt.meshcore-analyzer.eu:443",
        "auth": "companion",
        "format": "packets",
    },
]
BUILTIN_IDS = {b["id"] for b in BUILTIN_BROKERS}
# The page's own upload queue destination is rtfm@<KEY> (uploader.ts
# localDest): a broker with that id would share its watermark.
RESERVED_IDS = BUILTIN_IDS | {"rtfm"}


def audience_of(url: str) -> str:
    """The token audience: the broker's host (the DMC collectors' rule)."""
    return urlparse(url).hostname or ""


class BrokerIn(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=64)
    url: str = Field(max_length=256)
    auth: Literal["companion", "password"]
    username: str | None = Field(default=None, max_length=128)
    password: str | None = Field(default=None, max_length=256)
    format: Literal["wardrive", "packets"]
    label: str | None = None
    region: str | None = None

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _ID.match(v) or v in RESERVED_IDS:
            raise ValueError("Use 2 to 32 lower-case letters, digits or '-', not a reserved id")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A broker needs a name")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        parsed = urlparse(v.strip())
        if parsed.scheme != "wss" or not parsed.hostname:
            raise ValueError("Use a wss:// address")
        return v.strip()

    @model_validator(mode="after")
    def _shape(self) -> "BrokerIn":
        if self.auth == "password" and not (self.username and self.password):
            raise ValueError("A password broker needs a username and a password")
        if self.format == "wardrive" and not (self.label and _LABEL.match(self.label)):
            raise ValueError("A wardrive broker needs a stream label")
        if self.format == "packets" and not (self.region and REGION_RE.match(self.region)):
            raise ValueError("A packets broker needs a region code")
        return self

    def stored(self) -> dict[str, Any]:
        """The broker as kept: only the fields its kind uses."""
        out: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "auth": self.auth,
            "format": self.format,
        }
        if self.auth == "password":
            out["username"] = self.username
            out["password"] = self.password
        if self.format == "wardrive":
            out["label"] = self.label
        else:
            out["region"] = self.region
        return out


def check_custom(brokers: list[BrokerIn]) -> list[dict[str, Any]]:
    if len(brokers) > MAX_CUSTOM_BROKERS:
        raise ValueError(f"At most {MAX_CUSTOM_BROKERS} brokers")
    ids = [b.id for b in brokers]
    if len(set(ids)) != len(ids):
        raise ValueError("Each broker needs its own id")
    return [b.stored() for b in brokers]


async def custom_brokers() -> list[dict[str, Any]]:
    stored = await WardriveConfigRepository.get_json(CUSTOM_BROKERS)
    return [b for b in stored if isinstance(b, dict)] if isinstance(stored, list) else []


async def analyzer_region() -> str:
    stored = await WardriveConfigRepository.get_json(ANALYZER_REGION)
    return (
        stored if isinstance(stored, str) and REGION_RE.match(stored) else DEFAULT_ANALYZER_REGION
    )


async def builtin_brokers() -> list[dict[str, Any]]:
    region = await analyzer_region()
    out = []
    for b in BUILTIN_BROKERS:
        entry = {**b, "audience": audience_of(b["url"]), "builtin": True}
        if b["format"] == "packets":
            entry["region"] = region
        out.append(entry)
    return out


async def served_brokers() -> list[dict[str, Any]]:
    """Built-ins first, then the owner's, each with its token audience."""
    custom = [
        {**b, "audience": audience_of(b["url"]), "builtin": False} for b in await custom_brokers()
    ]
    return [*await builtin_brokers(), *custom]
