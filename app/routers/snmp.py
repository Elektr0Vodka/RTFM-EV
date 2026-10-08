"""SNMP polling of observer firmware nodes (LAN), per contact.

Config and polling use UDP to the node's WiFi address and never touch the
radio. The one exception is ``discover-address``, which sends a single CLI
command over RF to ask the node for that address.

``nodes_router`` serves the overview of every contact with SNMP set up
(database only, no polling and no radio).
"""

import logging
import time

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    ContactSnmpConfig,
    ContactSnmpConfigUpdate,
    SnmpDiscoverAddressResponse,
    SnmpHistoryEntry,
    SnmpNodeOverview,
    SnmpPollResponse,
)
from app.repository.contact_snmp import ContactSnmpRepository, SnmpHistoryRepository
from app.routers.contacts import _resolve_contact_or_404
from app.routers.server_control import batch_cli_fetch, require_server_capable_contact
from app.services import repeater_settings
from app.services.radio_runtime import radio_runtime as radio_manager
from app.services.snmp_poll import poll_contact
from app.snmp.address import parse_wifi_status_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacts", tags=["snmp"])
nodes_router = APIRouter(prefix="/snmp", tags=["snmp"])

DEFAULT_COMMUNITY = "public"
# Largest history payload: longer ranges are thinned to this many rows.
HISTORY_MAX_POINTS = 1500


def _to_model(row: dict) -> ContactSnmpConfig:
    return ContactSnmpConfig(
        public_key=row["public_key"],
        host=row["host"],
        port=row["port"],
        community_is_default=row["community"] == DEFAULT_COMMUNITY,
        poll_enabled=row["poll_enabled"],
        poll_interval_minutes=row["poll_interval_minutes"],
        last_ok_at=row["last_ok_at"],
        last_error=row["last_error"],
        last_error_at=row["last_error_at"],
    )


@nodes_router.get("/nodes", response_model=list[SnmpNodeOverview])
async def get_snmp_nodes() -> list[SnmpNodeOverview]:
    """Every contact with SNMP set up: settings, last poll outcome and the
    newest stored poll (read-only, polls nothing)."""
    rows = await ContactSnmpRepository.list_overview(default_community=DEFAULT_COMMUNITY)
    nodes: list[SnmpNodeOverview] = []
    for row in rows:
        latest = await SnmpHistoryRepository.get_latest(row["public_key"])
        nodes.append(SnmpNodeOverview(**row, latest=SnmpHistoryEntry(**latest) if latest else None))
    return nodes


@router.get("/{public_key}/snmp/config", response_model=ContactSnmpConfig | None)
async def get_snmp_config(public_key: str) -> ContactSnmpConfig | None:
    """Stored SNMP settings for a contact, or null when none are set."""
    contact = await _resolve_contact_or_404(public_key)
    row = await ContactSnmpRepository.get(contact.public_key)
    return _to_model(row) if row else None


@router.put("/{public_key}/snmp/config", response_model=ContactSnmpConfig)
async def put_snmp_config(public_key: str, request: ContactSnmpConfigUpdate) -> ContactSnmpConfig:
    """Save SNMP settings. A null community keeps the stored one."""
    contact = await _resolve_contact_or_404(public_key)
    require_server_capable_contact(contact)
    existing = await ContactSnmpRepository.get(contact.public_key)
    community = request.community or (existing["community"] if existing else DEFAULT_COMMUNITY)
    await ContactSnmpRepository.upsert(
        contact.public_key,
        host=request.host,
        port=request.port,
        community=community,
        poll_enabled=request.poll_enabled,
        poll_interval_minutes=request.poll_interval_minutes,
        now=int(time.time()),
    )
    row = await ContactSnmpRepository.get(contact.public_key)
    if row is None:
        raise HTTPException(status_code=500, detail="SNMP settings were not stored")
    return _to_model(row)


@router.delete("/{public_key}/snmp/config")
async def delete_snmp_config(public_key: str) -> dict:
    """Remove a contact's SNMP settings (and with them the stored community)."""
    contact = await _resolve_contact_or_404(public_key)
    deleted = await ContactSnmpRepository.delete(contact.public_key)
    return {"status": "ok", "deleted": deleted}


@router.post("/{public_key}/snmp/poll", response_model=SnmpPollResponse)
async def poll_snmp(public_key: str) -> SnmpPollResponse:
    """Poll the contact's SNMP agent once (UDP, no radio access).

    A poll that fails is a normal outcome: the response has ``ok = false`` and
    the reason, and the failure is stored on the settings row.
    """
    contact = await _resolve_contact_or_404(public_key)
    row = await ContactSnmpRepository.get(contact.public_key)
    if row is None:
        raise HTTPException(status_code=400, detail="No SNMP address is set for this contact")
    return await poll_contact(row)


@router.get("/{public_key}/snmp/history", response_model=list[SnmpHistoryEntry])
async def get_snmp_history(
    public_key: str, hours: int = Query(default=24, ge=1, le=24 * 365)
) -> list[SnmpHistoryEntry]:
    """Stored SNMP polls of the last ``hours``, oldest first (read-only).

    A long range is thinned to at most ``HISTORY_MAX_POINTS`` rows.
    """
    contact = await _resolve_contact_or_404(public_key)
    since = int(time.time()) - hours * 3600
    rows = await SnmpHistoryRepository.get_history(
        contact.public_key, since, max_points=HISTORY_MAX_POINTS
    )
    return [SnmpHistoryEntry(**row) for row in rows]


@router.post("/{public_key}/snmp/discover-address", response_model=SnmpDiscoverAddressResponse)
async def discover_snmp_address(public_key: str) -> SnmpDiscoverAddressResponse:
    """Ask the node for its WiFi address: ONE ``get wifi.status`` over RF.

    Needs an admin login on the node (the firmware ignores CLI otherwise).
    Nothing is saved; the caller decides what to do with the address.
    """
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    require_server_capable_contact(contact)

    results = await batch_cli_fetch(
        contact, "snmp_discover_address", [("get wifi.status", "wifi_status")]
    )
    reply = results.get("wifi_status")
    if reply is None:
        return SnmpDiscoverAddressResponse(status="no_reply")
    if repeater_settings.is_error_reply(reply):
        return SnmpDiscoverAddressResponse(status="unsupported", reply=reply)
    ip = parse_wifi_status_ip(reply)
    return SnmpDiscoverAddressResponse(status="ok" if ip else "no_address", ip=ip, reply=reply)
