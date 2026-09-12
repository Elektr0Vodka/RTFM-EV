"""External analyzer node sync for the map overlay.

Fetches a node directory from an external analyzer (default: the EU MeshCore
Analyzer ``/api/nodes`` feed), normalises it, and caches located nodes locally
so the map can overlay nodes RTFM-EV has not heard itself.

The feed is a bare JSON array of objects with PascalCase keys (``ID``, ``Name``,
``Role``, ``Lat``, ``Lon``, ``LastSeen``, ``AdvertCount``, ``Mobile``); ``Lat``/
``Lon`` may be null. It has no CORS header and is several MB, so the fetch must
happen server-side (never from the browser).
"""

import asyncio
import logging
from datetime import UTC, datetime

import httpx

from app.models import ExternalMapNode
from app.repository.external_map import ExternalMapRepository
from app.repository.settings import AppSettingsRepository

logger = logging.getLogger(__name__)

DEFAULT_EXTERNAL_MAP_URL = "https://meshcore-analyzer.eu/api/nodes"
# Cap parsed entries so a runaway feed cannot exhaust memory (mirrors the
# wordlist-sync guard). The EU feed is ~9k nodes today.
MAX_EXTERNAL_NODES = 50_000
_FETCH_TIMEOUT = 30.0
_INITIAL_DELAY = 20.0

_sync_task: asyncio.Task | None = None
_sync_lock = asyncio.Lock()


class ExternalMapSyncError(Exception):
    """Raised when an external-map sync cannot complete."""


def _parse_last_seen(value: object) -> int | None:
    """Parse an RFC3339 timestamp string into epoch seconds, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        # Python's fromisoformat accepts offsets; normalise a trailing Z.
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except (ValueError, TypeError):
        return None


def _parse_nodes(payload: object) -> list[ExternalMapNode]:
    """Normalise the analyzer array into located ExternalMapNode records.

    Nodes without a valid lat/lon are dropped (the overlay is map-only). Unknown
    or malformed entries are skipped rather than failing the whole sync.
    """
    if not isinstance(payload, list):
        raise ExternalMapSyncError("Sync source returned unexpected format (expected array)")

    nodes: list[ExternalMapNode] = []
    for item in payload[:MAX_EXTERNAL_NODES]:
        if not isinstance(item, dict):
            continue
        pubkey = item.get("ID")
        lat = item.get("Lat")
        lon = item.get("Lon")
        if not isinstance(pubkey, str) or not pubkey:
            continue
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        # Reject the null island / out-of-range coordinates.
        if lat == 0 and lon == 0:
            continue
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
            continue
        name = item.get("Name")
        role = item.get("Role")
        advert = item.get("AdvertCount")
        nodes.append(
            ExternalMapNode(
                pubkey=pubkey.lower(),
                name=name if isinstance(name, str) else "",
                role=role if isinstance(role, str) else "",
                lat=float(lat),
                lon=float(lon),
                last_seen=_parse_last_seen(item.get("LastSeen")),
                advert_count=advert if isinstance(advert, int) else 0,
                mobile=bool(item.get("Mobile")),
            )
        )
    return nodes


async def sync_external_map(url: str | None = None) -> tuple[int, int]:
    """Fetch, parse, and cache the external node directory.

    Returns ``(node_count, synced_at_epoch)``. Raises ExternalMapSyncError on a
    transport error, non-200 response, or unparseable body. Serialised so a
    manual sync and the periodic loop cannot overlap.
    """
    target = (url or "").strip() or DEFAULT_EXTERNAL_MAP_URL
    async with _sync_lock:
        try:
            async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
                response = await client.get(target)
        except httpx.HTTPError as exc:
            logger.warning("External-map sync fetch failed for %s: %s", target, exc)
            raise ExternalMapSyncError(f"Could not reach sync URL: {exc}") from exc

        if response.status_code != 200:
            raise ExternalMapSyncError(f"Sync source returned HTTP {response.status_code}")

        try:
            payload = response.json()
        except Exception as exc:
            raise ExternalMapSyncError("Sync source returned unexpected format (not JSON)") from exc

        nodes = _parse_nodes(payload)
        synced_at = int(datetime.now(UTC).timestamp())
        count = await ExternalMapRepository.replace_all(nodes, source=target, synced_at=synced_at)
        logger.info("External-map sync stored %d located nodes from %s", count, target)
        return count, synced_at


async def _run_periodic_cycle(now: datetime) -> None:
    """Sync if enabled and this hour aligns with the configured interval."""
    settings = await AppSettingsRepository.get()
    interval = settings.external_map_sync_interval_hours
    if not settings.external_map_enabled or interval <= 0:
        return
    if now.hour % interval != 0:
        return
    try:
        await sync_external_map(settings.external_map_sync_url)
    except ExternalMapSyncError as exc:
        logger.warning("Scheduled external-map sync failed: %s", exc)


async def _sleep_until_next_utc_top_of_hour() -> None:
    now = datetime.now(UTC)
    seconds_into_hour = now.minute * 60 + now.second
    await asyncio.sleep(max(1, 3600 - seconds_into_hour))


async def _sync_loop() -> None:
    try:
        await asyncio.sleep(_INITIAL_DELAY)
    except asyncio.CancelledError:
        return
    while True:
        try:
            await _sleep_until_next_utc_top_of_hour()
            await _run_periodic_cycle(datetime.now(UTC))
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Error in external-map sync loop: %s", exc, exc_info=True)


def start_external_map_sync() -> None:
    """Start the background external-map sync loop (idempotent)."""
    global _sync_task
    if _sync_task is None or _sync_task.done():
        _sync_task = asyncio.create_task(_sync_loop())


async def stop_external_map_sync() -> None:
    """Cancel the background external-map sync loop."""
    global _sync_task
    if _sync_task and not _sync_task.done():
        _sync_task.cancel()
        try:
            await _sync_task
        except asyncio.CancelledError:
            pass
        _sync_task = None
