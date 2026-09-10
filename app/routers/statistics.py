import time

from fastapi import APIRouter, Query

from app.models import StatisticsResponse
from app.repository import StatisticsRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.services.radio_stats import get_battery_history, get_noise_floor_history

router = APIRouter(prefix="/statistics", tags=["statistics"])


@router.get("", response_model=StatisticsResponse)
async def get_statistics() -> StatisticsResponse:
    data = await StatisticsRepository.get_all()
    data["noise_floor_24h"] = get_noise_floor_history()
    return StatisticsResponse(**data)


@router.get("/battery")
async def get_battery_history_endpoint() -> dict:
    """Return 24h battery history: in-memory samples merged with DB records.

    The DB is the authoritative long-term store; in-memory samples fill any
    gap at the tail (e.g. between the last persisted write and now).
    """
    in_memory = get_battery_history()
    now = int(time.time())
    cutoff = now - 24 * 3600
    db_samples = await BatteryHistoryRepository.get_range(cutoff, now)
    seen_ts = {s["timestamp"] for s in db_samples}
    merged = db_samples + [s for s in in_memory["samples"] if s["timestamp"] not in seen_ts]
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
) -> list[dict]:
    return await BatteryHistoryRepository.get_range(start_ts, end_ts)


@router.get("/noise-floor")
async def get_noise_floor_range(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
) -> list[dict]:
    return await NoiseFloorRepository.get_range(start_ts, end_ts)
