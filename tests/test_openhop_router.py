"""Tests for the gated OpenHop REST proxy router.

The gate is fail-closed: OpenHop endpoints work only when the connected radio is
detected as OpenHop AND an API url + token are configured. Otherwise nothing is
delegated and callers get 409. The token is never returned by /status.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.repository import AppSettingsRepository
from app.routers.openhop import (
    ConfigImportRequest,
    ConfigModeRequest,
    ConfigRadioRequest,
    OpenHopCliRequest,
    config_export,
    config_import,
    config_mode,
    config_radio,
    config_restart,
    get_policy,
    get_status,
    run_cli,
)

OPENHOP_MODEL = "openHop-Repeater-Companion"


def _set_model(monkeypatch, model):
    monkeypatch.setattr("app.routers.openhop.radio_manager.device_model", model, raising=False)


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


class TestOpenHopPlugins:
    @pytest.mark.asyncio
    async def test_plugin_endpoints_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import list_plugins

        with pytest.raises(HTTPException) as exc:
            await list_plugins()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_plugin_endpoints_delegate_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import (
            PluginId,
            PluginInstallBody,
            PluginSettingsBody,
            PluginUninstallBody,
            list_plugins,
            plugin_catalogue,
            plugin_catalogue_install,
            plugin_lifecycle,
            plugin_logs,
            plugin_settings_get,
            plugin_settings_set,
            plugin_status,
            plugin_uninstall,
            plugin_update,
            plugin_updates,
        )

        fake = AsyncMock()
        for m in (
            "list_plugins",
            "plugin_status",
            "plugin_catalogue",
            "plugin_logs",
            "get_plugin_config",
            "check_plugin_update",
            "enable_plugin",
            "disable_plugin",
            "start_plugin",
            "stop_plugin",
            "restart_plugin",
            "catalogue_install",
            "update_plugin",
            "set_plugin_config",
            "uninstall_plugin",
        ):
            setattr(fake, m, AsyncMock(return_value={"success": True}))
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            await list_plugins()
            await plugin_status(id="p1")
            await plugin_catalogue(refresh=False)
            await plugin_logs(id="p1", tail=50)
            await plugin_settings_get(id="p1")
            await plugin_updates(id="p1", refresh=False)
            await plugin_lifecycle("enable", PluginId(id="p1"))
            await plugin_catalogue_install(PluginInstallBody(id="p1", version="2.0.0"))
            await plugin_update(PluginInstallBody(id="p1"))
            await plugin_settings_set(PluginSettingsBody(id="p1", config={"k": 1}, restart=True))
            await plugin_uninstall(PluginUninstallBody(id="p1", delete_data=True))
        fake.enable_plugin.assert_awaited_once_with("p1")
        fake.catalogue_install.assert_awaited_once_with("p1", version="2.0.0")
        fake.set_plugin_config.assert_awaited_once_with("p1", {"k": 1}, restart=True)
        fake.uninstall_plugin.assert_awaited_once_with("p1", delete_data=True)

    @pytest.mark.asyncio
    async def test_plugin_list_preserves_upstream_503(self, test_db, monkeypatch):
        import httpx

        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        request = httpx.Request("GET", "http://node:8000/api/plugins/")
        response = httpx.Response(503, json={"success": False, "error": "unavailable"})
        fake.list_plugins = AsyncMock(
            side_effect=httpx.HTTPStatusError("503", request=request, response=response)
        )
        fake.aclose = AsyncMock()
        from app.routers.openhop import list_plugins

        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            with pytest.raises(HTTPException) as exc:
                await list_plugins()
        assert exc.value.status_code == 503

    @pytest.mark.asyncio
    async def test_plugin_lifecycle_rejects_unknown_verb(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import PluginId, plugin_lifecycle

        with pytest.raises(HTTPException) as exc:
            await plugin_lifecycle("frobnicate", PluginId(id="p1"))
        assert exc.value.status_code == 400


class TestOpenHopPluginProgress:
    @pytest.mark.asyncio
    async def test_progress_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import plugin_progress

        with pytest.raises(HTTPException) as exc:
            await plugin_progress(id="p1", since=0, fresh=False)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_progress_relays_upstream_event_stream(self, test_db, monkeypatch):
        import httpx

        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )

        chunks = [
            b'data: {"type":"connected","id":"p1"}\n\n',
            b'data: {"type":"line","line":"installing"}\n\n',
            b'data: {"type":"done","state":"complete"}\n\n',
        ]

        async def _agen():
            for c in chunks:
                yield c

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/plugins/progress"
            assert request.headers.get("X-API-Key") == "tok"
            return httpx.Response(
                200,
                content=_agen(),
                headers={"Content-Type": "text/event-stream"},
            )

        import app.routers.openhop as mod

        monkeypatch.setattr(mod, "_stream_transport", httpx.MockTransport(handler), raising=False)
        from app.routers.openhop import plugin_progress

        resp = await plugin_progress(id="p1", since=0, fresh=False)
        body = b""
        async for part in resp.body_iterator:
            body += part if isinstance(part, bytes) else part.encode()
        assert b'"type":"connected"' in body
        assert b'"type":"done"' in body


class TestOpenHopConfig:
    @pytest.mark.asyncio
    async def test_config_export_409_when_not_openhop(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        with pytest.raises(HTTPException) as exc:
            await config_export()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_config_export_delegates(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.config_export = AsyncMock(return_value={"success": True, "data": {"config": {}}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            result = await config_export(include_secrets=True)
        assert result["success"] is True
        fake.config_export.assert_awaited_once_with(include_secrets=True)
        fake.aclose.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_config_mode_delegates(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.set_mode = AsyncMock(return_value={"success": True, "mode": "monitor"})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            result = await config_mode(ConfigModeRequest(mode="monitor"))
        assert result["mode"] == "monitor"
        fake.set_mode.assert_awaited_once_with("monitor")

    @pytest.mark.asyncio
    async def test_config_radio_and_import_and_restart_delegate(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.update_radio_config = AsyncMock(
            return_value={"success": True, "data": {"applied": []}}
        )
        fake.config_import = AsyncMock(
            return_value={"success": True, "sections_updated": ["radio"]}
        )
        fake.restart_service = AsyncMock(return_value={"success": True, "message": "ok"})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            r1 = await config_radio(ConfigRadioRequest(params={"tx_power": 22}))
            r2 = await config_import(ConfigImportRequest(config={"radio": {}}, restart_after=False))
            r3 = await config_restart()
        assert r1["success"] is True
        assert r2["sections_updated"] == ["radio"]
        assert r3["message"] == "ok"
        fake.update_radio_config.assert_awaited_once_with({"tx_power": 22})
        fake.config_import.assert_awaited_once_with({"radio": {}}, restart_after=False)
        fake.restart_service.assert_awaited_once_with()
