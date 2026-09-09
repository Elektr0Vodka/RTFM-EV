from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.routers.radio as radio_router
from app.routers.health import RadioDeviceInfoResponse
from app.routers.radio import (
    MeshcomodConfigUpdate,
    get_meshcomod_config,
    update_meshcomod_config,
)


def test_radio_device_info_has_is_meshcomod_default_false():
    info = RadioDeviceInfoResponse()
    assert info.is_meshcomod is False


@pytest.fixture
def fake_manager(monkeypatch):
    mgr = MagicMock()
    mgr.firmware_ver_code = 27
    mgr.firmware_version = "v1.17.0.4-DMC-EV-d5"
    mgr.require_connected = MagicMock()
    mc = MagicMock()

    @asynccontextmanager
    async def _op(name, **kwargs):
        yield mc

    mgr.radio_operation = _op
    monkeypatch.setattr(radio_router, "radio_manager", mgr)
    return mgr, mc


class TestMeshcomodEndpoints:
    @pytest.mark.asyncio
    async def test_get_rejects_non_meshcomod(self, fake_manager, monkeypatch):
        mgr, _mc = fake_manager
        mgr.firmware_ver_code = 13
        mgr.firmware_version = "v1.17.0"
        with pytest.raises(HTTPException) as exc:
            await get_meshcomod_config()
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_returns_settings(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        monkeypatch.setattr(
            radio_router,
            "read_meshcomod_settings",
            AsyncMock(
                return_value={
                    "cad_supported": True,
                    "cad_enabled": True,
                    "gps_supported": False,
                    "gps_enabled": None,
                    "gps_interval": None,
                }
            ),
        )
        resp = await get_meshcomod_config()
        assert resp.cad_supported is True
        assert resp.cad_enabled is True
        assert resp.gps_supported is False

    @pytest.mark.asyncio
    async def test_patch_applies_then_reads(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        apply_mock = AsyncMock()
        monkeypatch.setattr(radio_router, "apply_meshcomod_update", apply_mock)
        monkeypatch.setattr(
            radio_router,
            "read_meshcomod_settings",
            AsyncMock(
                return_value={
                    "cad_supported": True,
                    "cad_enabled": False,
                    "gps_supported": True,
                    "gps_enabled": True,
                    "gps_interval": 600,
                }
            ),
        )
        resp = await update_meshcomod_config(MeshcomodConfigUpdate(cad_enabled=False))
        apply_mock.assert_awaited_once()
        assert resp.cad_enabled is False
