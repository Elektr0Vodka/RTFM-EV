import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.repository import AppSettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/registry", tags=["registry"])


class SyncChannel(BaseModel):
    name: str
    key: str


class SyncResponse(BaseModel):
    channels: list[SyncChannel]


@router.get("/sync", response_model=SyncResponse)
async def sync_registry() -> SyncResponse:
    """Fetch the configured remote channel list and return it as a normalised array.

    The remote JSON must be a flat object mapping channel name to hex key:
        { "#amsterdam": "d768f5a0...", ... }

    Returns 400 if no sync URL is configured, 502 if the remote cannot be
    reached or returns unexpected data.
    """
    settings = await AppSettingsRepository.get()
    url = settings.registry_sync_url.strip()

    if not url:
        raise HTTPException(
            status_code=400,
            detail="No sync URL configured. Set one in Settings > Database.",
        )

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("Registry sync fetch failed for %s: %s", url, exc)
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

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=502,
            detail="Sync source returned unexpected format (expected object)",
        )

    channels = [
        SyncChannel(name=name, key=key)
        for name, key in payload.items()
        if isinstance(name, str) and isinstance(key, str)
    ]

    logger.info("Registry sync: fetched %d channels from %s", len(channels), url)
    return SyncResponse(channels=channels)
