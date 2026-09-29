import logging
import math
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.fanout.manager import fanout_manager
from app.models import StatisticsResponse
from app.repository import StatisticsRepository
from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.repository.radio_identities import (
    RadioIdentityNotFound,
    RadioIdentityRepository,
    StatScope,
)
from app.repository.settings import AppSettingsRepository
from app.services.airtime_util import compute_airtime_utilization, map_openhop_airtime_buckets
from app.services.openhop import is_openhop
from app.services.openhop_api import OpenHopClient
from app.services.radio_identity import resolve_stat_scope
from app.services.radio_runtime import radio_runtime as radio_manager
from app.services.radio_stats import (
    STATS_SAMPLE_INTERVAL_SECONDS,
    get_battery_history,
    get_noise_floor_history,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/statistics", tags=["statistics"])

# Annotated so the Python defaults stay None / False when a handler is called directly.
RadioIdParam = Annotated[
    int | None,
    Query(
        description="Radio identity id (plan 18). Default: the active radio plus the radios "
        "it inherits stats from"
    ),
]
UnassignedParam = Annotated[
    bool, Query(description="Only samples recorded before radio tracking (no radio attached)")
]


async def _scope(radio_id: int | None, unassigned: bool) -> StatScope:
    try:
        return await resolve_stat_scope(radio_id, unassigned)
    except RadioIdentityNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


async def _includes_active_radio(scope: StatScope) -> bool:
    """Whether in-memory samples (always the connected radio's) belong in this read."""
    if scope.unassigned:
        return False
    if not scope.ids:
        return True
    active = await RadioIdentityRepository.get_active()
    return active is not None and active.id in scope.ids


@router.get("", response_model=StatisticsResponse)
async def get_statistics() -> StatisticsResponse:
    data = await StatisticsRepository.get_all()
    data["noise_floor_24h"] = get_noise_floor_history()
    data["mqtt_brokers"] = fanout_manager.get_mqtt_stats()
    return StatisticsResponse(**data)


@router.get("/battery")
async def get_battery_history_endpoint(
    radio_id: RadioIdParam = None, unassigned: UnassignedParam = False
) -> dict:
    """Return 24h battery history: in-memory samples merged with DB records.

    The DB is the authoritative long-term store; in-memory samples fill any
    gap at the tail (e.g. between the last persisted write and now). They
    belong to the connected radio, so they are only merged when the read
    covers it.
    """
    scope = await _scope(radio_id, unassigned)
    in_memory = get_battery_history()
    now = int(time.time())
    cutoff = now - 24 * 3600
    db_samples = await BatteryHistoryRepository.get_range(cutoff, now, scope)
    seen_ts = {s["timestamp"] for s in db_samples}
    memory_samples = in_memory["samples"] if await _includes_active_radio(scope) else []
    merged = db_samples + [s for s in memory_samples if s["timestamp"] not in seen_ts]
    merged.sort(key=lambda s: s["timestamp"])
    latest = merged[-1] if merged else None
    oldest_ts = merged[0]["timestamp"] if merged else None
    return {
        "sample_interval_seconds": in_memory["sample_interval_seconds"],
        "coverage_seconds": 0 if oldest_ts is None else max(0, now - oldest_ts),
        "latest_battery_mv": latest["battery_mv"] if latest else None,
        "latest_timestamp": latest["timestamp"] if latest else None,
        "samples": merged,
    }


@router.get("/battery/range")
async def get_battery_range(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
    radio_id: RadioIdParam = None,
    unassigned: UnassignedParam = False,
) -> list[dict]:
    return await BatteryHistoryRepository.get_range(
        start_ts, end_ts, await _scope(radio_id, unassigned)
    )


@router.get("/noise-floor")
async def get_noise_floor_range(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
    radio_id: RadioIdParam = None,
    unassigned: UnassignedParam = False,
) -> list[dict]:
    return await NoiseFloorRepository.get_range(
        start_ts, end_ts, await _scope(radio_id, unassigned)
    )


async def _openhop_airtime_range(start_ts: int, end_ts: int, bin_count: int) -> list[dict] | None:
    """Fetch TX/RX airtime from OpenHop's REST API, or None to fall back.

    OpenHop's companion STATS_RADIO frame hardcodes rx_air_secs=0, so the local
    cumulative-counter path never sees RX airtime. When the connected node is an
    OpenHop node with the API configured, OpenHop's /api/airtime_chart_data does
    report real RX airtime (derived per-packet from its DB). Returns None (silent
    fall back to the local computation) when not OpenHop, not configured, radio
    params are unknown, or the call fails.
    """
    if not is_openhop(getattr(radio_manager, "device_model", None)):
        return None
    settings = await AppSettingsRepository.get()
    if not (settings.openhop_api_url and settings.openhop_api_token):
        return None

    mc = radio_manager.meshcore
    info = mc.self_info if mc else None
    if not info:
        return None
    sf = int(info.get("radio_sf") or 0)
    bw_khz = float(info.get("radio_bw") or 0)
    cr = int(info.get("radio_cr") or 0)
    if not (sf and bw_khz and cr):
        return None

    bucket_seconds = max(10, min(3600, (end_ts - start_ts) // max(1, bin_count)))
    client = OpenHopClient(settings.openhop_api_url, settings.openhop_api_token)
    try:
        resp = await client.airtime_chart_data(
            start_ts,
            end_ts,
            bucket_seconds=bucket_seconds,
            sf=sf,
            bw_hz=int(bw_khz * 1000),
            cr=cr,
        )
        crc_history = await _openhop_crc_history(client, start_ts, end_ts)
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("OpenHop airtime fetch failed, falling back to local: %s", exc)
        return None
    finally:
        await client.aclose()

    return map_openhop_airtime_buckets(resp.get("data") or {}, crc_history)


# OpenHop polls its radio CRC counter every 30 s (engine NOISE_FLOOR_INTERVAL)
# and stores at most one row per poll, so 120 rows/hour bounds the history.
OPENHOP_CRC_ROWS_PER_HOUR = 120


async def _openhop_crc_history(
    client: OpenHopClient, start_ts: int, end_ts: int
) -> list[dict] | None:
    """Radio CRC error rows in [start_ts, end_ts] from OpenHop, or None on failure.

    The companion STATS_PACKETS ``recv_errors`` slot on OpenHop carries its
    repeater dropped-packet count, so real receive errors only come from this
    endpoint. It takes a window in hours back from now, so ask for enough hours
    to reach ``start_ts`` and trim to the requested range here.
    """
    hours = max(1, math.ceil((time.time() - start_ts) / 3600))
    try:
        resp = await client.crc_error_history(
            hours, limit=hours * OPENHOP_CRC_ROWS_PER_HOUR + OPENHOP_CRC_ROWS_PER_HOUR
        )
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("OpenHop CRC error fetch failed, omitting rx_errors: %s", exc)
        return None
    if not resp.get("success"):
        return None
    history = (resp.get("data") or {}).get("history") or []
    return [
        row
        for row in history
        if isinstance(row.get("timestamp"), int | float) and start_ts <= row["timestamp"] <= end_ts
    ]


@router.get("/airtime/range")
async def get_airtime_range(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
    bin_count: int = Query(40, ge=1, le=500, description="Number of output bins"),
    radio_id: RadioIdParam = None,
    unassigned: UnassignedParam = False,
) -> list[dict]:
    """Return per-bin TX/RX airtime utilization % over the range.

    On OpenHop nodes (which hardcode rx_air_secs=0 in the companion frame) with
    the OpenHop API configured, data comes from OpenHop's REST endpoint, which
    reports real RX airtime, and ``rx_errors`` comes from OpenHop's radio CRC
    error history (omitted if that call fails). Otherwise utilization is derived from deltas between
    cumulative airtime samples, so the response is empty until at least two
    samples exist in the window. ``radio_id`` / ``unassigned`` pick whose samples
    (plan 18); the OpenHop branch only serves the default (the connected radio).
    """
    scope = await _scope(radio_id, unassigned)
    if radio_id is None and not unassigned:
        openhop = await _openhop_airtime_range(start_ts, end_ts, bin_count)
        if openhop is not None:
            return openhop

    samples = await AirtimeHistoryRepository.get_range(start_ts, end_ts, scope)
    return compute_airtime_utilization(
        samples, start_ts, end_ts, bin_count, STATS_SAMPLE_INTERVAL_SECONDS
    )
