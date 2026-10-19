"""External node sync for the map overlay ("Analyzer nodes").

Fetches a node directory from one of two sources, normalises it, and caches
located nodes locally so the map can overlay nodes RTFM-EV has not heard itself:

- ``meshcore_map`` (default): the MeshCore map, ``map.meshcore.io``
  ``/api/v1/nodes``. A bare JSON array of objects with snake_case keys
  (``public_key``, ``type``, ``adv_name``, ``adv_lat``, ``adv_lon``,
  ``updated_date``, ...); ``type`` is the MeshCore advert type (1 companion,
  2 repeater, 3 room server, 4 sensor). Worldwide, ~50 MB uncompressed.
- ``analyzer``: a MeshCore Analyzer ``/api/nodes`` feed at
  ``external_map_sync_url`` (default: the EU analyzer). A bare JSON array with
  PascalCase keys (``ID``, ``Name``, ``Role``, ``Lat``, ``Lon``, ``LastSeen``,
  ``AdvertCount``, ``Mobile``); ``Lat``/``Lon`` may be null.

Both feeds are several MB and not meant for the browser, so the fetch happens
server-side.
"""

import asyncio
import logging
from datetime import UTC, datetime

import httpx

from app.models import ExternalMapNode
from app.repository.external_map import ExternalMapRepository
from app.repository.settings import AppSettingsRepository
from app.version_info import user_agent

logger = logging.getLogger(__name__)

DEFAULT_EXTERNAL_MAP_URL = "https://meshcore-analyzer.eu/api/nodes"
MESHCORE_MAP_NODES_URL = "https://map.meshcore.io/api/v1/nodes"
SOURCE_MESHCORE_MAP = "meshcore_map"
SOURCE_ANALYZER = "analyzer"
EXTERNAL_MAP_SOURCES = (SOURCE_MESHCORE_MAP, SOURCE_ANALYZER)
DEFAULT_EXTERNAL_MAP_SOURCE = SOURCE_MESHCORE_MAP
# Cap parsed entries so a runaway feed cannot exhaust memory (mirrors the
# wordlist-sync guard). On 2026-10-19 map.meshcore.io listed ~67k nodes and the
# EU analyzer ~86k entries (fewer of them located).
MAX_EXTERNAL_NODES = 200_000
_FETCH_TIMEOUT = 30.0
_INITIAL_DELAY = 20.0
# MeshCore advert type -> the role strings the analyzer feed uses, so both
# sources read the same downstream (map popup, partial-resolution promotion).
_MESHCORE_MAP_ROLES = {1: "Companion", 2: "Repeater", 3: "Roomserver", 4: "Sensor"}

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


def _coords(lat: object, lon: object) -> tuple[float, float] | None:
    """Return ``(lat, lon)`` as floats, or None when missing or invalid."""
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    # Reject the null island / out-of-range coordinates.
    if lat == 0 and lon == 0:
        return None
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        return None
    return float(lat), float(lon)


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
        if not isinstance(pubkey, str) or not pubkey:
            continue
        coords = _coords(item.get("Lat"), item.get("Lon"))
        if coords is None:
            continue
        name = item.get("Name")
        role = item.get("Role")
        advert = item.get("AdvertCount")
        nodes.append(
            ExternalMapNode(
                pubkey=pubkey.lower(),
                name=name if isinstance(name, str) else "",
                role=role if isinstance(role, str) else "",
                lat=coords[0],
                lon=coords[1],
                last_seen=_parse_last_seen(item.get("LastSeen")),
                advert_count=advert if isinstance(advert, int) else 0,
                mobile=bool(item.get("Mobile")),
            )
        )
    return nodes


def _parse_meshcore_map_nodes(payload: object) -> list[ExternalMapNode]:
    """Normalise the map.meshcore.io ``/api/v1/nodes`` array.

    Same rules as :func:`_parse_nodes`. The feed has no advert count or mobile
    flag, so those keep their defaults.
    """
    if not isinstance(payload, list):
        raise ExternalMapSyncError("Sync source returned unexpected format (expected array)")

    nodes: list[ExternalMapNode] = []
    for item in payload[:MAX_EXTERNAL_NODES]:
        if not isinstance(item, dict):
            continue
        pubkey = item.get("public_key")
        if not isinstance(pubkey, str) or not pubkey:
            continue
        coords = _coords(item.get("adv_lat"), item.get("adv_lon"))
        if coords is None:
            continue
        name = item.get("adv_name")
        node_type = item.get("type")
        role = _MESHCORE_MAP_ROLES.get(node_type, "Unknown") if isinstance(node_type, int) else ""
        nodes.append(
            ExternalMapNode(
                pubkey=pubkey.lower(),
                name=name if isinstance(name, str) else "",
                role=role,
                lat=coords[0],
                lon=coords[1],
                # updated_date is the map server's clock; last_advert is the
                # node's own and was years in the future for ~3k nodes.
                last_seen=_parse_last_seen(item.get("updated_date")),
            )
        )
    return nodes


async def sync_external_map(
    url: str | None = None, source: str = DEFAULT_EXTERNAL_MAP_SOURCE
) -> tuple[int, int]:
    """Fetch, parse, and cache the external node directory.

    ``source`` picks the feed: ``meshcore_map`` fetches map.meshcore.io and
    ignores ``url``; ``analyzer`` fetches ``url`` (or the EU analyzer default).
    Returns ``(node_count, synced_at_epoch)``. Raises ExternalMapSyncError on a
    transport error, non-200 response, or unparseable body. Serialised so a
    manual sync and the periodic loop cannot overlap.
    """
    if source == SOURCE_ANALYZER:
        target = (url or "").strip() or DEFAULT_EXTERNAL_MAP_URL
        parse = _parse_nodes
        # Analyzer requests keep the httpx default User-Agent (unchanged).
        headers: dict[str, str] = {}
    else:
        target = MESHCORE_MAP_NODES_URL
        parse = _parse_meshcore_map_nodes
        headers = {"User-Agent": user_agent()}
    async with _sync_lock:
        try:
            async with httpx.AsyncClient(
                timeout=_FETCH_TIMEOUT, follow_redirects=True, headers=headers
            ) as client:
                response = await client.get(target)
        except httpx.HTTPError as exc:
            logger.warning("External-map sync fetch failed for %s: %s", target, exc)
            raise ExternalMapSyncError(f"Could not reach sync URL: {exc}") from exc

        if response.status_code != 200:
            raise ExternalMapSyncError(f"Sync source returned HTTP {response.status_code}")

        try:
            # Off the event loop: map.meshcore.io is ~50 MB of JSON (seconds of
            # CPU), which would otherwise stall radio and WebSocket work.
            payload = await asyncio.to_thread(response.json)
        except Exception as exc:
            raise ExternalMapSyncError("Sync source returned unexpected format (not JSON)") from exc

        nodes = parse(payload)
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
        await sync_external_map(settings.external_map_sync_url, settings.external_map_source)
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
