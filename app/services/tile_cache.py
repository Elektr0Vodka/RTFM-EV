"""Backend map tile cache: an allow-listed caching proxy for basemap tiles.

The browser's MapLibre ``transformRequest`` rewrites requests for allow-listed
upstream URL prefixes to ``/api/tiles/proxy/{source}/{path}``. The server
rebuilds the upstream URL from a fixed per-source base plus a path that must
match one of that source's path patterns, so the client never chooses the host
(SSRF safety). The fetch itself is IP-pinned to a validated public address,
the same approach as the chat link-preview fetch (``url_safety``).

Viewed tiles are stored on disk under ``<data dir>/tile_cache/tiles`` (one file
per tile: magic, JSON metadata, body), shared by every browser. Freshness
follows the upstream ``Cache-Control`` / ``Expires`` headers; expired entries
are revalidated with ``If-None-Match`` / ``If-Modified-Since``. When the
upstream cannot be reached, a stale entry is served (RFC 9111 section 4.2.4
permits a disconnected cache to do so unless ``must-revalidate``). Size is
capped with least-recently-used eviction (file mtime is touched on every hit),
and entries older than the configured max age are dropped.

Area pre-download is limited to sources whose tile policy allows bulk
download. None of the current sources qualifies (see ``SOURCES``), so the
machinery stays inert until such a source is added.

Settings live in ``<data dir>/tile_cache/config.json`` (no DB table).
"""

from __future__ import annotations

import asyncio
import contextlib
import email.utils
import hashlib
import json
import logging
import math
import os
import re
import shutil
import struct
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from app.config import settings
from app.services.url_safety import UnsafeUrlError, resolve_public_ip

logger = logging.getLogger(__name__)

# --- Limits and defaults ---------------------------------------------------

DEFAULT_ENABLED = False
DEFAULT_MAX_SIZE_MB = 1024
DEFAULT_MAX_AGE_DAYS = 365  # meshcore-open's map_tile_cache_service stale period
MIN_SIZE_MB, MAX_SIZE_MB = 50, 50_000
MIN_AGE_DAYS, MAX_AGE_DAYS = 1, 3650

# Used when the upstream sends no freshness headers at all. The OSM tile policy
# asks caches that cannot read headers to keep each tile at least 7 days.
DEFAULT_TTL_S = 7 * 24 * 3600
MAX_BODY_BYTES = 8 * 1024 * 1024
FETCH_TIMEOUT_S = 15.0
PROXY_CONCURRENCY = 8
EVICT_TARGET_RATIO = 0.9

PREDOWNLOAD_MIN_ZOOM = 0
PREDOWNLOAD_MAX_ZOOM = 15  # meshcore-open downloads zoom 10-15
PREDOWNLOAD_MAX_TILES = 5000
PREDOWNLOAD_CONCURRENCY = 4  # below meshcore-open's 8, to stay polite

_MAGIC = b"RTC1"


def _user_agent() -> str:
    try:
        from app.version_info import get_app_build_info

        version = get_app_build_info().version
    except Exception:  # noqa: BLE001 - the UA must never break a fetch
        version = "unknown"
    # OSM tile policy: proxies must send "a clear, contactable User-Agent".
    return f"RTFM-EV-TileCache/{version} (+https://github.com/Elektr0Vodka/RTFM-EV)"


# --- Source allow-list -----------------------------------------------------

_ZXY = r"(?P<z>\d{1,2})/(?P<x>\d{1,7})/(?P<y>\d{1,7})"


@dataclass(frozen=True)
class TileSource:
    """One upstream the proxy may contact.

    ``upstream_base`` is the only host the server ever fetches for this source;
    the client-supplied path is appended only after it fully matches one of
    ``path_patterns``. ``client_prefixes`` are the URL prefixes the browser
    rewrites to the proxy (the basemap URLs in ``frontend/src/map/engine/basemaps.ts``).
    """

    id: str
    label: str
    upstream_base: str
    client_prefixes: tuple[str, ...]
    path_patterns: tuple[re.Pattern[str], ...]
    proxy: bool
    predownload: bool
    policy_url: str
    max_zoom: int = 19
    # Path template for area pre-download, e.g. "{z}/{x}/{y}.png".
    predownload_template: str | None = None


def _p(*patterns: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(p) for p in patterns)


# Verdicts per source (researched 2026-09-23):
#
# OpenFreeMap (tiles.openfreemap.org; Nova, Positron, Liberty, Dark, Fiord)
#   https://openfreemap.org/ : "no limits on the number of map views or requests".
#   https://openfreemap.org/tos/ forbids attempts to "collect data from the service
#   in automated ways without permission"; bulk data is offered as weekly planet
#   downloads instead. Caching viewed tiles: allowed (not restricted; tiles carry
#   long max-age). Pre-download: NO (automated collection without permission).
#
# OpenStreetMap (tile.openstreetmap.org; "light" raster)
#   https://operations.osmfoundation.org/policies/tiles/ : caching proxies are
#   "generally" not recommended but allowed if they send a clear, contactable
#   User-Agent and honour Cache-Control/Expires/ETag (conditional requests).
#   Bulk downloading and offline "save area" features are prohibited.
#   Proxy+cache: yes (viewed tiles only, headers honoured). Pre-download: NO.
#
# OpenTopoMap (tile.opentopomap.org; "topographic" raster)
#   https://opentopomap.org/about : free use with attribution (CC-BY-SA) as long
#   as the server is not overloaded by mass downloads ("Massendownloads").
#   https://wiki.openstreetmap.org/wiki/OpenTopoMap : contact them for bigger use.
#   Proxy+cache: yes. Pre-download: NO.
#
# Esri (server.arcgisonline.com; darkgray, lightgray, natgeo, satellite)
#   Esri Master Agreement E204CW (2025-08-01), Data terms: basemaps may go
#   offline only through Esri Content Packages; "Customer may not otherwise
#   scrape, download, or store Data."
#   https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf
#   Proxy+cache: NO (left direct, never fetched by the server). Pre-download: NO.
SOURCES: dict[str, TileSource] = {
    s.id: s
    for s in (
        TileSource(
            id="ofm",
            label="OpenFreeMap",
            upstream_base="https://tiles.openfreemap.org/",
            client_prefixes=("https://tiles.openfreemap.org/",),
            path_patterns=_p(
                r"styles/[a-z0-9-]{1,40}",
                r"planet",
                r"planet/\d{8}_\d{6}_pt/" + _ZXY + r"\.pbf",
                r"natural_earth/ne2sr/" + _ZXY + r"\.png",
                r"sprites/[a-z0-9_]{1,40}/[a-z0-9_]{1,40}(@2x)?\.(json|png)",
                r"fonts/[A-Za-z0-9 ,_-]{1,200}/\d{1,5}-\d{1,5}\.pbf",
            ),
            proxy=True,
            predownload=False,
            policy_url="https://openfreemap.org/tos/",
            max_zoom=14,
        ),
        TileSource(
            id="osm",
            label="OpenStreetMap",
            # The policy asks for exactly this host; the a/b/c client URLs map to it.
            upstream_base="https://tile.openstreetmap.org/",
            client_prefixes=(
                "https://tile.openstreetmap.org/",
                "https://a.tile.openstreetmap.org/",
                "https://b.tile.openstreetmap.org/",
                "https://c.tile.openstreetmap.org/",
            ),
            path_patterns=_p(_ZXY + r"\.png"),
            proxy=True,
            predownload=False,
            policy_url="https://operations.osmfoundation.org/policies/tiles/",
            max_zoom=19,
            predownload_template="{z}/{x}/{y}.png",
        ),
        TileSource(
            id="otm",
            label="OpenTopoMap",
            upstream_base="https://tile.opentopomap.org/",
            client_prefixes=(
                "https://tile.opentopomap.org/",
                "https://a.tile.opentopomap.org/",
                "https://b.tile.opentopomap.org/",
                "https://c.tile.opentopomap.org/",
            ),
            path_patterns=_p(_ZXY + r"\.png"),
            proxy=True,
            predownload=False,
            policy_url="https://opentopomap.org/about",
            max_zoom=17,
            predownload_template="{z}/{x}/{y}.png",
        ),
        TileSource(
            id="esri",
            label="Esri",
            upstream_base="https://server.arcgisonline.com/",
            client_prefixes=("https://server.arcgisonline.com/",),
            path_patterns=(),
            proxy=False,
            predownload=False,
            policy_url=(
                "https://www.esri.com/content/dam/esrisites/en-us/media/legal/"
                "ma-translations/english.pdf"
            ),
        ),
    )
}


class TileNotAllowed(Exception):
    """The source/path is not on the allow-list (or the action is not permitted)."""


class TileUnavailable(Exception):
    """The tile could not be served (not cached and the upstream failed)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class UpstreamError(Exception):
    """Network-level failure reaching the upstream (treated as disconnected)."""


def resolve_source(source_id: str, path: str) -> TileSource:
    """Return the proxied source when ``path`` fully matches one of its patterns."""
    src = SOURCES.get(source_id)
    if src is None or not src.proxy:
        raise TileNotAllowed(f"source not proxied: {source_id!r}")
    for pattern in src.path_patterns:
        m = pattern.fullmatch(path)
        if not m:
            continue
        groups = m.groupdict()
        if groups.get("z") is not None:
            z, x, y = int(groups["z"]), int(groups["x"]), int(groups["y"])
            n = 1 << z
            if z > 22 or x >= n or y >= n:
                raise TileNotAllowed("tile coordinates out of range")
        return src
    raise TileNotAllowed(f"path not allowed for {source_id!r}")


def upstream_url(src: TileSource, path: str) -> str:
    """Build the upstream URL from the fixed base and a validated path."""
    return src.upstream_base + quote(path, safe="/@")


# --- Upstream fetch (IP-pinned) --------------------------------------------


@dataclass
class UpstreamResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


Fetcher = Callable[[str, dict[str, str]], Awaitable[UpstreamResponse]]

# One client per upstream host: pooled connections were opened with that host's
# SNI, so a connection is never reused for a different hostname on the same IP.
_clients: dict[str, httpx.AsyncClient] = {}


async def fetch_upstream(url: str, headers: dict[str, str]) -> UpstreamResponse:
    """GET ``url`` pinned to a freshly validated public IP (see ``unfurl._fetch_once``).

    Redirects are not followed. Raises ``UpstreamError`` for resolution
    failures, non-public addresses, network errors and oversized bodies.
    """
    parts = urlsplit(url)
    try:
        ip = await asyncio.to_thread(resolve_public_ip, url)
    except UnsafeUrlError as exc:
        raise UpstreamError(str(exc)) from exc
    ip_netloc = f"[{ip}]" if ":" in ip else ip
    if parts.port:
        ip_netloc = f"{ip_netloc}:{parts.port}"
    pinned = urlunsplit((parts.scheme, ip_netloc, parts.path or "/", parts.query, ""))
    host = parts.hostname or ""
    client = _clients.get(host)
    if client is None:
        client = httpx.AsyncClient(timeout=FETCH_TIMEOUT_S, follow_redirects=False)
        _clients[host] = client
    try:
        async with client.stream(
            "GET",
            pinned,
            headers={**headers, "Host": parts.netloc},
            # SNI + certificate verification use the real hostname, not the IP.
            extensions={"sni_hostname": host},
        ) as resp:
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_BODY_BYTES:
                    raise UpstreamError("upstream body too large")
                chunks.append(chunk)
            return UpstreamResponse(resp.status_code, dict(resp.headers), b"".join(chunks))
    except httpx.HTTPError as exc:
        raise UpstreamError(f"{type(exc).__name__}: {exc}") from exc


# --- Freshness -------------------------------------------------------------


def _parse_cache_control(value: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (value or "").split(","):
        part = part.strip()
        if not part:
            continue
        k, _, v = part.partition("=")
        out[k.strip().lower()] = v.strip().strip('"')
    return out


def _int_or_none(value: str | None) -> int | None:
    try:
        return max(0, int(value)) if value is not None else None
    except ValueError:
        return None


@dataclass
class Freshness:
    ttl_s: int
    stale_if_error_s: int | None
    must_revalidate: bool
    no_store: bool


def parse_freshness(headers: Mapping[str, str], now: float) -> Freshness:
    """Freshness lifetime from upstream headers (a shared cache's view)."""
    h = {k.lower(): v for k, v in headers.items()}
    cc = _parse_cache_control(h.get("cache-control"))
    # "private" responses must not be stored by a shared cache.
    no_store = "no-store" in cc or "private" in cc
    ttl: int | None = _int_or_none(cc.get("s-maxage")) if "s-maxage" in cc else None
    if ttl is None and "max-age" in cc:
        ttl = _int_or_none(cc.get("max-age"))
    if ttl is None and h.get("expires"):
        try:
            exp = email.utils.parsedate_to_datetime(h["expires"]).timestamp()
            base = now
            if h.get("date"):
                base = email.utils.parsedate_to_datetime(h["date"]).timestamp()
            ttl = max(0, int(exp - base))
        except (TypeError, ValueError, IndexError):
            ttl = 0  # an invalid Expires means "already expired"
    if ttl is None:
        ttl = DEFAULT_TTL_S
    if "no-cache" in cc:
        ttl = 0
    return Freshness(
        ttl_s=ttl,
        stale_if_error_s=_int_or_none(cc.get("stale-if-error")),
        must_revalidate="must-revalidate" in cc or "proxy-revalidate" in cc,
        no_store=no_store,
    )


# --- Disk cache ------------------------------------------------------------


@dataclass
class TileCacheConfig:
    enabled: bool = DEFAULT_ENABLED
    max_size_mb: int = DEFAULT_MAX_SIZE_MB
    max_age_days: int = DEFAULT_MAX_AGE_DAYS


@dataclass
class TileResult:
    body: bytes
    content_type: str
    cache_status: str  # HIT | MISS | REVALIDATED | STALE
    max_age_s: int


@dataclass
class _Entry:
    meta: dict
    body: bytes


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(value)))


class TileCache:
    def __init__(
        self,
        root: Path,
        fetcher: Fetcher | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.root = root
        self.tiles_dir = root / "tiles"
        self._config_path = root / "config.json"
        self._fetch = fetcher or fetch_upstream
        self._clock = clock
        self._config = self._load_config()
        self._total_bytes: int | None = None
        self._evict_lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(PROXY_CONCURRENCY)
        self._inflight: dict[str, asyncio.Future[TileResult]] = {}

    # config -----------------------------------------------------------------

    def _load_config(self) -> TileCacheConfig:
        try:
            raw = json.loads(self._config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return TileCacheConfig()
        cfg = TileCacheConfig()
        if isinstance(raw.get("enabled"), bool):
            cfg.enabled = raw["enabled"]
        if isinstance(raw.get("max_size_mb"), int):
            cfg.max_size_mb = _clamp(raw["max_size_mb"], MIN_SIZE_MB, MAX_SIZE_MB)
        if isinstance(raw.get("max_age_days"), int):
            cfg.max_age_days = _clamp(raw["max_age_days"], MIN_AGE_DAYS, MAX_AGE_DAYS)
        return cfg

    @property
    def config(self) -> TileCacheConfig:
        return self._config

    async def update_config(
        self,
        enabled: bool | None = None,
        max_size_mb: int | None = None,
        max_age_days: int | None = None,
    ) -> TileCacheConfig:
        cfg = TileCacheConfig(**asdict(self._config))
        if enabled is not None:
            cfg.enabled = enabled
        if max_size_mb is not None:
            cfg.max_size_mb = _clamp(max_size_mb, MIN_SIZE_MB, MAX_SIZE_MB)
        if max_age_days is not None:
            cfg.max_age_days = _clamp(max_age_days, MIN_AGE_DAYS, MAX_AGE_DAYS)

        def _write() -> None:
            self.root.mkdir(parents=True, exist_ok=True)
            tmp = self._config_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(asdict(cfg)), encoding="utf-8")
            os.replace(tmp, self._config_path)

        await asyncio.to_thread(_write)
        self._config = cfg
        await self.evict_if_needed()
        return cfg

    @property
    def max_bytes(self) -> int:
        return self._config.max_size_mb * 1024 * 1024

    # files ------------------------------------------------------------------

    def _path_for(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        source = key.split("/", 1)[0]
        return self.tiles_dir / source / digest[:2] / f"{digest}.tile"

    def _read(self, key: str) -> _Entry | None:
        path = self._path_for(key)
        try:
            data = path.read_bytes()
        except OSError:
            return None
        if len(data) < 8 or data[:4] != _MAGIC:
            return None
        (meta_len,) = struct.unpack(">I", data[4:8])
        try:
            meta = json.loads(data[8 : 8 + meta_len].decode("utf-8"))
        except ValueError:
            return None
        return _Entry(meta=meta, body=data[8 + meta_len :])

    def _write(self, key: str, meta: dict, body: bytes) -> tuple[int, int]:
        """Write an entry atomically; returns (new size, previous size)."""
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        meta_bytes = json.dumps(meta, separators=(",", ":")).encode("utf-8")
        blob = _MAGIC + struct.pack(">I", len(meta_bytes)) + meta_bytes + body
        try:
            previous = path.stat().st_size
        except OSError:
            previous = 0
        tmp = path.with_suffix(f".{os.getpid()}.{id(blob)}.tmp")
        tmp.write_bytes(blob)
        os.replace(tmp, path)
        return len(blob), previous

    def _delete(self, key: str) -> int:
        path = self._path_for(key)
        try:
            size = path.stat().st_size
            path.unlink()
            return size
        except OSError:
            return 0

    def _touch(self, key: str) -> None:
        with contextlib.suppress(OSError):
            os.utime(self._path_for(key))

    def _scan(self) -> list[tuple[float, int, Path, str]]:
        out: list[tuple[float, int, Path, str]] = []
        if not self.tiles_dir.exists():
            return out
        for source_dir in self.tiles_dir.iterdir():
            if not source_dir.is_dir():
                continue
            for dirpath, _dirs, files in os.walk(source_dir):
                for name in files:
                    if not name.endswith(".tile"):
                        continue
                    p = Path(dirpath) / name
                    try:
                        st = p.stat()
                    except OSError:
                        continue
                    out.append((st.st_mtime, st.st_size, p, source_dir.name))
        return out

    async def _ensure_total(self) -> int:
        if self._total_bytes is None:
            entries = await asyncio.to_thread(self._scan)
            self._total_bytes = sum(e[1] for e in entries)
        return self._total_bytes

    async def evict_if_needed(self) -> int:
        """Evict least-recently-used entries when over the size cap. Returns bytes freed."""
        total = await self._ensure_total()
        if total <= self.max_bytes:
            return 0
        async with self._evict_lock:
            target = int(self.max_bytes * EVICT_TARGET_RATIO)

            def _evict() -> tuple[int, int]:
                entries = sorted(self._scan(), key=lambda e: e[0])
                current = sum(e[1] for e in entries)
                freed = 0
                for _mtime, size, path, _src in entries:
                    if current - freed <= target:
                        break
                    with contextlib.suppress(OSError):
                        path.unlink()
                        freed += size
                return current - freed, freed

            remaining, freed = await asyncio.to_thread(_evict)
            self._total_bytes = remaining
            if freed:
                logger.info("Tile cache evicted %d bytes (now %d)", freed, remaining)
            return freed

    async def stats(self) -> dict:
        entries = await asyncio.to_thread(self._scan)
        per_source: dict[str, dict[str, int]] = {}
        for _mtime, size, _path, src in entries:
            s = per_source.setdefault(src, {"entries": 0, "bytes": 0})
            s["entries"] += 1
            s["bytes"] += size
        total = sum(e[1] for e in entries)
        self._total_bytes = total
        return {
            "entries": len(entries),
            "bytes": total,
            "max_bytes": self.max_bytes,
            "per_source": per_source,
        }

    async def clear(self) -> None:
        def _rm() -> None:
            if self.tiles_dir.exists():
                shutil.rmtree(self.tiles_dir, ignore_errors=True)

        await asyncio.to_thread(_rm)
        self._total_bytes = 0

    # lookup -----------------------------------------------------------------

    async def get(self, source_id: str, path: str) -> TileResult:
        """Serve a tile from cache or upstream. Raises TileNotAllowed / TileUnavailable."""
        src = resolve_source(source_id, path)
        key = f"{src.id}/{path}"
        now = self._clock()
        entry = await asyncio.to_thread(self._read, key)
        if entry is not None:
            max_age_s = self._config.max_age_days * 86400
            if now - float(entry.meta.get("fetched", 0)) > max_age_s:
                freed = await asyncio.to_thread(self._delete, key)
                if self._total_bytes is not None:
                    self._total_bytes = max(0, self._total_bytes - freed)
                entry = None
        if entry is not None and now < float(entry.meta.get("expires", 0)):
            await asyncio.to_thread(self._touch, key)
            return TileResult(
                entry.body,
                entry.meta.get("ct", "application/octet-stream"),
                "HIT",
                int(float(entry.meta["expires"]) - now),
            )

        # One upstream fetch per key: concurrent requests share it. It runs as its
        # own task so a browser that drops the request does not abort the fetch
        # (the tile still lands in the cache for the next view).
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._refresh(src, path, key, entry))
            self._inflight[key] = task
            task.add_done_callback(lambda t, k=key: self._finish_inflight(k, t))
        return await asyncio.shield(task)

    def _finish_inflight(self, key: str, task: asyncio.Task[TileResult]) -> None:
        self._inflight.pop(key, None)
        if not task.cancelled():
            # Mark any exception retrieved when every waiter went away.
            task.exception()

    async def _store(self, key: str, meta: dict, body: bytes) -> None:
        new_size, previous = await asyncio.to_thread(self._write, key, meta, body)
        total = await self._ensure_total()
        self._total_bytes = total + new_size - previous
        if self._total_bytes > self.max_bytes:
            await self.evict_if_needed()

    async def _refresh(
        self, src: TileSource, path: str, key: str, entry: _Entry | None
    ) -> TileResult:
        headers = {"User-Agent": _user_agent()}
        if entry is not None:
            if entry.meta.get("etag"):
                headers["If-None-Match"] = entry.meta["etag"]
            if entry.meta.get("lm"):
                headers["If-Modified-Since"] = entry.meta["lm"]
        url = upstream_url(src, path)
        try:
            async with self._sem:
                resp = await self._fetch(url, headers)
        except UpstreamError as exc:
            if entry is not None and not entry.meta.get("mr"):
                logger.debug("Tile upstream unreachable, serving stale %s: %s", key, exc)
                return self._stale(entry)
            raise TileUnavailable(504, "tile not cached and upstream unreachable") from exc

        now = self._clock()
        if resp.status == 304 and entry is not None:
            fresh = parse_freshness(resp.headers, now)
            meta = dict(entry.meta)
            meta.update(self._meta_from(fresh, resp.headers, now, keep=entry.meta))
            await self._store(key, meta, entry.body)
            return TileResult(entry.body, meta["ct"], "REVALIDATED", fresh.ttl_s)
        if resp.status == 200:
            fresh = parse_freshness(resp.headers, now)
            ct = {k.lower(): v for k, v in resp.headers.items()}.get(
                "content-type", "application/octet-stream"
            )
            if not fresh.no_store:
                meta = {"ct": ct, **self._meta_from(fresh, resp.headers, now)}
                await self._store(key, meta, resp.body)
            return TileResult(resp.body, ct, "MISS", fresh.ttl_s)
        if entry is not None and (resp.status >= 500 or resp.status == 429):
            sie = entry.meta.get("sie")
            if sie is not None and now <= float(entry.meta.get("expires", 0)) + int(sie):
                return self._stale(entry)
        if resp.status == 404:
            raise TileUnavailable(404, "tile not found upstream")
        raise TileUnavailable(502, f"upstream returned {resp.status}")

    @staticmethod
    def _meta_from(
        fresh: Freshness, headers: Mapping[str, str], now: float, keep: dict | None = None
    ) -> dict:
        h = {k.lower(): v for k, v in headers.items()}
        keep = keep or {}
        return {
            "fetched": now,
            "expires": now + fresh.ttl_s,
            "sie": fresh.stale_if_error_s,
            "mr": fresh.must_revalidate,
            "etag": h.get("etag") or keep.get("etag"),
            "lm": h.get("last-modified") or keep.get("lm"),
        }

    @staticmethod
    def _stale(entry: _Entry) -> TileResult:
        return TileResult(entry.body, entry.meta.get("ct", "application/octet-stream"), "STALE", 0)


# --- Tile math -------------------------------------------------------------

MAX_LAT = 85.05112878


def lon_to_tile_x(lon: float, z: int) -> int:
    n = 1 << z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    return max(0, min(n - 1, x))


def lat_to_tile_y(lat: float, z: int) -> int:
    n = 1 << z
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    rad = math.radians(lat)
    y = int(math.floor((1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * n))
    return max(0, min(n - 1, y))


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def validate(self) -> None:
        if not (-180 <= self.west < self.east <= 180):
            raise ValueError("west must be less than east, within -180..180")
        if not (-90 <= self.south < self.north <= 90):
            raise ValueError("south must be less than north, within -90..90")


def tile_ranges(bbox: BBox, min_zoom: int, max_zoom: int) -> list[tuple[int, int, int, int, int]]:
    """(z, x_min, x_max, y_min, y_max) per zoom level, inclusive."""
    out = []
    for z in range(min_zoom, max_zoom + 1):
        x0, x1 = lon_to_tile_x(bbox.west, z), lon_to_tile_x(bbox.east, z)
        # North has the smaller tile y.
        y0, y1 = lat_to_tile_y(bbox.north, z), lat_to_tile_y(bbox.south, z)
        out.append((z, x0, x1, y0, y1))
    return out


def count_tiles(bbox: BBox, min_zoom: int, max_zoom: int) -> int:
    return sum(
        (x1 - x0 + 1) * (y1 - y0 + 1)
        for _z, x0, x1, y0, y1 in tile_ranges(bbox, min_zoom, max_zoom)
    )


def iter_tiles(bbox: BBox, min_zoom: int, max_zoom: int) -> Iterator[tuple[int, int, int]]:
    for z, x0, x1, y0, y1 in tile_ranges(bbox, min_zoom, max_zoom):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield z, x, y


# --- Area pre-download ------------------------------------------------------


@dataclass
class DownloadStatus:
    state: str = "idle"  # idle | running | done | cancelled | error
    source: str | None = None
    total: int = 0
    done: int = 0
    failed: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None


def check_predownload(
    cache: TileCache, source_id: str, bbox: BBox, min_zoom: int, max_zoom: int
) -> tuple[TileSource, int]:
    """Validate a pre-download request. Raises TileNotAllowed / ValueError."""
    src = SOURCES.get(source_id)
    if src is None:
        raise TileNotAllowed(f"unknown source {source_id!r}")
    if not (src.proxy and src.predownload and src.predownload_template):
        raise TileNotAllowed(f"the {src.label} tile policy does not allow area download")
    if not cache.config.enabled:
        raise TileNotAllowed("the tile cache is disabled")
    bbox.validate()
    top = min(PREDOWNLOAD_MAX_ZOOM, src.max_zoom)
    if not (PREDOWNLOAD_MIN_ZOOM <= min_zoom <= max_zoom <= top):
        raise ValueError(f"zoom range must be within {PREDOWNLOAD_MIN_ZOOM}..{top}")
    total = count_tiles(bbox, min_zoom, max_zoom)
    if total > PREDOWNLOAD_MAX_TILES:
        raise ValueError(f"{total} tiles exceeds the limit of {PREDOWNLOAD_MAX_TILES}")
    return src, total


@dataclass
class TileDownloader:
    cache: TileCache
    status: DownloadStatus = field(default_factory=DownloadStatus)
    _task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(
        self, source_id: str, bbox: BBox, min_zoom: int, max_zoom: int
    ) -> DownloadStatus:
        if self.running:
            raise RuntimeError("a download is already running")
        src, total = check_predownload(self.cache, source_id, bbox, min_zoom, max_zoom)
        self.status = DownloadStatus(
            state="running", source=src.id, total=total, started_at=time.time()
        )
        self._task = asyncio.create_task(self._run(src, bbox, min_zoom, max_zoom))
        return self.status

    async def _run(self, src: TileSource, bbox: BBox, min_zoom: int, max_zoom: int) -> None:
        tiles = iter_tiles(bbox, min_zoom, max_zoom)
        template = src.predownload_template or ""
        status = self.status

        async def worker() -> None:
            for z, x, y in tiles:
                try:
                    await self.cache.get(src.id, template.format(z=z, x=x, y=y))
                    status.done += 1
                except (TileUnavailable, TileNotAllowed):
                    status.failed += 1

        try:
            await asyncio.gather(*(worker() for _ in range(PREDOWNLOAD_CONCURRENCY)))
            status.state = "done"
        except asyncio.CancelledError:
            status.state = "cancelled"
        except Exception as exc:  # noqa: BLE001 - report instead of crashing the loop
            logger.exception("Tile pre-download failed")
            status.state = "error"
            status.error = str(exc)
        finally:
            status.finished_at = time.time()

    async def cancel(self) -> DownloadStatus:
        task = self._task
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        return self.status


# --- Singletons ------------------------------------------------------------

_cache: TileCache | None = None
_downloader: TileDownloader | None = None


def tile_cache_root() -> Path:
    """``<data dir>/tile_cache``, beside the SQLite DB (like ``wordlists``)."""
    return Path(settings.database_path).parent / "tile_cache"


def get_tile_cache() -> TileCache:
    global _cache
    if _cache is None:
        _cache = TileCache(tile_cache_root())
    return _cache


def get_tile_downloader() -> TileDownloader:
    global _downloader
    if _downloader is None:
        _downloader = TileDownloader(get_tile_cache())
    return _downloader
