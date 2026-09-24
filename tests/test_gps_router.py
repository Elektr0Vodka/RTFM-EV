from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.routers.radio as radio_router
from app.routers.radio import GpsConfigUpdate, get_gps_config, update_gps_config


@pytest.fixture
def fake_manager(monkeypatch):
    mgr = MagicMock()
    # Stock (non-meshcomod) firmware: GET/PATCH /radio/gps must not require
    # meshcomod detection, unlike GET/PATCH /radio/meshcomod.
    mgr.firmware_ver_code = 13
    mgr.firmware_version = "v1.17.0"
    mgr.require_connected = MagicMock()
    mc = MagicMock()

    @asynccontextmanager
    async def _op(name, **kwargs):
        yield mc

    mgr.radio_operation = _op
    monkeypatch.setattr(radio_router, "radio_manager", mgr)
    return mgr, mc


class TestGpsEndpoints:
    @pytest.mark.asyncio
    async def test_get_does_not_require_meshcomod(self, fake_manager, monkeypatch):
        mgr, _mc = fake_manager
        monkeypatch.setattr(
            radio_router,
            "read_gps_settings",
            AsyncMock(
                return_value={"gps_supported": True, "gps_enabled": False, "gps_interval": 0}
            ),
        )
        resp = await get_gps_config()
        mgr.require_connected.assert_called_once()
        assert resp.gps_supported is True
        assert resp.gps_enabled is False

    @pytest.mark.asyncio
    async def test_get_requires_connected_radio(self, fake_manager, monkeypatch):
        mgr, _mc = fake_manager
        mgr.require_connected.side_effect = HTTPException(status_code=409, detail="not connected")
        monkeypatch.setattr(radio_router, "read_gps_settings", AsyncMock())
        with pytest.raises(HTTPException) as exc:
            await get_gps_config()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_get_reports_unsupported_when_var_missing(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        monkeypatch.setattr(
            radio_router,
            "read_gps_settings",
            AsyncMock(
                return_value={"gps_supported": False, "gps_enabled": None, "gps_interval": None}
            ),
        )
        resp = await get_gps_config()
        assert resp.gps_supported is False
        assert resp.gps_enabled is None

    @pytest.mark.asyncio
    async def test_patch_applies_then_reads(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        apply_mock = AsyncMock()
        monkeypatch.setattr(radio_router, "apply_gps_update", apply_mock)
        monkeypatch.setattr(
            radio_router,
            "read_gps_settings",
            AsyncMock(
                return_value={"gps_supported": True, "gps_enabled": True, "gps_interval": 300}
            ),
        )
        resp = await update_gps_config(GpsConfigUpdate(gps_enabled=True, gps_interval=300))
        apply_mock.assert_awaited_once()
        assert resp.gps_enabled is True
        assert resp.gps_interval == 300

    @pytest.mark.asyncio
    async def test_patch_raises_on_rejected_command(self, fake_manager, monkeypatch):
        from app.services.radio_commands import RadioCommandRejectedError

        _mgr, _mc = fake_manager
        monkeypatch.setattr(
            radio_router,
            "apply_gps_update",
            AsyncMock(side_effect=RadioCommandRejectedError("set failed")),
        )
        with pytest.raises(HTTPException) as exc:
            await update_gps_config(GpsConfigUpdate(gps_enabled=True))
        assert exc.value.status_code == 422
