"""Fetch and normalize LoRa region presets from the official MeshCore API.

The upstream (api.meshcore.nz) returns presets under
``config.suggested_radio_settings`` with every field as a string. This module
turns that into RTFM-EV's numeric ``RadioPresetEntry`` shape. Entries whose
numeric fields cannot be parsed are dropped rather than failing the whole sync,
mirroring how the community analyzer tolerates a partially malformed payload.
"""

from __future__ import annotations

import logging

import httpx

from app.models import RadioPresetEntry

logger = logging.getLogger(__name__)

# The official community presets endpoint (same source the cornmeister analyzer
# proxies). Kept as a module constant so routes and tests share one definition.
OFFICIAL_PRESETS_URL = "https://api.meshcore.nz/api/v1/config"

_HTTP_TIMEOUT = httpx.Timeout(10.0)


def _normalize_entry(raw: dict) -> RadioPresetEntry | None:
    """Convert one upstream entry to a numeric preset, or None if unparseable."""
    name = str(raw.get("title", "")).strip()
    if not name:
        return None
    try:
        return RadioPresetEntry(
            name=name,
            freq=float(raw["frequency"]),
            bw=float(raw["bandwidth"]),
            sf=int(raw["spreading_factor"]),
            cr=int(raw["coding_rate"]),
        )
    except (KeyError, TypeError, ValueError):
        logger.warning("Skipping unparseable radio preset entry: %r", raw.get("title"))
        return None


def normalize_upstream(data: dict) -> tuple[list[RadioPresetEntry], str]:
    """Extract (entries, info_message) from the api.meshcore.nz payload.

    Pure function: no network. Missing sections yield an empty list and an
    empty info message rather than raising.
    """
    block = (data.get("config") or {}).get("suggested_radio_settings") or {}
    info_message = str(block.get("info_message") or "")
    raw_entries = block.get("entries") or []

    entries: list[RadioPresetEntry] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            continue
        entry = _normalize_entry(raw)
        if entry is not None:
            entries.append(entry)
    return entries, info_message


async def fetch_official_presets(
    *, url: str = OFFICIAL_PRESETS_URL, client: httpx.AsyncClient | None = None
) -> tuple[list[RadioPresetEntry], str]:
    """GET the upstream config and normalize it.

    Raises ``httpx.HTTPStatusError`` on a non-2xx response and
    ``httpx.RequestError`` on a transport failure — the caller decides how to
    surface those. A ``client`` may be injected for testing; otherwise a
    short-lived one is created and closed here.
    """
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    finally:
        if owns_client:
            await client.aclose()
    return normalize_upstream(data)
