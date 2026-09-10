import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.repository import AppSettingsRepository
from app.routers.radio import _dedupe_region_names

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/regions", tags=["regions"])


class RegionSyncResponse(BaseModel):
    regions: list[str]


def _extract_region_names(payload: object) -> list[str]:
    """Map an analyzer regions payload to a deduplicated list of region names.

    Expects the analyzer's ``/api/regions/scopes`` shape: a bare JSON array of
    ``{"code": str, "name": str}`` objects. Each entry becomes its ``name`` when
    non-empty, else its ``code`` (mirroring the analyzer's own display fallback,
    ``s.name || s.code``), since ``known_regions`` matches by the name text used
    to derive the transport code. The wildcard ``*`` sentinel and blanks are
    dropped and the result is deduplicated case-insensitively via the same
    helper used by the live ``discover-regions`` sweep, so all region write
    paths stay consistent.
    """
    names: list[str] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        code = entry.get("code")
        if isinstance(name, str) and name.strip():
            names.append(name)
        elif isinstance(code, str):
            names.append(code)
    return _dedupe_region_names(names)


@router.get("/sync", response_model=RegionSyncResponse)
async def sync_regions() -> RegionSyncResponse:
    """Fetch the configured analyzer regions endpoint and return region names.

    The remote JSON must be a bare array of ``{"code": ..., "name": ...}``
    objects, e.g. ``https://meshcore-analyzer.eu/api/regions/scopes``. Returns
    the deduplicated region names ready to merge into ``known_regions``.

    Returns 400 if no sync URL is configured, 502 if the remote cannot be
    reached or returns unexpected data.
    """
    settings = await AppSettingsRepository.get()
    url = settings.region_sync_url.strip()

    if not url:
        raise HTTPException(
            status_code=400,
            detail="No region sync URL configured. Set one in Settings > Radio.",
        )

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("Region sync fetch failed for %s: %s", url, exc)
        raise HTTPException(status_code=502, detail=f"Could not reach sync URL: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Sync source returned HTTP {response.status_code}",
        )

    try:
        payload = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Sync source returned unexpected format (not JSON)",
        ) from exc

    if not isinstance(payload, list):
        raise HTTPException(
            status_code=502,
            detail="Sync source returned unexpected format (expected array)",
        )

    regions = _extract_region_names(payload)
    logger.info("Region sync: fetched %d regions from %s", len(regions), url)
    return RegionSyncResponse(regions=regions)
