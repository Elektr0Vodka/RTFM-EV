"""LAN discovery: find MeshCore devices on a local network.

Up to three checks per address, all over the LAN, never over RF:

- SNMP (UDP, on by default): one GET of the MeshCore OID table's name,
  firmware and uptime plus the standard sysName and sysDescr. Observer
  repeaters and room servers and meshcomod companions answer with the MeshCore
  values; any other agent that knows the community is listed as "other".
  Harmless to every device: SNMP GET only reads.
- Companion protocol (TCP, off by default): see ``companion_probe``. Stock
  MeshCore WiFi companions drop their connected app when a new TCP connection
  arrives, so this check is opt-in and never touches the radio this instance
  is connected to.
- Web config (HTTP, off by default): see ``webconfig_probe``. One GET of a DMC
  observer's ``/api/status``, which only answers while its config page runs.
  Only replies with the observer's status fields are kept.

Only private addresses (RFC 1918, link-local, loopback) can be scanned, at most
``MAX_SCAN_HOSTS`` per scan. One scan runs at a time; its results stay in
memory until the next scan starts. The SNMP community lives only in the running
task and is never stored, returned or logged.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.services.companion_probe import CompanionProbeResult, probe_companion
from app.services.webconfig_probe import probe_webconfig
from app.snmp import ber
from app.snmp.ber import Oid
from app.snmp.client import SnmpError, SnmpResponseError, SnmpTimeoutError, snmp_get
from app.snmp.mib import BY_KEY, BY_OID, decode_entry

logger = logging.getLogger(__name__)

MAX_SCAN_HOSTS = 1024
MAX_CONCURRENT_PROBES = 64
SNMP_TIMEOUT_SECONDS = 1.0
SNMP_RETRIES = 1

SYS_DESCR: Oid = (1, 3, 6, 1, 2, 1, 1, 1, 0)
SYS_NAME: Oid = (1, 3, 6, 1, 2, 1, 1, 5, 0)
_MESHCORE_KEYS = ("node_name", "firmware_version", "uptime_secs")
SNMP_PROBE_OIDS: list[Oid] = [BY_KEY[key].oid for key in _MESHCORE_KEYS] + [SYS_NAME, SYS_DESCR]
# Longest text kept from an agent's sysDescr / sysName.
_MAX_TEXT = 200

_SPLIT_RE = re.compile(r"[\s,;]+")


class ScanTargetError(ValueError):
    """The targets text names something that may not be scanned."""


class ScanBusyError(RuntimeError):
    """A scan is already running."""


def _check_address(address: ipaddress.IPv4Address, text: str) -> None:
    if address.is_multicast or address.is_unspecified or address.is_reserved:
        raise ScanTargetError(f"{text}: not a unicast address")
    if not (address.is_private or address.is_loopback or address.is_link_local):
        raise ScanTargetError(f"{text}: only local network addresses can be scanned")


def parse_targets(text: str) -> list[str]:
    """Turn ``192.168.1.0/24, 10.0.0.5`` into a sorted list of addresses.

    Accepts IPv4 addresses and networks, separated by commas, semicolons or
    spaces. Raises ``ScanTargetError`` for anything else, for a public
    address, or for more than ``MAX_SCAN_HOSTS`` addresses in total.
    """
    entries = [entry for entry in _SPLIT_RE.split(text.strip()) if entry]
    if not entries:
        raise ScanTargetError("enter an address or a network such as 192.168.1.0/24")
    found: set[ipaddress.IPv4Address] = set()
    for entry in entries:
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError as exc:
            raise ScanTargetError(f"{entry}: not an IPv4 address or network") from exc
        if not isinstance(network, ipaddress.IPv4Network):
            raise ScanTargetError(f"{entry}: only IPv4 can be scanned")
        if network.num_addresses > MAX_SCAN_HOSTS * 4:
            raise ScanTargetError(f"{entry}: network too large (at most {MAX_SCAN_HOSTS} hosts)")
        hosts = list(network.hosts()) if network.prefixlen < 31 else list(network)
        for address in hosts:
            _check_address(address, entry)
            found.add(address)
            if len(found) > MAX_SCAN_HOSTS:
                raise ScanTargetError(f"too many addresses (at most {MAX_SCAN_HOSTS} per scan)")
    return [str(address) for address in sorted(found)]


def _resolve_ipv4(host: str) -> set[str]:
    try:
        infos = socket.getaddrinfo(host, None, family=socket.AF_INET)
    except OSError:
        return set()
    return {str(info[4][0]) for info in infos}


async def own_radio_addresses() -> set[str]:
    """IPv4 addresses of the radio this instance reaches over TCP, if any."""
    host = settings.tcp_host.strip()
    if not host:
        return set()
    try:
        return {str(ipaddress.IPv4Address(host))}
    except ValueError:
        pass
    return await asyncio.get_running_loop().run_in_executor(None, _resolve_ipv4, host)


def _short_text(value: Any) -> str | None:
    if not isinstance(value, bytes):
        return None
    text = value.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
    return text[:_MAX_TEXT] or None


async def probe_snmp(host: str, port: int, community: str) -> dict[str, Any] | None:
    """One SNMP GET. None when nothing answers (no agent, or a different
    community: agents stay silent then)."""
    try:
        varbinds = await snmp_get(
            host,
            port,
            community,
            SNMP_PROBE_OIDS,
            timeout=SNMP_TIMEOUT_SECONDS,
            retries=SNMP_RETRIES,
        )
    except SnmpTimeoutError:
        return None
    except SnmpResponseError as exc:
        return {"kind": "other", "error": str(exc)}
    except SnmpError:
        return None

    values: dict[str, Any] = {}
    sys_name = sys_descr = None
    for oid, value in varbinds:
        if oid == SYS_NAME:
            sys_name = _short_text(value.value) if value.tag == ber.TAG_OCTET_STRING else None
        elif oid == SYS_DESCR:
            sys_descr = _short_text(value.value) if value.tag == ber.TAG_OCTET_STRING else None
        elif (entry := BY_OID.get(oid)) is not None:
            values[entry.key] = decode_entry(entry, value)
    meshcore = any(values.get(key) is not None for key in _MESHCORE_KEYS)
    return {
        "kind": "meshcore" if meshcore else "other",
        "node_name": values.get("node_name"),
        "firmware_version": values.get("firmware_version"),
        "uptime_secs": values.get("uptime_secs"),
        "sys_name": sys_name,
        "sys_descr": sys_descr,
        "error": None,
    }


def _companion_dict(result: CompanionProbeResult) -> dict[str, Any]:
    info = result.self_info
    device = result.device_info
    return {
        "found": info is not None,
        "adv_type": info.adv_type if info else None,
        "public_key": info.public_key if info else None,
        "name": info.name if info else None,
        "lat": info.lat if info else None,
        "lon": info.lon if info else None,
        "model": device.model if device else None,
        "firmware_version": device.firmware_version if device else None,
        "build_date": device.build_date if device else None,
        "protocol_version": device.protocol_version if device else None,
        "error": result.error,
    }


@dataclass
class ScanOptions:
    snmp: bool
    snmp_port: int
    companion: bool
    companion_port: int
    webconfig: bool = False
    webconfig_port: int = 80


@dataclass
class ScanJob:
    id: str
    targets: list[str]
    options: ScanOptions
    started_at: int
    skipped: list[str]
    done: int = 0
    finished_at: int | None = None
    cancelled: bool = False
    error: str | None = None
    hosts: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def running(self) -> bool:
        return self.finished_at is None


_job: ScanJob | None = None
_task: asyncio.Task[None] | None = None


def current_job() -> ScanJob | None:
    return _job


async def _scan_host(job: ScanJob, ip: str, community: str, sem: asyncio.Semaphore) -> None:
    async with sem:
        result: dict[str, Any] = {}
        if job.options.snmp:
            snmp = await probe_snmp(ip, job.options.snmp_port, community)
            if snmp is not None:
                result["snmp"] = snmp
        if job.options.companion and ip not in job.skipped:
            companion = await probe_companion(ip, job.options.companion_port)
            if companion is not None:
                result["companion"] = _companion_dict(companion)
        if job.options.webconfig:
            webconfig = await probe_webconfig(ip, job.options.webconfig_port)
            if webconfig is not None:
                result["webconfig"] = webconfig
        if result:
            job.hosts[ip] = result
        job.done += 1


async def _run(job: ScanJob, community: str) -> None:
    sem = asyncio.Semaphore(MAX_CONCURRENT_PROBES)
    try:
        await asyncio.gather(*(_scan_host(job, ip, community, sem) for ip in job.targets))
    except asyncio.CancelledError:
        job.cancelled = True
        raise
    except Exception as exc:  # a bug, not a device: keep what was found
        logger.exception("LAN discovery scan failed")
        job.error = str(exc) or type(exc).__name__
    finally:
        job.finished_at = int(time.time())
        logger.info(
            "LAN discovery scan %s %s: %d of %d addresses, %d answered",
            job.id,
            "cancelled" if job.cancelled else "finished",
            job.done,
            len(job.targets),
            len(job.hosts),
        )


async def start_scan(
    targets_text: str,
    *,
    snmp: bool,
    snmp_port: int,
    community: str,
    companion: bool,
    companion_port: int,
    webconfig: bool = False,
    webconfig_port: int = 80,
) -> ScanJob:
    """Start a scan in the background and return its job at once."""
    global _job, _task
    if _job is not None and _job.running:
        raise ScanBusyError("a scan is already running")
    if not snmp and not companion and not webconfig:
        raise ScanTargetError("choose at least one check")
    targets = parse_targets(targets_text)
    skipped = sorted((await own_radio_addresses()) & set(targets)) if companion else []
    job = ScanJob(
        id=uuid.uuid4().hex[:12],
        targets=targets,
        options=ScanOptions(snmp, snmp_port, companion, companion_port, webconfig, webconfig_port),
        started_at=int(time.time()),
        skipped=skipped,
    )
    _job = job
    _task = asyncio.create_task(_run(job, community))
    logger.info(
        "LAN discovery scan %s started: %d addresses, snmp=%s companion=%s webconfig=%s",
        job.id,
        len(targets),
        snmp,
        companion,
        webconfig,
    )
    return job


async def cancel_scan() -> bool:
    """Stop the running scan. Results found so far stay. False when idle."""
    task = _task
    if _job is None or not _job.running or task is None:
        return False
    job = _job
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    # A task cancelled before its first step never runs ``_run``'s finally.
    if job.finished_at is None:
        job.cancelled = True
        job.finished_at = int(time.time())
    return True


def reset_for_tests() -> None:
    global _job, _task
    _job = None
    _task = None
