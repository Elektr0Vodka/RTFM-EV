import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.repository import AppSettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/registry", tags=["registry"])

# Upper bound on wordlist entries a sync source may deliver. Guards the
# browser's localStorage cache (typically 5-10MB per origin) and the backend
# proxy against a multi-million-line wordlist (see docs/plans/09).
MAX_WORDLIST_ENTRIES = 100_000


class SyncChannel(BaseModel):
    name: str
    key: str


class SyncResponse(BaseModel):
    channels: list[SyncChannel]


class WordlistSyncResponse(BaseModel):
    words: list[str]


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


@router.get("/wordlist-sync", response_model=WordlistSyncResponse)
async def sync_wordlist() -> WordlistSyncResponse:
    """Fetch the configured remote candidate-name list for the channel finder.

    The remote JSON must be a flat array of strings (candidate channel names,
    with or without a leading ``#``; the browser cracker lowercases and filters
    them). The frontend merges these into its bundled wordlist.

    Returns 400 if no sync URL is configured, 502 if the remote cannot be
    reached, is not a JSON array of strings, or exceeds the entry cap.
    """
    settings = await AppSettingsRepository.get()
    url = settings.wordlist_sync_url.strip()

    if not url:
        raise HTTPException(
            status_code=400,
            detail="No wordlist sync URL configured. Set one in Settings > Database.",
        )

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("Wordlist sync fetch failed for %s: %s", url, exc)
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
            detail="Sync source returned unexpected format (expected array of strings)",
        )

    words = [word for word in payload if isinstance(word, str)]
    if len(words) > MAX_WORDLIST_ENTRIES:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Sync source has too many entries ({len(words)} > {MAX_WORDLIST_ENTRIES} limit)"
            ),
        )

    logger.info("Wordlist sync: fetched %d candidate names from %s", len(words), url)
    return WordlistSyncResponse(words=words)
