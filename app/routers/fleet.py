"""Fleet asset register: the devices an operator keeps track of.

An asset holds what only the operator knows (serials, MAC addresses, who has
it, where it is placed) plus a log of what happened to it. What the mesh
reports about the node (name, last seen, battery, firmware) comes from stored
data of the contact with the same public key and is read at request time,
never copied.

Nothing here talks to the radio and nothing here stores a secret.
"""

import logging
import re
import sqlite3
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.repository import ContactRepository
from app.repository.fleet import (
    FleetAssetRepository,
    FleetEventRepository,
    FleetSettingsRepository,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fleet", tags=["fleet"])

FleetAssetStatus = Literal["in_stock", "deployed", "maintenance", "lost", "stolen", "retired"]
# What a person can log. ``status`` and ``config_applied`` rows are written by the app only.
FleetEventManualKind = Literal["placement", "maintenance", "failure", "custody", "firmware", "note"]
FleetEventKind = Literal[
    "placement",
    "maintenance",
    "failure",
    "custody",
    "firmware",
    "note",
    "status",
    "config_applied",
]

_TEXT_MAX = 200
_NOTES_MAX = 4000
_TEXT_FIELDS = (
    "label",
    "org_serial",
    "hw_serial",
    "model",
    "role",
    "assigned_to",
    "site_name",
    "target_firmware",
)
_MAC_FIELDS = ("wifi_mac", "ble_mac")
# An asset must be findable by something a person can read or the mesh can match.
_IDENTIFIER_FIELDS = ("public_key", "label", "org_serial")
_HEX_KEY = re.compile(r"[0-9a-f]{64}")
_MAC = re.compile(r"[0-9A-F]{12}")


class FleetAssetContact(BaseModel):
    """The contact with the asset's public key, as stored right now."""

    name: str | None = None
    type: int | None = None
    last_seen: int | None = None
    lat: float | None = Field(default=None, description="Manual position when set, else advert")
    lon: float | None = None


class FleetAssetHealth(BaseModel):
    """What the node last reported, from stored data only. Null means nothing stored."""

    battery_volts: float | None = None
    temperature: float | None = None
    telemetry_at: int | None = Field(default=None, description="Time of that telemetry reading")
    firmware_version: str | None = None
    firmware_at: int | None = None
    firmware_source: Literal["radio", "owner_info", "snmp"] | None = None


class FleetAsset(BaseModel):
    id: int
    public_key: str | None = Field(default=None, description="64-char hex, lower case")
    label: str | None = None
    org_serial: str | None = Field(default=None, description="The organisation's own serial")
    hw_serial: str | None = Field(default=None, description="The manufacturer's serial")
    model: str | None = None
    role: str | None = None
    wifi_mac: str | None = Field(default=None, description="AA:BB:CC:DD:EE:FF")
    ble_mac: str | None = Field(default=None, description="AA:BB:CC:DD:EE:FF")
    assigned_to: str | None = None
    site_name: str | None = None
    status: FleetAssetStatus
    target_firmware: str | None = Field(
        default=None, description="The firmware version this device is meant to run"
    )
    notes: str | None = None
    created_at: int
    updated_at: int
    last_maintenance: int | None = Field(default=None, description="Newest maintenance entry")
    last_failure: int | None = Field(default=None, description="Newest failure entry")
    contact: FleetAssetContact | None = None
    health: FleetAssetHealth | None = Field(
        default=None, description="Null for an asset without a public key"
    )


class FleetAssetCreate(BaseModel):
    public_key: str | None = None
    label: str | None = Field(default=None, max_length=_TEXT_MAX)
    org_serial: str | None = Field(default=None, max_length=_TEXT_MAX)
    hw_serial: str | None = Field(default=None, max_length=_TEXT_MAX)
    model: str | None = Field(default=None, max_length=_TEXT_MAX)
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    wifi_mac: str | None = None
    ble_mac: str | None = None
    assigned_to: str | None = Field(default=None, max_length=_TEXT_MAX)
    site_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    status: FleetAssetStatus = "in_stock"
    target_firmware: str | None = Field(default=None, max_length=_TEXT_MAX)
    notes: str | None = Field(default=None, max_length=_NOTES_MAX)


class FleetAssetUpdate(BaseModel):
    """Only fields present in the body change; a field sent as null is cleared."""

    public_key: str | None = None
    label: str | None = Field(default=None, max_length=_TEXT_MAX)
    org_serial: str | None = Field(default=None, max_length=_TEXT_MAX)
    hw_serial: str | None = Field(default=None, max_length=_TEXT_MAX)
    model: str | None = Field(default=None, max_length=_TEXT_MAX)
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    wifi_mac: str | None = None
    ble_mac: str | None = None
    assigned_to: str | None = Field(default=None, max_length=_TEXT_MAX)
    site_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    status: FleetAssetStatus | None = None
    target_firmware: str | None = Field(default=None, max_length=_TEXT_MAX)
    notes: str | None = Field(default=None, max_length=_NOTES_MAX)


class FleetAssetsFromContactsRequest(BaseModel):
    public_keys: list[str] = Field(min_length=1, max_length=2000)


class FleetAssetsFromContactsResponse(BaseModel):
    created: list[FleetAsset]
    skipped: int = Field(description="Keys that already had an asset, are no contact, or repeat")


class FleetAssetEvent(BaseModel):
    id: int
    asset_id: int
    kind: FleetEventKind
    occurred_at: int
    summary: str | None = None
    detail: str | None = None
    actor: str | None = Field(default=None, description="Free text: who did it")
    from_value: str | None = Field(default=None, description="Old value of a logged change")
    to_value: str | None = Field(default=None, description="New value of a logged change")
    created_at: int


class FleetAssetEventCreate(BaseModel):
    kind: FleetEventManualKind
    occurred_at: int | None = Field(default=None, ge=0, description="Unix seconds; now if absent")
    summary: str = Field(max_length=_TEXT_MAX)
    detail: str | None = Field(default=None, max_length=_NOTES_MAX)
    actor: str | None = Field(default=None, max_length=_TEXT_MAX)


class FleetSettings(BaseModel):
    """Thresholds of the "needs attention" filter on the Fleet page."""

    silent_hours: int = Field(ge=1, le=8760, description="A deployed node not seen for longer")
    low_battery_volts: float = Field(ge=0, le=100, description="A battery reading below this")


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def _clean_text(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _clean_public_key(value: str | None) -> str | None:
    key = (value or "").strip().lower()
    if not key:
        return None
    if not _HEX_KEY.fullmatch(key):
        raise _unprocessable("public_key must be 64-char hex")
    return key


def _clean_mac(field: str, value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    digits = re.sub(r"[:\-.\s]", "", text).upper()
    if not _MAC.fullmatch(digits):
        raise _unprocessable(f"{field} must be a MAC address (12 hex digits)")
    return ":".join(digits[i : i + 2] for i in range(0, 12, 2))


def _normalise(provided: dict[str, Any]) -> dict[str, Any]:
    """Trim and validate the fields that were sent. Blank text becomes None."""
    cleaned = dict(provided)
    if "public_key" in cleaned:
        cleaned["public_key"] = _clean_public_key(cleaned["public_key"])
    for field in (*_TEXT_FIELDS, "notes"):
        if field in cleaned:
            cleaned[field] = _clean_text(cleaned[field])
    for field in _MAC_FIELDS:
        if field in cleaned:
            cleaned[field] = _clean_mac(field, cleaned[field])
    return cleaned


def _require_identifier(asset: dict[str, Any]) -> None:
    if not any(asset.get(field) for field in _IDENTIFIER_FIELDS):
        raise _unprocessable("an asset needs a public key, a label or an organisation serial")


async def _require_free_public_key(public_key: str | None, own_id: int | None = None) -> None:
    if public_key is None:
        return
    holder = await FleetAssetRepository.public_key_owner(public_key)
    if holder is not None and holder != own_id:
        raise HTTPException(status_code=409, detail="another asset already has this public key")


async def _with_health(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach what each node last reported. Stored data only; no node is asked."""
    if not any(asset["public_key"] for asset in assets):
        for asset in assets:
            asset["health"] = None
        return assets

    # Local imports: the contacts router is large and pulls in the radio runtime.
    from app.routers.contacts import _own_radio_public_key, get_latest_telemetry
    from app.services.radio_runtime import radio_runtime as radio_manager

    telemetry = await get_latest_telemetry()
    firmware = await FleetAssetRepository.reported_firmware()
    own_key = _own_radio_public_key()
    own_firmware = getattr(radio_manager, "firmware_version", None)

    for asset in assets:
        key = asset["public_key"]
        if not key:
            asset["health"] = None
            continue
        health: dict[str, Any] = dict(firmware.get(key, {}))
        if key == own_key and isinstance(own_firmware, str) and own_firmware:
            # The connected radio answers for itself, live.
            health = {
                "firmware_version": own_firmware,
                "firmware_at": int(time.time()),
                "firmware_source": "radio",
            }
        reading = telemetry.get(key)
        if reading is not None:
            health["battery_volts"] = reading.battery_volts
            health["temperature"] = reading.temperature
            health["telemetry_at"] = reading.timestamp
        asset["health"] = health
    return assets


async def _asset_or_404(asset_id: int, *, health: bool = True) -> dict[str, Any]:
    asset = await FleetAssetRepository.get(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    if health:
        await _with_health([asset])
    return asset


def _change_events(current: dict[str, Any], changes: dict[str, Any]) -> list[dict[str, Any]]:
    """Log rows for a status change and a change of holder, old and new value each."""
    now = int(time.time())
    events: list[dict[str, Any]] = []
    for field, kind in (("status", "status"), ("assigned_to", "custody")):
        if field in changes and changes[field] != current.get(field):
            events.append(
                {
                    "kind": kind,
                    "occurred_at": now,
                    "from_value": current.get(field),
                    "to_value": changes[field],
                }
            )
    return events


@router.get("/assets", response_model=list[FleetAsset])
async def list_assets(
    public_key: str | None = Query(default=None, description="Only the asset of this node"),
) -> list[dict[str, Any]]:
    """Every asset, each with its contact when a contact has the same public key."""
    return await _with_health(await FleetAssetRepository.get_all(_clean_public_key(public_key)))


@router.post("/assets", response_model=FleetAsset, status_code=status.HTTP_201_CREATED)
async def create_asset(body: FleetAssetCreate) -> dict[str, Any]:
    """Add an asset. The public key is optional and need not be a known contact."""
    fields = _normalise(body.model_dump())
    _require_identifier(fields)
    await _require_free_public_key(fields["public_key"])
    try:
        asset_id = await FleetAssetRepository.create(
            fields, _change_events({}, {"assigned_to": fields["assigned_to"]})
        )
    except sqlite3.IntegrityError:
        # Two requests for the same key at once: the UNIQUE column decides.
        raise HTTPException(
            status_code=409, detail="another asset already has this public key"
        ) from None
    return await _asset_or_404(asset_id)


@router.post("/assets/from-contacts", response_model=FleetAssetsFromContactsResponse)
async def create_assets_from_contacts(body: FleetAssetsFromContactsRequest) -> dict[str, Any]:
    """Add one ``deployed`` asset per given contact that has none yet.

    Rows are created only; no contact and no existing asset is changed.
    """
    keys = [_clean_public_key(key) for key in body.public_keys]
    if any(key is None for key in keys):
        raise _unprocessable("public_key must be 64-char hex")

    created_ids: list[int] = []
    seen: set[str] = set()
    skipped = 0
    for key in keys:
        assert key is not None
        if (
            key in seen
            or await FleetAssetRepository.public_key_owner(key) is not None
            or await ContactRepository.get_by_key(key) is None
        ):
            skipped += 1
            continue
        seen.add(key)
        created_ids.append(
            await FleetAssetRepository.create({"public_key": key, "status": "deployed"})
        )
    created: list[dict[str, Any]] = []
    for asset_id in created_ids:
        asset = await FleetAssetRepository.get(asset_id)
        if asset is not None:
            created.append(asset)
    if created:
        logger.info("Added %d fleet assets from contacts", len(created))
    return {"created": await _with_health(created), "skipped": skipped}


@router.get("/assets/{asset_id}", response_model=FleetAsset)
async def get_asset(asset_id: int) -> dict[str, Any]:
    return await _asset_or_404(asset_id)


@router.patch("/assets/{asset_id}", response_model=FleetAsset)
async def update_asset(asset_id: int, body: FleetAssetUpdate) -> dict[str, Any]:
    """Change the fields present in the body; a field sent as null is cleared.

    A new status and a new holder are also written to the asset's log.
    """
    current = await _asset_or_404(asset_id, health=False)
    changes = _normalise(body.model_dump(include=body.model_fields_set))
    if "status" in changes and changes["status"] is None:
        raise _unprocessable("status cannot be empty")
    _require_identifier({**current, **changes})
    if "public_key" in changes:
        await _require_free_public_key(changes["public_key"], own_id=asset_id)
    try:
        await FleetAssetRepository.update(asset_id, changes, _change_events(current, changes))
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409, detail="another asset already has this public key"
        ) from None
    return await _asset_or_404(asset_id)


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: int) -> dict[str, str]:
    """Remove the asset, its log and its stored configs. The contact is not touched.

    Refused while the asset has secrets in the vault: deleting a private key is
    a step of its own.
    """
    from app.repository.fleet_vault import FleetVaultRepository

    if await FleetVaultRepository.count_secrets(asset_id) > 0:
        raise HTTPException(
            status_code=409,
            detail="This asset has secrets in the vault. Delete those first.",
        )
    if not await FleetAssetRepository.delete(asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"status": "ok"}


@router.get("/assets/{asset_id}/events", response_model=list[FleetAssetEvent])
async def list_asset_events(asset_id: int) -> list[dict[str, Any]]:
    """The asset's log, newest first."""
    await _asset_or_404(asset_id, health=False)
    return await FleetEventRepository.get_for_asset(asset_id)


@router.post(
    "/assets/{asset_id}/events",
    response_model=FleetAssetEvent,
    status_code=status.HTTP_201_CREATED,
)
async def add_asset_event(asset_id: int, body: FleetAssetEventCreate) -> dict[str, Any]:
    """Add a log entry by hand (maintenance, failure, placement, custody, firmware, note)."""
    await _asset_or_404(asset_id, health=False)
    summary = _clean_text(body.summary)
    if summary is None:
        raise _unprocessable("summary cannot be empty")
    return await FleetEventRepository.create(
        asset_id,
        {
            "kind": body.kind,
            "occurred_at": body.occurred_at if body.occurred_at is not None else int(time.time()),
            "summary": summary,
            "detail": _clean_text(body.detail),
            "actor": _clean_text(body.actor),
        },
    )


@router.delete("/assets/{asset_id}/events/{event_id}")
async def delete_asset_event(asset_id: int, event_id: int) -> dict[str, str]:
    """Remove one log entry of this asset."""
    if not await FleetEventRepository.delete(asset_id, event_id):
        raise HTTPException(status_code=404, detail="Log entry not found")
    return {"status": "ok"}


@router.get("/settings", response_model=FleetSettings)
async def get_fleet_settings() -> dict[str, Any]:
    return await FleetSettingsRepository.get()


@router.put("/settings", response_model=FleetSettings)
async def save_fleet_settings(body: FleetSettings) -> dict[str, Any]:
    await FleetSettingsRepository.save(body.silent_hours, body.low_battery_volts)
    return await FleetSettingsRepository.get()
