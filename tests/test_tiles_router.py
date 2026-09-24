"""Tests for the /api/tiles router (proxy, config, stats, pre-download)."""

import pytest

from app.services import tile_cache as tc
from app.services.tile_cache import TileCache, TileDownloader, UpstreamError, UpstreamResponse


class _Upstream:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.fail = False

    async def __call__(self, url, headers):
        self.calls.append(url)
        if self.fail:
            raise UpstreamError("offline")
        return UpstreamResponse(
            200, {"content-type": "image/png", "cache-control": "max-age=3600"}, b"PNG"
        )


@pytest.fixture
def upstream(tmp_path, monkeypatch):
    up = _Upstream()
    cache = TileCache(tmp_path / "tile_cache", fetcher=up)
    monkeypatch.setattr(tc, "_cache", cache)
    monkeypatch.setattr(tc, "_downloader", TileDownloader(cache))
    return up


class TestTilesRouter:
    async def test_config_defaults_and_sources(self, client, upstream):
        body = (await client.get("/api/tiles/config")).json()
        assert body["enabled"] is False
        assert body["max_size_mb"] == 1024
        by_id = {s["id"]: s for s in body["sources"]}
        assert by_id["osm"]["proxy"] is True and by_id["osm"]["predownload"] is False
        assert by_id["esri"]["proxy"] is False
        assert not any(s["predownload"] for s in body["sources"])

    async def test_disabled_redirects_to_allow_listed_upstream(self, client, upstream):
        resp = await client.get("/api/tiles/proxy/osm/3/1/2.png")
        assert resp.status_code == 307
        assert resp.headers["location"] == "https://tile.openstreetmap.org/3/1/2.png"
        assert upstream.calls == []

    async def test_proxy_miss_hit_and_offline(self, client, upstream):
        await client.patch("/api/tiles/config", json={"enabled": True})
        r1 = await client.get("/api/tiles/proxy/osm/3/1/2.png")
        assert r1.status_code == 200 and r1.content == b"PNG"
        assert r1.headers["x-tile-cache"] == "MISS"
        assert r1.headers["content-type"] == "image/png"
        r2 = await client.get("/api/tiles/proxy/osm/3/1/2.png")
        assert r2.headers["x-tile-cache"] == "HIT"
        upstream.fail = True
        missing = await client.get("/api/tiles/proxy/osm/3/1/3.png")
        assert missing.status_code == 504
        stats = (await client.get("/api/tiles/stats")).json()
        assert stats["entries"] == 1 and stats["per_source"]["osm"]["entries"] == 1

    @pytest.mark.parametrize(
        "url",
        [
            "/api/tiles/proxy/evil/1/0/0.png",
            "/api/tiles/proxy/esri/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0",
            "/api/tiles/proxy/osm/127.0.0.1/1/0/0.png",
            "/api/tiles/proxy/ofm/styles/dark%2F..%2F..%2Fx",
        ],
    )
    async def test_proxy_rejects_non_allow_listed(self, client, upstream, url):
        await client.patch("/api/tiles/config", json={"enabled": True})
        resp = await client.get(url)
        assert resp.status_code == 404
        assert upstream.calls == []

    async def test_config_validation(self, client, upstream):
        resp = await client.patch("/api/tiles/config", json={"max_size_mb": 1})
        assert resp.status_code == 422

    async def test_clear_cache(self, client, upstream):
        await client.patch("/api/tiles/config", json={"enabled": True})
        await client.get("/api/tiles/proxy/osm/3/1/2.png")
        stats = (await client.delete("/api/tiles/cache")).json()
        assert stats["entries"] == 0

    async def test_predownload_blocked_for_osm(self, client, upstream):
        await client.patch("/api/tiles/config", json={"enabled": True})
        area = {
            "source": "osm",
            "west": 4.85,
            "south": 52.35,
            "east": 4.95,
            "north": 52.40,
            "min_zoom": 10,
            "max_zoom": 12,
        }
        est = (await client.post("/api/tiles/download/estimate", json=area)).json()
        assert est == {
            "tiles": 10,
            "max_tiles": tc.PREDOWNLOAD_MAX_TILES,
            "allowed": False,
            "reason": est["reason"],
        }
        assert "does not allow" in est["reason"]
        resp = await client.post("/api/tiles/download", json=area)
        assert resp.status_code == 403
        assert upstream.calls == []
        assert (await client.get("/api/tiles/download")).json()["state"] == "idle"
