import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models import ExternalMapNode
from app.repository.external_map import ExternalMapRepository
from app.repository.settings import AppSettingsRepository
from app.services.external_map import ExternalMapSyncError, sync_external_map

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/external-map", tags=["external-map"])


class ExternalMapSyncResponse(BaseModel):
    count: int
    synced_at: int


class ExternalMapStatus(BaseModel):
    enabled: bool
    count: int
    last_synced_at: int | None
    interval_hours: int


@router.post("/sync", response_model=ExternalMapSyncResponse)
async def trigger_sync() -> ExternalMapSyncResponse:
    """Manually fetch the configured external analyzer node directory.

    Runs regardless of the enable toggle (it is an explicit user action); the
    toggle governs the map overlay and the periodic background sync.
    """
    settings = await AppSettingsRepository.get()
    try:
        count, synced_at = await sync_external_map(settings.external_map_sync_url)
    except ExternalMapSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ExternalMapSyncResponse(count=count, synced_at=synced_at)


@router.get("/status", response_model=ExternalMapStatus)
async def get_status() -> ExternalMapStatus:
    settings = await AppSettingsRepository.get()
    count, last_synced_at = await ExternalMapRepository.status()
    return ExternalMapStatus(
        enabled=settings.external_map_enabled,
        count=count,
        last_synced_at=last_synced_at,
        interval_hours=settings.external_map_sync_interval_hours,
    )


@router.get("/nodes", response_model=list[ExternalMapNode])
async def get_nodes(
    west: float = Query(..., ge=-180.0, le=180.0),
    south: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    limit: int = Query(2000, ge=1, le=5000),
) -> list[ExternalMapNode]:
    """Return cached external nodes inside a lat/lon bounding box (viewport)."""
    return await ExternalMapRepository.query_bbox(
        min_lat=min(south, north),
        min_lon=min(west, east),
        max_lat=max(south, north),
        max_lon=max(west, east),
        limit=limit,
    )
