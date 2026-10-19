import json

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.models import AntennaRegisterSite, AntennaRegisterSiteSummary
from app.repository.antenna_register import AntennaRegisterRepository
from app.services.antenna_register import get_sync_state, start_antenna_register_sync

router = APIRouter(prefix="/antenna-register", tags=["antenna-register"])

# Encoded /sites/all body, rebuilt only when the cache changed (count + last sync).
_all_sites_body: tuple[tuple[int, int | None], bytes] | None = None
ALL_SITES_FIELDS = ["id", "lat", "lon", "bands", "max_power_dbw", "max_height_m"]


class AntennaRegisterStatus(BaseModel):
    count: int
    last_synced_at: int | None
    running: bool
    phase: str | None
    fetched: int
    error: str | None


class AntennaRegisterSites(BaseModel):
    sites: list[AntennaRegisterSiteSummary]
    truncated: bool


class AntennaRegisterFullSites(BaseModel):
    sites: list[AntennaRegisterSite]
    truncated: bool


async def _status() -> AntennaRegisterStatus:
    count, last_synced_at = await AntennaRegisterRepository.status()
    state = get_sync_state()
    return AntennaRegisterStatus(
        count=count,
        last_synced_at=last_synced_at,
        running=state.running,
        phase=state.phase,
        fetched=state.fetched,
        error=state.error,
    )


@router.post("/sync", response_model=AntennaRegisterStatus, status_code=202)
async def trigger_sync() -> AntennaRegisterStatus:
    """Start a background sync from the public Antenneregister WFS.

    Returns at once; poll ``GET /status`` until ``running`` is false. A second
    call while a sync runs is a no-op that returns the current status.
    """
    start_antenna_register_sync()
    return await _status()


@router.get("/status", response_model=AntennaRegisterStatus)
async def get_status() -> AntennaRegisterStatus:
    return await _status()


@router.get("/sites", response_model=AntennaRegisterSites)
async def get_sites(
    west: float = Query(..., ge=-180.0, le=180.0),
    south: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    limit: int = Query(5000, ge=1, le=50000),
) -> AntennaRegisterSites:
    """Cached antenna sites inside a lat/lon box (the map viewport)."""
    sites, truncated = await AntennaRegisterRepository.query_bbox(
        min_lat=min(south, north),
        min_lon=min(west, east),
        max_lat=max(south, north),
        max_lon=max(west, east),
        limit=limit,
    )
    return AntennaRegisterSites(sites=sites, truncated=truncated)


def reset_all_sites_cache() -> None:
    """Drop the encoded /sites/all body (tests use separate databases)."""
    global _all_sites_body
    _all_sites_body = None


@router.get("/sites/all")
async def get_all_sites() -> Response:
    """Every cached site in one compact body for the map layer.

    ``{"synced_at": int | null, "fields": [...], "rows": [[id, lat, lon, bands,
    max_power_dbw, max_height_m], ...]}`` with ``bands`` comma-separated. The
    encoded body is kept in memory until the next sync, so repeat loads cost a
    status query.
    """
    global _all_sites_body
    count, synced_at = await AntennaRegisterRepository.status()
    if _all_sites_body is None or _all_sites_body[0] != (count, synced_at):
        rows = await AntennaRegisterRepository.all_compact()
        body = json.dumps(
            {"synced_at": synced_at, "fields": ALL_SITES_FIELDS, "rows": rows},
            separators=(",", ":"),
        ).encode()
        _all_sites_body = ((count, synced_at), body)
    return Response(content=_all_sites_body[1], media_type="application/json")


@router.get("/sites/full", response_model=AntennaRegisterFullSites)
async def get_full_sites(
    west: float = Query(..., ge=-180.0, le=180.0),
    south: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    limit: int = Query(2000, ge=1, le=5000),
) -> AntennaRegisterFullSites:
    """Cached sites with all transmitters inside a lat/lon box. The map uses it
    for radiation patterns once zoomed in, so the box stays small."""
    sites, truncated = await AntennaRegisterRepository.query_bbox_full(
        min_lat=min(south, north),
        min_lon=min(west, east),
        max_lat=max(south, north),
        max_lon=max(west, east),
        limit=limit,
    )
    return AntennaRegisterFullSites(sites=sites, truncated=truncated)


@router.get("/sites/{site_id}", response_model=AntennaRegisterSite)
async def get_site(site_id: int) -> AntennaRegisterSite:
    site = await AntennaRegisterRepository.get(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Antenna site not found")
    return site
