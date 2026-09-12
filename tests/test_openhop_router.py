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


class TestOpenHopPolicyWrite:
    @pytest.mark.asyncio
    async def test_update_policy_409_when_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        from app.routers.openhop import PolicyDoc, update_policy

        with pytest.raises(HTTPException) as exc:
            await update_policy(PolicyDoc(policy={"enabled": True}))
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_update_and_validate_delegate_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import PolicyDoc, update_policy, validate_policy

        fake = AsyncMock()
        fake.update_policy = AsyncMock(return_value={"success": True})
        fake.validate_policy = AsyncMock(return_value={"success": True, "data": {"valid": True}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            assert (await update_policy(PolicyDoc(policy={"enabled": True})))["success"] is True
            result = await validate_policy(PolicyDoc(policy={"enabled": True}))
            assert result["data"]["valid"] is True
        fake.update_policy.assert_awaited_once_with({"enabled": True})
        fake.validate_policy.assert_awaited_once()


class TestOpenHopPolicyGroups:
    @pytest.mark.asyncio
    async def test_group_and_entry_endpoints_delegate(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import (
            EntryCreate,
            EntryDelete,
            GroupCreate,
            GroupDelete,
            add_group_entry,
            create_policy_group,
            delete_group_entry,
            delete_policy_group,
            list_policy_groups,
        )

        fake = AsyncMock()
        for m in (
            "list_policy_groups",
            "create_policy_group",
            "delete_policy_group",
            "add_group_entry",
            "delete_group_entry",
        ):
            setattr(fake, m, AsyncMock(return_value={"success": True}))
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            await list_policy_groups(kind=None)
            await create_policy_group(
                GroupCreate(kind="channel_hashes", group_id="g1", friendly_name="G1")
            )
            await add_group_entry(EntryCreate(kind="channel_hashes", group_id="g1", value="0x1f"))
            await delete_group_entry(
                EntryDelete(kind="channel_hashes", group_id="g1", value="0x1f")
            )
            await delete_policy_group(GroupDelete(kind="channel_hashes", group_id="g1"))
        fake.create_policy_group.assert_awaited_once()
        fake.add_group_entry.assert_awaited_once_with("channel_hashes", "g1", "0x1f")

    @pytest.mark.asyncio
    async def test_group_endpoints_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import list_policy_groups

        with pytest.raises(HTTPException) as exc:
            await list_policy_groups(kind=None)
        assert exc.value.status_code == 409
