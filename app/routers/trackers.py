import time
from typing import Annotated

from fastapi import APIRouter, Query

from app.models import TrackerSource, TrackersResponse
from app.repository.trackers import TrackerRepository
from app.services.trackers import tracker_counts

router = APIRouter(prefix="/trackers", tags=["trackers"])

# Most positions returned per request (newest first).
POSITION_LIMIT = 5000


@router.get("", response_model=TrackersResponse)
async def list_trackers(
    since: int | None = Query(default=None, description="Only fixes received after this Unix time"),
    until: int | None = Query(
        default=None, description="Only fixes received at or before this Unix time"
    ),
    latest_per_identity: bool = Query(
        default=True, description="Keep only the newest fix per tracker; off for trails"
    ),
    source: Annotated[TrackerSource | None, Query(description="atak or sar_fast_gps")] = None,
    identity: str | None = Query(
        default=None, description="Only this tracker (callsign or SAR key prefix, any case)"
    ),
) -> TrackersResponse:
    """ATAK users (TAK-MESHCORE) and MeshCore SAR fast-GPS fixes, plus ATAK map objects.

    For the local map only; never forwarded to fanout, MQTT or exports.
    Objects past their CoT stale time are left out.
    """
    positions = await TrackerRepository.positions(
        since, until, latest_per_identity, source, POSITION_LIMIT + 1, identity=identity
    )
    objects = await TrackerRepository.objects(since, until, False, int(time.time()))
    return TrackersResponse(
        positions=positions[:POSITION_LIMIT],
        objects=objects,
        truncated=len(positions) > POSITION_LIMIT,
        counts=tracker_counts(),
    )
