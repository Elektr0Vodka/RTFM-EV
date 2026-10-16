"""Companion command line (MeshCore 1.18, CMD_RUN_CLI_COMMAND 66)."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.routers.radio import RadioCliRequest, run_radio_cli
from app.services.companion_cli import (
    CompanionCliError,
    firmware_supports_cli,
    run_local_cli,
)


@pytest.mark.parametrize(
    ("ver_code", "version", "model", "expected"),
    [
        (14, "v1.18.0", "Heltec V3", True),
        (15, "v1.19.0", "Heltec V3", True),
        (13, "v1.17.1", "Heltec V3", False),
        (None, None, None, False),
        ("14", "v1.18.0", "Heltec V3", False),  # not an int (e.g. a mock)
        (27, "v1.12.0-DMC", "Heltec V3", False),  # meshcomod before 1.18
        (27, "v1.17.0.4", "Heltec V3", False),
        (27, "v1.16.0-touch", "Heltec V3", False),
        (27, None, "Heltec V3", False),
        (27, "v1.18.0.1", "Heltec V3", True),  # meshcomod merged 1.18
        (27, "v1.19.0", "Heltec V3", True),
        (27, "v2.0.0", "Heltec V3", True),
        (14, "v1.18.0", "openHop-Repeater-Companion", False),  # OpenHop
    ],
)
def test_firmware_supports_cli(ver_code, version, model, expected):
    assert firmware_supports_cli(ver_code, version, model) is expected


def _event(event_type, payload):
    event = MagicMock()
    event.type = event_type
    event.payload = payload
    return event


@pytest.mark.asyncio
async def test_run_local_cli_returns_reply_text():
    mc = MagicMock()
    mc.commands.run_cli_command = AsyncMock(
        return_value=_event(EventType.CLI_REPLY, {"text": "> 2"})
    )

    assert await run_local_cli(mc, "get tz.offset") == "> 2"
    mc.commands.run_cli_command.assert_awaited_once_with("get tz.offset")


@pytest.mark.asyncio
async def test_run_local_cli_raises_on_error_event():
    mc = MagicMock()
    mc.commands.run_cli_command = AsyncMock(return_value=_event(EventType.ERROR, {"error_code": 1}))

    with pytest.raises(CompanionCliError):
        await run_local_cli(mc, "get name")


# --- POST /api/radio/cli -------------------------------------------------------


def _operation(mc):
    @asynccontextmanager
    async def _ctx(*_args, **_kwargs):
        yield mc

    return _ctx


@pytest.mark.asyncio
async def test_radio_cli_route_returns_reply():
    mc = MagicMock()
    mc.commands.run_cli_command = AsyncMock(
        return_value=_event(EventType.CLI_REPLY, {"text": "> NodeName"})
    )
    with (
        patch("app.routers.radio.radio_manager") as rm,
        patch("app.routers.radio.radio_cli_supported", return_value=True),
    ):
        rm.require_connected = MagicMock()
        rm.radio_operation = _operation(mc)
        response = await run_radio_cli(RadioCliRequest(command="get name"))

    assert response.command == "get name"
    assert response.reply == "> NodeName"


@pytest.mark.asyncio
async def test_radio_cli_route_409_on_old_firmware():
    with (
        patch("app.routers.radio.radio_manager") as rm,
        patch("app.routers.radio.radio_cli_supported", return_value=False),
    ):
        rm.require_connected = MagicMock()
        with pytest.raises(HTTPException) as exc:
            await run_radio_cli(RadioCliRequest(command="get name"))

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_radio_cli_route_502_on_error_frame():
    mc = MagicMock()
    mc.commands.run_cli_command = AsyncMock(return_value=_event(EventType.ERROR, {}))
    with (
        patch("app.routers.radio.radio_manager") as rm,
        patch("app.routers.radio.radio_cli_supported", return_value=True),
    ):
        rm.require_connected = MagicMock()
        rm.radio_operation = _operation(mc)
        with pytest.raises(HTTPException) as exc:
            await run_radio_cli(RadioCliRequest(command="get name"))

    assert exc.value.status_code == 502


def test_radio_cli_request_length_limits():
    with pytest.raises(ValueError):
        RadioCliRequest(command="x")
    with pytest.raises(ValueError):
        RadioCliRequest(command="x" * 161)
