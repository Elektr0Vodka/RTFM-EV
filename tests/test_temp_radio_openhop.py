# ruff: noqa: F811  (pytest fixtures imported from test_temp_radio)
"""Temporary radio settings are off on OpenHop nodes.

OpenHop's companion is virtual: CMD_SET_RADIO_PARAMS is answered OK without
touching the repeater's shared radio (openhop_core origin/dev 141d944,
``_cmd_set_radio_params`` / ``supports_radio_params_mutation() -> False``), and
OpenHop's own ``tempradio`` is not implemented yet. A session there would claim
a switch that never happened.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.services import temp_radio as temp_radio_module
from app.services.temp_radio import TempRadioUnsupportedError, ensure_contact_settings
from tests.test_temp_radio import (  # noqa: F401  (fixtures)
    HOME,
    KEY,
    _req,
    broadcasts,
    clock,
    radio,
    svc,
)


@pytest.mark.asyncio
async def test_start_refused_on_openhop(svc, radio):
    svc._is_openhop = lambda: True
    with pytest.raises(TempRadioUnsupportedError):
        await svc.start(_req())
    assert radio.applied == []
    assert (await svc.get_state()).active is False


@pytest.mark.asyncio
async def test_start_allowed_on_a_companion(svc, radio):
    svc._is_openhop = lambda: False
    assert (await svc.start(_req())).active is True


@pytest.mark.asyncio
async def test_auto_switch_skipped_on_openhop(test_db, client):
    key = "c3" * 32
    body = {
        "radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8},
        "region": None,
        "duration_secs": 600,
        "auto_switch": True,
    }
    await client.put(f"/api/contacts/{key}/radio-profile", json=body)
    service = temp_radio_module.temp_radio
    with (
        patch.object(service, "_is_openhop", return_value=True),
        patch.object(service, "_current", return_value=HOME),
        patch.object(service, "start", AsyncMock()) as start,
    ):
        assert await ensure_contact_settings(key) is False
    start.assert_not_awaited()


@pytest.mark.asyncio
async def test_router_start_maps_unsupported_to_409(test_db, client):
    body = {"radio": {"freq": 869.6, "bw": 62.5, "sf": 8, "cr": 8}, "duration_secs": 60}
    with patch.object(
        temp_radio_module.temp_radio,
        "start",
        AsyncMock(side_effect=TempRadioUnsupportedError("OpenHop")),
    ):
        resp = await client.post("/api/radio/temp", json=body)
    assert resp.status_code == 409
    assert "openhop" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_contact_switch_maps_unsupported_to_409(test_db, client):
    key = "c4" * 32
    body = {
        "radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8},
        "region": None,
        "duration_secs": 600,
        "auto_switch": False,
    }
    await client.put(f"/api/contacts/{key}/radio-profile", json=body)
    with patch.object(
        temp_radio_module.temp_radio,
        "start",
        AsyncMock(side_effect=TempRadioUnsupportedError("OpenHop")),
    ):
        resp = await client.post(f"/api/contacts/{key}/radio-profile/switch")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_scan_run_refused_on_openhop(test_db, client):
    from app.services import radio_scan as radio_scan_module

    body = {
        "name": "border",
        "entries": [{"radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8}, "dwell_secs": 60}],
    }
    list_id = (await client.post("/api/radio/scan-lists", json=body)).json()["id"]
    with (
        patch("app.routers.radio.radio_manager.require_connected"),
        patch.object(temp_radio_module.temp_radio, "_is_openhop", return_value=True),
        patch.object(radio_scan_module.radio_scan, "start_task", AsyncMock()) as start_task,
    ):
        resp = await client.post(f"/api/radio/scan-lists/{list_id}/run")
    assert resp.status_code == 409
    start_task.assert_not_awaited()
