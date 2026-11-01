"""The /wardrive/ page is served from its own build folder, before the SPA catch-all."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend_static import register_frontend_static_routes
from app.wardrive.static import register_wardrive_page_routes
from tests.test_wardrive_auth import _raw_status


def _build(tmp_path: Path, *, with_wardrive: bool = True) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>main app</html>")
    (dist / "assets" / "main.js").write_text("main")
    if with_wardrive:
        (dist / "wardrive" / "assets").mkdir(parents=True)
        (dist / "wardrive" / "wardrive.html").write_text("<html>wardrive page</html>")
        (dist / "wardrive" / "assets" / "a.js").write_text("console.log(1)")
        (dist / "wardrive" / "sw.js").write_text("// sw")
    return dist


def _app(dist: Path) -> FastAPI:
    app = FastAPI()
    register_wardrive_page_routes(app, [dist])
    register_frontend_static_routes(app, dist)
    return app


def test_redirects_bare_prefix(tmp_path):
    with TestClient(_app(_build(tmp_path))) as client:
        r = client.get("/wardrive", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "wardrive/"


def test_serves_page(tmp_path):
    with TestClient(_app(_build(tmp_path))) as client:
        r = client.get("/wardrive/")
    assert r.status_code == 200
    assert r.text == "<html>wardrive page</html>"
    assert r.headers["cache-control"] == "no-cache"


def test_serves_asset(tmp_path):
    with TestClient(_app(_build(tmp_path))) as client:
        r = client.get("/wardrive/assets/a.js")
    assert r.status_code == 200
    assert r.text == "console.log(1)"
    assert "immutable" in r.headers["cache-control"]


def test_service_worker_not_cached(tmp_path):
    with TestClient(_app(_build(tmp_path))) as client:
        r = client.get("/wardrive/sw.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_spa_fallback(tmp_path):
    with TestClient(_app(_build(tmp_path))) as client:
        r = client.get("/wardrive/somewhere/else")
    assert r.text == "<html>wardrive page</html>"


async def test_no_escape(tmp_path):
    status = await _raw_status(_app(_build(tmp_path)), "/wardrive/../index.html")
    assert status == 404


def test_missing_build(tmp_path):
    dist = _build(tmp_path, with_wardrive=False)
    with TestClient(_app(dist)) as client:
        r = client.get("/wardrive/")
    assert r.status_code == 503
    assert r.json() == {"detail": "The wardrive page is not built"}


def test_returns_folder(tmp_path):
    dist = _build(tmp_path)
    assert register_wardrive_page_routes(FastAPI(), [tmp_path / "nope", dist]) == dist / "wardrive"


@pytest.mark.parametrize("path", ["/", "/assets/main.js"])
def test_main_app_unchanged(tmp_path, path):
    with TestClient(_app(_build(tmp_path))) as client:
        assert client.get(path).status_code == 200
