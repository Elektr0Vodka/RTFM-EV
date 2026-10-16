"""LAN discovery: find MeshCore devices on the local network (Tools > Network scan).

Everything here is LAN traffic from the server: SNMP GETs over UDP and, only
when asked, companion protocol handshakes over TCP and HTTP GETs of a DMC
observer's web config status. Nothing goes over RF. See
``app/services/lan_discovery.py`` for what is checked and why the companion
check is opt-in.
"""

import ipaddress
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException

from app.models import (
    LanScanCompanionResult,
    LanScanContactMatch,
    LanScanHost,
    LanScanRequest,
    LanScanSnmpResult,
    LanScanStatus,
    LanScanSuggestions,
    LanScanWebconfigResult,
)
from app.repository.contact_snmp import ContactSnmpRepository
from app.repository.contacts import ContactRepository
from app.routers.snmp import DEFAULT_COMMUNITY
from app.services import lan_discovery
from app.services.lan_discovery import ScanBusyError, ScanJob, ScanTargetError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lan-discovery", tags=["lan-discovery"])


async def _match_contact(
    public_key: str | None, node_id: str | None, names: list[str | None]
) -> LanScanContactMatch | None:
    """The contact a device belongs to: by public key when the companion
    protocol gave one, else by the web config's node id (a key prefix only one
    contact has), else by a name that only one contact has."""
    contact = None
    matched_by: Literal["public_key", "node_id", "name"] = "public_key"
    if public_key:
        contact = await ContactRepository.get_by_key(public_key)
    if contact is None and node_id:
        matched_by = "node_id"
        contact = await ContactRepository.get_by_key_prefix(node_id)
    if contact is None:
        matched_by = "name"
        for name in names:
            if not name:
                continue
            candidates = await ContactRepository.get_by_name(name)
            if len(candidates) == 1:
                contact = candidates[0]
                break
    if contact is None:
        return None
    snmp = await ContactSnmpRepository.get(contact.public_key)
    return LanScanContactMatch(
        public_key=contact.public_key,
        name=contact.name,
        type=contact.type,
        matched_by=matched_by,
        snmp_host=snmp["host"] if snmp else None,
        snmp_port=snmp["port"] if snmp else None,
    )


async def _status(job: ScanJob) -> LanScanStatus:
    hosts: list[LanScanHost] = []
    for ip in sorted(job.hosts, key=ipaddress.IPv4Address):
        found = job.hosts[ip]
        snmp = LanScanSnmpResult(**found["snmp"]) if "snmp" in found else None
        companion = LanScanCompanionResult(**found["companion"]) if "companion" in found else None
        webconfig = LanScanWebconfigResult(**found["webconfig"]) if "webconfig" in found else None
        names = [
            companion.name if companion else None,
            webconfig.name if webconfig else None,
            snmp.node_name if snmp else None,
        ]
        contact = await _match_contact(
            companion.public_key if companion else None,
            webconfig.node_id if webconfig else None,
            names,
        )
        hosts.append(
            LanScanHost(ip=ip, snmp=snmp, companion=companion, webconfig=webconfig, contact=contact)
        )
    return LanScanStatus(
        id=job.id,
        running=job.running,
        cancelled=job.cancelled,
        error=job.error,
        started_at=job.started_at,
        finished_at=job.finished_at,
        total=len(job.targets),
        done=job.done,
        snmp=job.options.snmp,
        snmp_port=job.options.snmp_port,
        companion=job.options.companion,
        companion_port=job.options.companion_port,
        webconfig=job.options.webconfig,
        webconfig_port=job.options.webconfig_port,
        skipped=job.skipped,
        hosts=hosts,
    )


@router.get("/suggestions", response_model=LanScanSuggestions)
async def get_suggestions() -> LanScanSuggestions:
    """The /24 networks of addresses RTFM-EV already uses: its own TCP radio
    and every SNMP address set up on a contact (database only, sends nothing)."""
    own = sorted(await lan_discovery.own_radio_addresses())
    addresses = list(own)
    for row in await ContactSnmpRepository.list_overview(default_community=DEFAULT_COMMUNITY):
        addresses.append(row["host"])
    networks: list[str] = []
    for text in addresses:
        try:
            address = ipaddress.IPv4Address(text)
        except ValueError:
            continue  # a hostname, or IPv6
        if not address.is_private or address.is_loopback:
            continue
        network = str(ipaddress.IPv4Network(f"{address}/24", strict=False))
        if network not in networks:
            networks.append(network)
    return LanScanSuggestions(networks=networks, own_radio=own)


@router.get("/scan", response_model=LanScanStatus | None)
async def get_scan() -> LanScanStatus | None:
    """The running or last scan with what it found so far; null before the first scan."""
    job = lan_discovery.current_job()
    return await _status(job) if job else None


@router.post("/scan", response_model=LanScanStatus)
async def start_scan(request: LanScanRequest) -> LanScanStatus:
    """Start a scan in the background. Poll ``GET /scan`` for progress."""
    try:
        job = await lan_discovery.start_scan(
            request.targets,
            snmp=request.snmp,
            snmp_port=request.snmp_port,
            community=request.community or DEFAULT_COMMUNITY,
            companion=request.companion,
            companion_port=request.companion_port,
            webconfig=request.webconfig,
            webconfig_port=request.webconfig_port,
        )
    except ScanBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ScanTargetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _status(job)


@router.post("/scan/cancel", response_model=LanScanStatus | None)
async def cancel_scan() -> LanScanStatus | None:
    """Stop the running scan; what it found so far stays."""
    await lan_discovery.cancel_scan()
    job = lan_discovery.current_job()
    return await _status(job) if job else None
