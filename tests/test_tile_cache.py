"""Backend map tile cache: allow-list (SSRF), freshness, hit/miss/stale, eviction, pre-download."""

import asyncio
from dataclasses import replace

import pytest

from app.services import tile_cache as tc
from app.services.tile_cache import (
    BBox,
    TileCache,
    TileDownloader,
    TileNotAllowed,
    TileUnavailable,
    UpstreamError,
    UpstreamResponse,
    check_predownload,
    count_tiles,
    lat_to_tile_y,
    lon_to_tile_x,
    parse_freshness,
    resolve_source,
    upstream_url,
)


class FakeUpstream:
    """Records requests and answers with a queued or default response."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.responses: list[UpstreamResponse | Exception] = []
        self.default = UpstreamResponse(
            200, {"content-type": "image/png", "cache-control": "max-age=3600"}, b"PNG"
        )

    async def __call__(self, url: str, headers: dict[str, str]) -> UpstreamResponse:
        self.calls.append((url, headers))
        if self.responses:
            r = self.responses.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        return self.default


class Clock:
    def __init__(self, t: float = 1_000_000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def upstream():
    return FakeUpstream()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
async def cache(tmp_path, upstream, clock):
    c = TileCache(tmp_path / "tile_cache", fetcher=upstream, clock=clock)
    await c.update_config(enabled=True)
    return c


# --- allow-list / SSRF -------------------------------------------------------


class TestAllowList:
    @pytest.mark.parametrize(
        "source,path",
        [
            ("ofm", "styles/dark"),
            ("ofm", "planet"),
            ("ofm", "planet/20260913_164504_pt/10/527/337.pbf"),
            ("ofm", "sprites/ofm_f384/ofm@2x.png"),
            ("ofm", "fonts/Noto Sans Regular/0-255.pbf"),
            ("ofm", "natural_earth/ne2sr/3/4/2.png"),
            ("osm", "10/527/337.png"),
            ("otm", "10/527/337.png"),
        ],
    )
    def test_allowed_paths(self, source, path):
        assert resolve_source(source, path).id == source

    @pytest.mark.parametrize(
        "source,path",
        [
            # Unknown source / arbitrary host attempts.
            ("evil", "10/1/1.png"),
            ("osm", "http://169.254.169.254/latest/meta-data"),
            ("osm", "//127.0.0.1/10/1/1.png"),
            ("osm", "@127.0.0.1/10/1/1.png"),
            ("ofm", "../../etc/passwd"),
            ("ofm", "styles/../planet"),
            ("ofm", "planet?url=http://127.0.0.1"),
            ("osm", "10/1/1.png?x=1"),
            ("osm", "10/1/1.png/../../x"),
            # Out-of-range tile coordinates.
            ("osm", "1/2/0.png"),
            ("osm", "10/0/1024.png"),
            # Esri is left direct: its terms forbid storing, so never proxied.
            ("esri", "ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0"),
        ],
    )
    def test_rejected_paths(self, source, path):
        with pytest.raises(TileNotAllowed):
            resolve_source(source, path)

    def test_upstream_host_is_fixed_by_source(self):
        # a/b/c client hosts all map to the single host the OSM policy asks for.
        src = resolve_source("osm", "3/1/2.png")
        assert upstream_url(src, "3/1/2.png") == "https://tile.openstreetmap.org/3/1/2.png"
        src = resolve_source("ofm", "fonts/Noto Sans Regular/0-255.pbf")
        assert (
            upstream_url(src, "fonts/Noto Sans Regular/0-255.pbf")
            == "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf"
        )

    async def test_rejected_path_never_fetches(self, cache, upstream):
        with pytest.raises(TileNotAllowed):
            await cache.get("osm", "http://127.0.0.1/1/0/0.png")
        assert upstream.calls == []

    async def test_fetch_upstream_refuses_private_address(self, monkeypatch):
        def fake_resolve(url):
            raise tc.UnsafeUrlError("host resolves to non-public address: 127.0.0.1")

        monkeypatch.setattr(tc, "resolve_public_ip", fake_resolve)
        with pytest.raises(UpstreamError):
            await tc.fetch_upstream("https://tile.openstreetmap.org/1/0/0.png", {})


# --- freshness ---------------------------------------------------------------


class TestFreshness:
    def test_max_age(self):
        f = parse_freshness({"Cache-Control": "public, max-age=86400"}, 0)
        assert f.ttl_s == 86400 and not f.no_store

    def test_s_maxage_wins(self):
        assert parse_freshness({"cache-control": "max-age=10, s-maxage=99"}, 0).ttl_s == 99

    def test_stale_if_error(self):
        f = parse_freshness(
            {
                "cache-control": "max-age=95854, stale-while-revalidate=604800, stale-if-error=604800"
            },
            0,
        )
        assert f.ttl_s == 95854 and f.stale_if_error_s == 604800

    def test_expires_relative_to_date(self):
        f = parse_freshness(
            {
                "date": "Wed, 23 Sep 2026 16:00:00 GMT",
                "expires": "Wed, 23 Sep 2026 17:00:00 GMT",
            },
            0,
        )
        assert f.ttl_s == 3600

    def test_default_ttl_without_headers(self):
        assert parse_freshness({}, 0).ttl_s == 7 * 24 * 3600

    def test_no_store_and_private(self):
        assert parse_freshness({"cache-control": "no-store"}, 0).no_store
        assert parse_freshness({"cache-control": "private, max-age=60"}, 0).no_store

    def test_no_cache_and_must_revalidate(self):
        f = parse_freshness({"cache-control": "max-age=60, no-cache, must-revalidate"}, 0)
        assert f.ttl_s == 0 and f.must_revalidate


# --- hit / miss / stale -------------------------------------------------------


class TestCacheLookup:
    async def test_miss_then_hit(self, cache, upstream, clock):
        r1 = await cache.get("osm", "3/1/2.png")
        assert (r1.cache_status, r1.body, r1.content_type) == ("MISS", b"PNG", "image/png")
        clock.t += 10
        r2 = await cache.get("osm", "3/1/2.png")
        assert r2.cache_status == "HIT" and r2.body == b"PNG"
        assert len(upstream.calls) == 1
        url, headers = upstream.calls[0]
        assert url == "https://tile.openstreetmap.org/3/1/2.png"
        assert headers["User-Agent"].startswith("RTFM-EV-TileCache/")

    async def test_expired_entry_is_revalidated_conditionally(self, cache, upstream, clock):
        upstream.responses.append(
            UpstreamResponse(
                200,
                {"content-type": "image/png", "cache-control": "max-age=60", "etag": '"abc"'},
                b"PNG1",
            )
        )
        await cache.get("osm", "3/1/2.png")
        clock.t += 120
        upstream.responses.append(UpstreamResponse(304, {"cache-control": "max-age=60"}, b""))
        r = await cache.get("osm", "3/1/2.png")
        assert r.cache_status == "REVALIDATED" and r.body == b"PNG1"
        assert upstream.calls[1][1]["If-None-Match"] == '"abc"'
        clock.t += 30  # fresh again after the 304
        assert (await cache.get("osm", "3/1/2.png")).cache_status == "HIT"

    async def test_offline_serves_stale(self, cache, upstream, clock):
        await cache.get("ofm", "planet")
        clock.t += 7200  # past max-age=3600
        upstream.responses.append(UpstreamError("ConnectError"))
        r = await cache.get("ofm", "planet")
        assert r.cache_status == "STALE" and r.body == b"PNG"

    async def test_offline_uncached_fails_gracefully(self, cache, upstream):
        upstream.responses.append(UpstreamError("ConnectError"))
        with pytest.raises(TileUnavailable) as exc:
            await cache.get("osm", "3/1/2.png")
        assert exc.value.status_code == 504

    async def test_must_revalidate_is_not_served_stale(self, cache, upstream, clock):
        upstream.responses.append(
            UpstreamResponse(200, {"cache-control": "max-age=1, must-revalidate"}, b"X")
        )
        await cache.get("osm", "3/1/2.png")
        clock.t += 10
        upstream.responses.append(UpstreamError("down"))
        with pytest.raises(TileUnavailable):
            await cache.get("osm", "3/1/2.png")

    async def test_server_error_uses_stale_if_error_window(self, cache, upstream, clock):
        upstream.responses.append(
            UpstreamResponse(200, {"cache-control": "max-age=60, stale-if-error=600"}, b"X")
        )
        await cache.get("osm", "3/1/2.png")
        clock.t += 300
        upstream.responses.append(UpstreamResponse(503, {}, b""))
        assert (await cache.get("osm", "3/1/2.png")).cache_status == "STALE"
        clock.t += 1000  # beyond expires + stale-if-error
        upstream.responses.append(UpstreamResponse(503, {}, b""))
        with pytest.raises(TileUnavailable):
            await cache.get("osm", "3/1/2.png")

    async def test_no_store_is_not_cached(self, cache, upstream):
        upstream.responses.append(UpstreamResponse(200, {"cache-control": "no-store"}, b"X"))
        await cache.get("osm", "3/1/2.png")
        assert (await cache.stats())["entries"] == 0

    async def test_upstream_404(self, cache, upstream):
        upstream.responses.append(UpstreamResponse(404, {}, b""))
        with pytest.raises(TileUnavailable) as exc:
            await cache.get("osm", "3/1/2.png")
        assert exc.value.status_code == 404

    async def test_entry_older_than_max_age_is_dropped(self, cache, upstream, clock):
        await cache.update_config(max_age_days=1)
        await cache.get("osm", "3/1/2.png")
        clock.t += 2 * 86400
        upstream.responses.append(UpstreamError("down"))
        with pytest.raises(TileUnavailable):
            await cache.get("osm", "3/1/2.png")

    async def test_concurrent_requests_share_one_fetch(self, cache, upstream):
        gate = asyncio.Event()

        async def slow(url, headers):
            upstream.calls.append((url, headers))
            await gate.wait()
            return upstream.default

        cache._fetch = slow
        tasks = [asyncio.create_task(cache.get("osm", "3/1/2.png")) for _ in range(5)]
        await asyncio.sleep(0)
        gate.set()
        results = await asyncio.gather(*tasks)
        assert all(r.body == b"PNG" for r in results)
        assert len(upstream.calls) == 1


# --- size cap / eviction / stats / config ----------------------------------------


class TestEvictionAndStats:
    async def test_lru_eviction(self, cache, upstream, clock, monkeypatch):
        big = b"x" * 400_000
        upstream.default = UpstreamResponse(200, {"cache-control": "max-age=3600"}, big)
        # Shrink the cap to ~1 MB for the test (config clamps to >= 50 MB).
        monkeypatch.setattr(type(cache), "max_bytes", property(lambda self: 1_000_000))
        import os

        await cache.get("osm", "3/0/0.png")
        await cache.get("osm", "3/0/1.png")
        # Make 3/0/0 the least recently used, 3/0/1 more recent.
        os.utime(cache._path_for("osm/3/0/0.png"), (1, 1))
        os.utime(cache._path_for("osm/3/0/1.png"), (2, 2))
        await cache.get("osm", "3/0/2.png")  # pushes total over 1 MB -> evict
        stats = await cache.stats()
        assert stats["bytes"] <= 1_000_000
        assert not cache._path_for("osm/3/0/0.png").exists()
        assert cache._path_for("osm/3/0/2.png").exists()

    async def test_stats_and_clear(self, cache, upstream):
        await cache.get("osm", "3/1/2.png")
        await cache.get("ofm", "planet")
        stats = await cache.stats()
        assert stats["entries"] == 2
        assert set(stats["per_source"]) == {"osm", "ofm"}
        await cache.clear()
        assert (await cache.stats())["entries"] == 0

    async def test_config_persists_and_clamps(self, tmp_path, upstream):
        root = tmp_path / "tc"
        c = TileCache(root, fetcher=upstream)
        assert c.config.enabled is False  # default off
        await c.update_config(enabled=True, max_size_mb=1, max_age_days=99999)
        again = TileCache(root, fetcher=upstream)
        assert again.config.enabled is True
        assert again.config.max_size_mb == tc.MIN_SIZE_MB
        assert again.config.max_age_days == tc.MAX_AGE_DAYS


# --- tile math ---------------------------------------------------------------------


class TestTileMath:
    def test_known_tile(self):
        # Amsterdam (4.9, 52.37) at z10 is tile 525/336 (standard slippy map math).
        assert lon_to_tile_x(4.9, 10) == 525
        assert lat_to_tile_y(52.37, 10) == 336

    def test_world_counts(self):
        world = BBox(-180, -85.06, 180, 85.06)
        assert count_tiles(world, 0, 0) == 1
        assert count_tiles(world, 0, 2) == 1 + 4 + 16

    def test_small_area_counts_per_zoom(self):
        # 4.95E crosses the z10 tile edge (x = 526.08), so two columns at z10.
        bbox = BBox(4.85, 52.35, 4.95, 52.40)
        assert tc.tile_ranges(bbox, 10, 12) == [
            (10, 525, 526, 336, 336),
            (11, 1051, 1052, 672, 673),
            (12, 2103, 2104, 1345, 1346),
        ]
        assert count_tiles(bbox, 10, 12) == 2 + 4 + 4

    def test_bbox_validation(self):
        with pytest.raises(ValueError):
            BBox(5, 52, 4, 53).validate()
        with pytest.raises(ValueError):
            BBox(4, 53, 5, 52).validate()


# --- pre-download ---------------------------------------------------------------------


AREA = BBox(4.85, 52.35, 4.95, 52.40)


class TestPredownload:
    @pytest.mark.parametrize("source", ["osm", "ofm", "otm", "esri"])
    async def test_blocked_for_current_sources(self, cache, source):
        with pytest.raises(TileNotAllowed):
            check_predownload(cache, source, AREA, 10, 12)

    async def test_osm_start_is_refused(self, cache, upstream):
        downloader = TileDownloader(cache)
        with pytest.raises(TileNotAllowed):
            await downloader.start("osm", AREA, 10, 12)
        assert upstream.calls == []

    @pytest.fixture
    def allowed_source(self, monkeypatch):
        """A hypothetical source whose policy allows bulk download (tests only)."""
        src = replace(tc.SOURCES["otm"], id="test", predownload=True)
        monkeypatch.setitem(tc.SOURCES, "test", src)
        return src

    async def test_limits(self, cache, allowed_source):
        with pytest.raises(ValueError):
            check_predownload(cache, "test", AREA, 10, 16)  # above zoom cap
        with pytest.raises(ValueError):
            check_predownload(cache, "test", AREA, 12, 10)  # inverted
        with pytest.raises(ValueError):
            check_predownload(cache, "test", BBox(-10, 40, 10, 60), 10, 15)  # over tile cap
        await cache.update_config(enabled=False)
        with pytest.raises(TileNotAllowed):
            check_predownload(cache, "test", AREA, 10, 12)

    async def test_download_runs_and_skips_cached(self, cache, upstream, allowed_source):
        expected = count_tiles(AREA, 10, 12)
        downloader = TileDownloader(cache)
        await downloader.start("test", AREA, 10, 12)
        await downloader._task
        assert downloader.status.state == "done"
        assert downloader.status.done == expected and downloader.status.failed == 0
        assert len(upstream.calls) == expected
        # A second run serves everything from the fresh cache: no new fetches.
        await downloader.start("test", AREA, 10, 12)
        await downloader._task
        assert len(upstream.calls) == expected

    async def test_download_cancel(self, cache, upstream, allowed_source):
        gate = asyncio.Event()

        async def slow(url, headers):
            await gate.wait()
            return upstream.default

        cache._fetch = slow
        downloader = TileDownloader(cache)
        await downloader.start("test", AREA, 10, 12)
        await asyncio.sleep(0)
        status = await downloader.cancel()
        assert status.state == "cancelled"
        gate.set()
