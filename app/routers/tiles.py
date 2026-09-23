"""Map tile cache: allow-listed caching proxy, settings, stats and area pre-download."""

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field

from app.services.tile_cache import (
    MAX_AGE_DAYS,
    MAX_SIZE_MB,
    MIN_AGE_DAYS,
    MIN_SIZE_MB,
    PREDOWNLOAD_CONCURRENCY,
    PREDOWNLOAD_MAX_TILES,
    PREDOWNLOAD_MAX_ZOOM,
    PREDOWNLOAD_MIN_ZOOM,
    SOURCES,
    BBox,
    TileNotAllowed,
    TileUnavailable,
    check_predownload,
    count_tiles,
    get_tile_cache,
    get_tile_downloader,
    resolve_source,
    upstream_url,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tiles", tags=["tiles"])


class TileSourceInfo(BaseModel):
    id: str
    label: str
    client_prefixes: list[str]
    proxy: bool
    predownload: bool
    max_zoom: int
    policy_url: str


class TileCacheLimits(BaseModel):
    min_size_mb: int = MIN_SIZE_MB
    max_size_mb: int = MAX_SIZE_MB
    min_age_days: int = MIN_AGE_DAYS
    max_age_days: int = MAX_AGE_DAYS
    predownload_min_zoom: int = PREDOWNLOAD_MIN_ZOOM
    predownload_max_zoom: int = PREDOWNLOAD_MAX_ZOOM
    predownload_max_tiles: int = PREDOWNLOAD_MAX_TILES
    predownload_concurrency: int = PREDOWNLOAD_CONCURRENCY


class TileCacheConfigResponse(BaseModel):
    enabled: bool
    max_size_mb: int
    max_age_days: int
    limits: TileCacheLimits
    sources: list[TileSourceInfo]


class TileCacheConfigUpdate(BaseModel):
    enabled: bool | None = None
    max_size_mb: int | None = Field(default=None, ge=MIN_SIZE_MB, le=MAX_SIZE_MB)
    max_age_days: int | None = Field(default=None, ge=MIN_AGE_DAYS, le=MAX_AGE_DAYS)


class TileSourceStats(BaseModel):
    entries: int
    bytes: int


class TileCacheStats(BaseModel):
    entries: int
    bytes: int
    max_bytes: int
    per_source: dict[str, TileSourceStats]


class TileAreaRequest(BaseModel):
    source: str = Field(max_length=32)
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    min_zoom: int = Field(ge=0, le=22)
    max_zoom: int = Field(ge=0, le=22)

    def bbox(self) -> BBox:
        return BBox(self.west, self.south, self.east, self.north)


class TileAreaEstimate(BaseModel):
    tiles: int
    max_tiles: int
    allowed: bool
    reason: str | None = None


class TileDownloadStatus(BaseModel):
    state: str
    source: str | None = None
    total: int = 0
    done: int = 0
    failed: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None


def _config_response() -> TileCacheConfigResponse:
    cfg = get_tile_cache().config
    return TileCacheConfigResponse(
        enabled=cfg.enabled,
        max_size_mb=cfg.max_size_mb,
        max_age_days=cfg.max_age_days,
        limits=TileCacheLimits(),
        sources=[
            TileSourceInfo(
                id=s.id,
                label=s.label,
                client_prefixes=list(s.client_prefixes),
                proxy=s.proxy,
                predownload=s.predownload,
                max_zoom=s.max_zoom,
                policy_url=s.policy_url,
            )
            for s in SOURCES.values()
        ],
    )


@router.get("/config", response_model=TileCacheConfigResponse)
async def get_tile_config() -> TileCacheConfigResponse:
    return _config_response()


@router.patch("/config", response_model=TileCacheConfigResponse)
async def update_tile_config(update: TileCacheConfigUpdate) -> TileCacheConfigResponse:
    await get_tile_cache().update_config(
        enabled=update.enabled,
        max_size_mb=update.max_size_mb,
        max_age_days=update.max_age_days,
    )
    return _config_response()


@router.get("/stats", response_model=TileCacheStats)
async def get_tile_stats() -> TileCacheStats:
    return TileCacheStats.model_validate(await get_tile_cache().stats())


@router.delete("/cache", response_model=TileCacheStats)
async def clear_tile_cache() -> TileCacheStats:
    downloader = get_tile_downloader()
    if downloader.running:
        raise HTTPException(status_code=409, detail="an area download is running")
    cache = get_tile_cache()
    await cache.clear()
    return TileCacheStats.model_validate(await cache.stats())


@router.post("/download/estimate", response_model=TileAreaEstimate)
async def estimate_tile_download(req: TileAreaRequest) -> TileAreaEstimate:
    bbox = req.bbox()
    try:
        bbox.validate()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    lo, hi = sorted((req.min_zoom, req.max_zoom))
    tiles = count_tiles(bbox, lo, hi)
    try:
        check_predownload(get_tile_cache(), req.source, bbox, req.min_zoom, req.max_zoom)
    except (TileNotAllowed, ValueError) as exc:
        return TileAreaEstimate(
            tiles=tiles, max_tiles=PREDOWNLOAD_MAX_TILES, allowed=False, reason=str(exc)
        )
    return TileAreaEstimate(tiles=tiles, max_tiles=PREDOWNLOAD_MAX_TILES, allowed=True)


@router.post("/download", response_model=TileDownloadStatus)
async def start_tile_download(req: TileAreaRequest) -> TileDownloadStatus:
    downloader = get_tile_downloader()
    try:
        status = await downloader.start(req.source, req.bbox(), req.min_zoom, req.max_zoom)
    except TileNotAllowed as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return TileDownloadStatus(**asdict(status))


@router.get("/download", response_model=TileDownloadStatus)
async def get_tile_download() -> TileDownloadStatus:
    return TileDownloadStatus(**asdict(get_tile_downloader().status))


@router.delete("/download", response_model=TileDownloadStatus)
async def cancel_tile_download() -> TileDownloadStatus:
    status = await get_tile_downloader().cancel()
    return TileDownloadStatus(**asdict(status))


@router.get("/proxy/{source}/{path:path}")
async def proxy_tile(source: str, path: str) -> Response:
    """Serve an allow-listed tile/style/sprite/glyph from the cache or its upstream.

    The upstream URL is rebuilt server-side from the source's fixed base, so the
    client can never choose the host. With the cache disabled the request is
    redirected to the (allow-listed) upstream so an open map keeps working.
    """
    try:
        src = resolve_source(source, path)
    except TileNotAllowed as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    cache = get_tile_cache()
    if not cache.config.enabled:
        return RedirectResponse(upstream_url(src, path), status_code=307)
    try:
        result = await cache.get(source, path)
    except TileNotAllowed as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TileUnavailable as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return Response(
        content=result.body,
        media_type=result.content_type,
        headers={
            "Cache-Control": f"max-age={max(0, result.max_age_s)}",
            "X-Tile-Cache": result.cache_status,
        },
    )
