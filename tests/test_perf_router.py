"""Performance API, sampler storage and health rules."""

import time

import pytest

from app.perf import health
from app.perf.middleware import PerfRouteMiddleware
from app.perf.recorders import RouteRecorder
from app.perf.sampler import RANGES, Sampler, combine

SNAPSHOT_KEYS = {
    "generated_at",
    "health",
    "process",
    "latest",
    "loop",
    "tasks",
    "asyncio_tasks",
    "pipeline",
    "database",
    "radio",
    "outputs",
    "routes",
    "logs",
}


class TestRouter:
    async def test_snapshot_has_every_section(self, test_db, client):
        async with client as c:
            response = await c.get("/api/perf/snapshot")
        assert response.status_code == 200
        body = response.json()
        assert set(body) >= SNAPSHOT_KEYS
        assert body["health"]["state"] in {"ok", "degraded", "critical"}
        assert isinstance(body["asyncio_tasks"], list)

    async def test_api_requests_are_timed_by_full_route(self, test_db, client):
        async with client as c:
            await c.get("/api/perf/history", params={"range": "1h"})
            body = (await c.get("/api/perf/snapshot")).json()
        routes = {r["route"] for r in body["routes"]["routes"]}
        assert "GET /api/perf/history" in routes

    async def test_history_empty(self, test_db, client):
        async with client as c:
            response = await c.get("/api/perf/history", params={"range": "7d"})
        assert response.status_code == 200
        assert response.json()["points"] == []

    async def test_unknown_range_rejected(self, test_db, client):
        async with client as c:
            response = await c.get("/api/perf/history", params={"range": "2y"})
        assert response.status_code == 422


class TestSampler:
    async def test_sample_feeds_ring_and_stores_minutes(self, test_db):
        s = Sampler()
        await s.sample(now=1_000_000_000)  # minute 16666666
        await s.sample(now=1_000_000_010)
        await s.sample(now=1_000_000_070)  # next minute: previous one is stored
        assert len(s.ring()) == 3

        async with test_db.readonly() as conn:
            async with conn.execute("SELECT ts, tasks FROM perf_samples") as cursor:
                rows = await cursor.fetchall()
        assert len(rows) == 1
        assert rows[0][0] == (1_000_000_000 // 60) * 60
        assert rows[0][1] >= 1

    async def test_short_ranges_come_from_memory(self, test_db):
        s = Sampler()
        now = time.time()
        await s.sample(now=now - 4000)
        await s.sample(now=now - 30)
        result = await s.history("1h", now=now)
        assert result["step_s"] == 10
        assert len(result["points"]) == 1

    async def test_long_ranges_are_bucketed(self, test_db):
        now = 2_000_000_000
        async with test_db.tx() as conn:
            for minute in range(3000):
                await conn.execute(
                    "INSERT INTO perf_samples (ts, cpu, lag_p95, stalls) VALUES (?, ?, ?, ?)",
                    (now - minute * 60, 10.0, float(minute % 50), 1),
                )
        result = await Sampler().history("7d", now=now)
        assert result["step_s"] == 840  # 7 days / 720 points, rounded up to whole minutes
        assert 0 < len(result["points"]) <= 720
        first = result["points"][0]
        assert first["cpu"] == 10.0
        assert first["stalls"] >= 1  # summed per bucket

    def test_every_range_has_a_size(self):
        assert set(RANGES) == {"live", "15m", "1h", "6h", "24h", "7d", "30d"}

    def test_combine_rules(self):
        row = combine(
            [
                {"cpu": 10, "lag_p95": 5, "stalls": 1, "rss_mb": None},
                {"cpu": 20, "lag_p95": 9, "stalls": 2, "rss_mb": 100},
            ]
        )
        assert row["cpu"] == 15
        assert row["lag_p95"] == 9
        assert row["stalls"] == 3
        assert row["rss_mb"] == 100
        assert row["db_p95"] is None


class TestHealth:
    def test_ok_when_nothing_found(self):
        assert health.evaluate({}) == {"state": "ok", "reasons": []}

    def test_overdue_loop_degrades(self):
        result = health.evaluate({"tasks": [{"name": "svc.loop", "state": "overdue"}]})
        assert result["state"] == "degraded"
        assert result["reasons"][0] == {
            "key": "loop_overdue",
            "detail": "svc.loop",
            "severity": "degraded",
        }

    def test_recent_long_stall_degrades_and_old_one_does_not(self):
        now = 10_000.0
        stalls = [
            {"at": now - 60, "duration_ms": 800.0},
            {"at": now - 4000, "duration_ms": 9000.0},
        ]
        result = health.evaluate({"loop": {"stalls": stalls}}, now=now)
        assert [r["key"] for r in result["reasons"]] == ["stall"]
        assert result["reasons"][0]["detail"] == "800 ms"

    def test_memory_near_limit_is_critical(self):
        result = health.evaluate({"process": {"rss_mb": 470.0, "mem_limit_mb": 512.0}})
        assert result["state"] == "critical"

    def test_radio_disconnected_only_when_wanted(self):
        down = {"radio": {"desired": True, "connected": False, "connection_info": "TCP"}}
        paused = {"radio": {"desired": False, "connected": False}}
        assert health.evaluate(down)["reasons"][0]["key"] == "radio_disconnected"
        assert health.evaluate(paused)["state"] == "ok"


class TestRouteMiddleware:
    async def test_times_api_requests_by_template(self, monkeypatch):
        recorder = RouteRecorder()
        monkeypatch.setattr("app.perf.middleware.routes", recorder)

        class _Route:
            # FastAPI reports the route without the include_router prefix.
            path = "/contacts/{key}"

        async def app(scope, receive, send):
            scope["route"] = _Route()
            await send({"type": "http.response.start", "status": 503})
            await send({"type": "http.response.body", "body": b""})

        async def send(message):
            return None

        middleware = PerfRouteMiddleware(app)
        await middleware({"type": "http", "path": "/api/contacts/ab", "method": "GET"}, None, send)
        await middleware({"type": "http", "path": "/assets/x.js", "method": "GET"}, None, send)
        (row,) = recorder.snapshot()["routes"]
        assert row["route"] == "GET /api/contacts/{key}"
        assert row["errors_5xx"] == 1

    @pytest.mark.parametrize("path", ["/api/ws", "/index.html"])
    async def test_skips_websocket_and_static(self, monkeypatch, path):
        recorder = RouteRecorder()
        monkeypatch.setattr("app.perf.middleware.routes", recorder)

        async def app(scope, receive, send):
            return None

        await PerfRouteMiddleware(app)({"type": "http", "path": path}, None, None)
        assert recorder.snapshot()["routes"] == []
