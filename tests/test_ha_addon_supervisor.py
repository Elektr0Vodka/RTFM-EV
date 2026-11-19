"""Supervisor API client used in Home Assistant add-on mode."""

import json
from unittest.mock import patch

import httpx
import pytest

from app.ha_addon.supervisor import SupervisorClient, SupervisorUnavailable
from app.routers.health import build_health_data


def _client(handler, token: str | None = "t") -> SupervisorClient:
    return SupervisorClient(token, transport=httpx.MockTransport(handler))


async def test_self_info_sends_bearer_and_returns_data():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/addons/self/info"
        assert request.headers["authorization"] == "Bearer t"
        return httpx.Response(
            200, json={"result": "ok", "data": {"ingress_entry": "/api/hassio_ingress/tok"}}
        )

    info = await _client(handler).self_info()
    assert info["ingress_entry"] == "/api/hassio_ingress/tok"


async def test_missing_token_raises_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("no request without a token")

    with pytest.raises(SupervisorUnavailable):
        await _client(handler, token=None).self_info()


async def test_error_result_raises_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"result": "error", "message": "nope"})

    with pytest.raises(SupervisorUnavailable, match="nope"):
        await _client(handler).self_info()


async def test_connect_error_raises_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(SupervisorUnavailable):
        await _client(handler).list_addons()


async def test_list_addons_returns_list():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/addons"
        return httpx.Response(
            200, json={"result": "ok", "data": {"addons": [{"slug": "e8c7f026_mc_remoteterm"}]}}
        )

    assert await _client(handler).list_addons() == [{"slug": "e8c7f026_mc_remoteterm"}]


async def test_create_partial_backup_body_and_slug():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/backups/new/partial"
        assert json.loads(request.content) == {
            "name": "n",
            "addons": ["e8c7f026_mc_remoteterm"],
            "homeassistant": False,
        }
        return httpx.Response(200, json={"result": "ok", "data": {"slug": "b1"}})

    assert await _client(handler).create_partial_backup("e8c7f026_mc_remoteterm", "n") == "b1"


async def test_restart_self_posts():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={"result": "ok", "data": {}})

    await _client(handler).restart_self()
    assert seen == [("POST", "/addons/self/restart")]


async def test_init_ha_addon_sets_ingress_prefix():
    from app.ha_addon.ingress import get_ingress_prefix, set_ingress_prefix
    from app.ha_addon.startup import init_ha_addon

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"result": "ok", "data": {"ingress_entry": "/api/hassio_ingress/tok"}}
        )

    try:
        await init_ha_addon(_client(handler))
        assert get_ingress_prefix() == "/api/hassio_ingress/tok"
    finally:
        set_ingress_prefix("")


async def test_init_ha_addon_survives_unreachable_supervisor(caplog):
    from app.ha_addon.ingress import get_ingress_prefix
    from app.ha_addon.startup import init_ha_addon

    await init_ha_addon(SupervisorClient(None))
    assert get_ingress_prefix() == ""
    assert "Supervisor" in caplog.text


async def test_health_reports_ha_addon(test_db):
    with (
        patch("app.fanout.manager.fanout_manager") as mock_fm,
        patch("app.routers.health.settings") as mock_settings,
    ):
        mock_fm.get_statuses.return_value = {}
        mock_settings.ha_addon = True
        data = await build_health_data(True, "TCP: 1.2.3.4:4000")
    assert data["ha_addon"] is True


async def test_health_ha_addon_off_by_default(test_db):
    with patch("app.fanout.manager.fanout_manager") as mock_fm:
        mock_fm.get_statuses.return_value = {}
        data = await build_health_data(True, "TCP: 1.2.3.4:4000")
    assert data["ha_addon"] is False
