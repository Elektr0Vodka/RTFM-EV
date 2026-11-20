"""Ingress prefix fallback: HA Ingress sends no prefix header, so add-on mode
learns the prefix from the Supervisor and uses it when no header is present."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.frontend_static import register_frontend_static_routes
from app.ha_addon.ingress import get_ingress_prefix, set_ingress_prefix
from app.wardrive.sessions import cookie_path
from app.web_manifest import proxy_prefix


@pytest.fixture(autouse=True)
def _reset_prefix():
    set_ingress_prefix("")
    yield
    set_ingress_prefix("")


def make_request(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "query_string": b"",
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


def test_no_header_no_ingress_is_empty():
    assert proxy_prefix(make_request({})) == ""


def test_header_wins_over_ingress():
    set_ingress_prefix("/api/hassio_ingress/tok")
    assert proxy_prefix(make_request({"x-forwarded-prefix": "/mesh"})) == "/mesh"


def test_ingress_used_without_header():
    set_ingress_prefix("/api/hassio_ingress/tok/")
    assert proxy_prefix(make_request({})) == "/api/hassio_ingress/tok"


def test_unsafe_ingress_prefix_rejected():
    set_ingress_prefix('/x";Path=/')
    assert get_ingress_prefix() == ""


def test_relative_ingress_prefix_rejected():
    set_ingress_prefix("api/hassio_ingress/tok")
    assert get_ingress_prefix() == ""


def test_manifest_uses_ingress_prefix(tmp_path):
    set_ingress_prefix("/api/hassio_ingress/tok")
    app = FastAPI()
    dist_dir = tmp_path / "frontend" / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html><body>index</body></html>")
    assert register_frontend_static_routes(app, dist_dir) is True
    with TestClient(app) as client:
        data = client.get("/site.webmanifest").json()
    assert data["start_url"] == "http://testserver/api/hassio_ingress/tok/"


def test_cookie_path_uses_ingress_prefix():
    set_ingress_prefix("/api/hassio_ingress/tok")
    assert cookie_path(make_request({})).startswith("/api/hassio_ingress/tok/")


def test_cookie_path_header_still_wins():
    set_ingress_prefix("/api/hassio_ingress/tok")
    assert cookie_path(make_request({"x-forwarded-prefix": "/mesh"})).startswith("/mesh/")
