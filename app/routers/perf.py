"""Performance page: what the backend process is doing, live and over time."""

from typing import Literal

from fastapi import APIRouter

from app.perf.sampler import sampler
from app.perf.snapshot import build_snapshot

router = APIRouter(prefix="/perf", tags=["perf"])

HistoryRange = Literal["live", "15m", "1h", "6h", "24h", "7d", "30d"]


@router.get("/snapshot")
async def get_snapshot() -> dict:
    """Everything the page shows right now: process, event loop, background
    loops, packet pipeline, database, radio link, outputs, API routes, recent
    warnings, and the overall health with its reasons."""
    return await build_snapshot()


@router.get("/history")
async def get_history(range: HistoryRange = "1h") -> dict:
    """Chart points for a range: 10-second points from memory up to an hour,
    stored one-minute rows (bucketed to at most 720 points) for longer ranges."""
    return await sampler.history(range)
