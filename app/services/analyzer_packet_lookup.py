"""Ask an external analyzer which of its observers heard a packet.

One read-only endpoint of the EU MeshCore Analyzer software is used, on the host
of the configured external map sync URL (``external_map_sync_url``):

- ``GET /api/packets/{hash}``: the stored packet with an ``observations`` list,
  one entry per reception by an MQTT observer (``observer_id``,
  ``observer_name``, ``observer_iata``, ``heard_at``, ``rssi``, ``snr``). 404
  when the analyzer never saw the packet.

``{hash}`` is the firmware's packet hash (``calculate_packet_hash``, lower
case), which leaves the path out, so every relayed copy of one packet shares it.
Compared on 2026-10-10 against 200 packets of meshcore-analyzer.eu: its ``hash``
equalled ours for all of them.

This sends the packet hash to that host, so it only runs when the user asks for
it. The analyzer sees what its observers hear; an empty answer is not proof that
nobody heard the packet.

The idea comes from the ``wchaney817/Remote-Terminal-for-MeshCore`` fork
(``37b82ce1``), which asks a CoreScope instance in North Texas.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from app.services.analyzer_path_check import AnalyzerCheckError

logger = logging.getLogger(__name__)

FETCH_TIMEOUT_SECONDS = 10.0
# A busy flood is heard a few hundred times; cap what is passed on to the browser.
MAX_OBSERVATIONS = 500


@dataclass(frozen=True)
class PacketObservation:
    observer_id: str | None
    observer_name: str | None
    region: str | None
    heard_at: float | None
    rssi: int | None
    snr: float | None


@dataclass(frozen=True)
class PacketObservations:
    found: bool
    observation_count: int = 0
    observer_count: int = 0
    truncated: bool = False
    observations: list[PacketObservation] = field(default_factory=list)


def _text(value: object) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _epoch(value: object) -> float | None:
    """Epoch seconds of an ISO 8601 time such as ``2026-10-10T20:58:28.636Z``."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def parse_packet_observations(payload: object) -> PacketObservations:
    """Turn a ``/api/packets/{hash}`` answer into observations, oldest first.

    Entries that are not objects are skipped. Entries without a time go last.
    ``observation_count`` is the analyzer's own count when it gives one, since
    the list may be shorter than what it has stored.
    """
    if not isinstance(payload, dict):
        return PacketObservations(found=False)

    raw = payload.get("observations")
    entries = [entry for entry in raw if isinstance(entry, dict)] if isinstance(raw, list) else []
    observations: list[PacketObservation] = []
    for entry in entries:
        rssi = _number(entry.get("rssi"))
        observations.append(
            PacketObservation(
                observer_id=_text(entry.get("observer_id")),
                observer_name=_text(entry.get("observer_name")),
                region=_text(entry.get("observer_iata")),
                heard_at=_epoch(entry.get("heard_at")),
                rssi=round(rssi) if rssi is not None else None,
                snr=_number(entry.get("snr")),
            )
        )
    observations.sort(key=lambda o: (o.heard_at is None, o.heard_at or 0.0))

    reported = payload.get("observation_count")
    total = (
        reported
        if isinstance(reported, int) and not isinstance(reported, bool)
        else len(observations)
    )
    observers = {o.observer_id or o.observer_name for o in observations}
    observers.discard(None)
    return PacketObservations(
        found=True,
        observation_count=max(total, len(observations)),
        observer_count=len(observers),
        truncated=len(observations) > MAX_OBSERVATIONS,
        observations=observations[:MAX_OBSERVATIONS],
    )


async def fetch_packet_observations(base_url: str, packet_hash: str) -> PacketObservations:
    """Ask the analyzer at ``base_url`` about one packet hash.

    Raises ``AnalyzerCheckError`` when it cannot be reached or answers unusably.
    A 404 is an answer: the analyzer does not know the packet.
    """
    url = f"{base_url}/api/packets/{packet_hash.lower()}"
    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        raise AnalyzerCheckError(f"Could not reach analyzer: {exc}") from exc
    if response.status_code == 404:
        return PacketObservations(found=False)
    if response.status_code != 200:
        raise AnalyzerCheckError(f"Analyzer returned HTTP {response.status_code}")
    try:
        payload: Any = response.json()
    except ValueError as exc:
        raise AnalyzerCheckError("Analyzer returned unexpected format (not JSON)") from exc
    if not isinstance(payload, dict):
        raise AnalyzerCheckError("Analyzer returned unexpected format (expected object)")
    return parse_packet_observations(payload)
