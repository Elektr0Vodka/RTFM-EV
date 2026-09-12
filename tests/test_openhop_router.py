"""Tests for the gated OpenHop REST proxy router.

The gate is fail-closed: OpenHop endpoints work only when the connected radio is
detected as OpenHop AND an API url + token are configured. Otherwise nothing is
delegated and callers get 409. The token is never returned by /status.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.repository import AppSettingsRepository
from app.routers.openhop import OpenHopCliRequest, get_policy, get_status, run_cli

OPENHOP_MODEL = "openHop-Repeater-Companion"


def _set_model(monkeypatch, model):
    monkeypatch.setattr(
        "app.routers.openhop.radio_manager.device_model", model, raising=False
    )


class TestOpenHopStatus:
    @pytest.mark.asyncio
    async def test_status_unconfigured_when_no_url(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        status = await get_status()
        assert status.is_openhop is True
        assert status.configured is False
        assert status.base_url is None

    @pytest.mark.asyncio
    async def test_status_reports_configured_without_leaking_token(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="secret-tok"
        )
        status = await get_status()
        assert status.is_openhop is True
        assert status.configured is True
        assert status.base_url == "http://node:8000"
        # The token must never appear in the status payload.
        assert "secret-tok" not in status.model_dump_json()

    @pytest.mark.asyncio
    async def test_status_not_openhop(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        status = await get_status()
        assert status.is_openhop is False
        assert status.configured is False


class TestOpenHopGate:
    @pytest.mark.asyncio
    async def test_policy_409_when_not_openhop(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        with pytest.raises(HTTPException) as exc:
            await get_policy()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_policy_409_when_openhop_but_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        with pytest.raises(HTTPException) as exc:
            await get_policy()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_policy_delegates_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.get_policy = AsyncMock(return_value={"success": True, "data": {"ok": 1}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake) as ctor:
            result = await get_policy()
        assert result == {"success": True, "data": {"ok": 1}}
        ctor.assert_called_once_with("http://node:8000", "tok")
        fake.get_policy.assert_awaited_once()
        fake.aclose.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_cli_delegates_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.cli = AsyncMock(return_value={"success": True, "data": {"reply": "v13"}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            result = await run_cli(OpenHopCliRequest(command="ver"))
        assert result["data"]["reply"] == "v13"
        fake.cli.assert_awaited_once_with("ver")
        fake.aclose.assert_awaited_once()
