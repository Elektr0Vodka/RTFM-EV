"""Companion command line (MeshCore 1.18, CMD_RUN_CLI_COMMAND 66)."""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.meshcomod_contact import MESHCOMOD_COMMAND_CONTACT_KEY, MESHCOMOD_COMMAND_CONTACT_PREFIX
from app.routers.radio import RadioCliRequest, run_radio_cli
from app.services.companion_cli import (
    MESHCOMOD_FLASH_NO_REPLY_TEXT,
    MESHCOMOD_NO_REPLY_TEXT,
    CompanionCliError,
    collect_meshcomod_replies,
    firmware_supports_cli,
    is_meshcomod_flash_command,
    routes_to_meshcomod_contact,
    run_local_cli,
    run_meshcomod_contact_command,
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


# --- meshcomod command contact -------------------------------------------------

MESHCOMOD_VERSION = "v1.18.0.1-pre4-5c01ff2-dmc-filter"


@pytest.mark.parametrize(
    ("command", "ver_code", "version", "expected"),
    [
        ("ota check", 27, MESHCOMOD_VERSION, True),
        ("  OTA status", 27, MESHCOMOD_VERSION, True),
        ("help", 27, MESHCOMOD_VERSION, True),
        ("wifi scan", 27, MESHCOMOD_VERSION, True),
        ("tcp off", 27, MESHCOMOD_VERSION, True),
        ("ble status", 27, MESHCOMOD_VERSION, True),
        ("status", 27, MESHCOMOD_VERSION, True),
        ("mac", 27, MESHCOMOD_VERSION, True),
        ("ok", 27, MESHCOMOD_VERSION, True),
        ("cancel", 27, MESHCOMOD_VERSION, True),
        ("status", None, "v1.18.0.1-DMC", True),  # the version string alone
        # The 1.18 command line has these, also on meshcomod.
        ("ver", 27, MESHCOMOD_VERSION, False),
        ("get name", 27, MESHCOMOD_VERSION, False),
        ("set wifi.pwd x", 27, MESHCOMOD_VERSION, False),
        ("wifi.apply", 27, MESHCOMOD_VERSION, False),
        ("filter on", 27, MESHCOMOD_VERSION, False),
        ("reboot", 27, MESHCOMOD_VERSION, False),
        ("clock", 27, MESHCOMOD_VERSION, False),
        ("board", 27, MESHCOMOD_VERSION, False),
        # Stock firmware has no command contact.
        ("ota check", 14, "v1.18.0", False),
        ("help", 14, "v1.18.0", False),
        ("help", "27", None, False),  # not an int (e.g. a mock)
    ],
)
def test_routes_to_meshcomod_contact(command, ver_code, version, expected):
    assert routes_to_meshcomod_contact(command, ver_code, version) is expected


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("ota update", True),
        ("OTA url https://example.com/fw.bin", True),
        ("ota check", False),
        ("ota status", False),
        ("ota", False),
        ("wifi update", False),
    ],
)
def test_is_meshcomod_flash_command(command, expected):
    assert is_meshcomod_flash_command(command) is expected


class _FakeMeshcore:
    """Stands in for the meshcore dispatcher: records the subscription, replays DMs."""

    def __init__(self):
        self.callbacks = []
        self.filters = None
        self.unsubscribed = False

    def subscribe(self, event_type, callback, attribute_filters=None):
        assert event_type == EventType.CONTACT_MSG_RECV
        self.filters = attribute_filters
        self.callbacks.append(callback)
        subscription = MagicMock()
        subscription.unsubscribe.side_effect = lambda: setattr(self, "unsubscribed", True)
        return subscription

    def reply(self, text, txt_type=0):
        payload = {
            "pubkey_prefix": MESHCOMOD_COMMAND_CONTACT_PREFIX,
            "txt_type": txt_type,
            "text": text,
        }
        for callback in self.callbacks:
            callback(_event(EventType.CONTACT_MSG_RECV, payload))


def _replying_send(mc, *texts, delay=0.01):
    """A send whose replies arrive shortly after it returns, like the firmware's."""

    async def send():
        loop = asyncio.get_running_loop()
        for index, text in enumerate(texts):
            loop.call_later(delay * (index + 1), mc.reply, text)

    return send


@pytest.mark.asyncio
async def test_collect_joins_multi_part_reply_and_stops_when_quiet():
    mc = _FakeMeshcore()
    send = _replying_send(
        mc,
        "warning: turning TCP off may remove wireless access to this companion.",
        "if BLE is also off, you will need physical USB access.",
        "reply 'ok' within 30s to confirm, or 'cancel'.",
    )

    loop = asyncio.get_running_loop()
    started = loop.time()
    replies = await collect_meshcomod_replies(
        mc, send, first_reply_timeout=2.0, quiet_seconds=0.1, max_wait=5.0
    )

    assert len(replies) == 3
    assert replies[2] == "reply 'ok' within 30s to confirm, or 'cancel'."
    assert loop.time() - started < 1.0  # ended on the quiet gap, not max_wait
    assert mc.filters == {"pubkey_prefix": MESHCOMOD_COMMAND_CONTACT_PREFIX}
    assert mc.unsubscribed


@pytest.mark.asyncio
async def test_collect_catches_a_reply_sent_during_the_send():
    mc = _FakeMeshcore()

    async def send():
        mc.reply("ota: idle")  # the listener must already be in place

    replies = await collect_meshcomod_replies(mc, send, first_reply_timeout=1.0, quiet_seconds=0.05)

    assert replies == ["ota: idle"]


@pytest.mark.asyncio
async def test_collect_ignores_cli_replies_and_times_out_empty():
    mc = _FakeMeshcore()

    async def send():
        mc.reply("> stale", txt_type=1)

    replies = await collect_meshcomod_replies(mc, send, first_reply_timeout=0.1)

    assert replies == []
    assert mc.unsubscribed


@pytest.mark.asyncio
async def test_collect_never_waits_past_max_wait():
    mc = _FakeMeshcore()
    send = _replying_send(mc, *[f"line {i}" for i in range(50)], delay=0.03)

    loop = asyncio.get_running_loop()
    started = loop.time()
    replies = await collect_meshcomod_replies(
        mc, send, first_reply_timeout=1.0, quiet_seconds=0.5, max_wait=0.2
    )

    assert loop.time() - started < 0.5
    assert 0 < len(replies) < 50


@pytest.mark.asyncio
async def test_collect_unsubscribes_when_the_send_fails():
    mc = _FakeMeshcore()

    async def send():
        raise HTTPException(status_code=422, detail="Failed to send message")

    with pytest.raises(HTTPException):
        await collect_meshcomod_replies(mc, send)
    assert mc.unsubscribed


@pytest.mark.asyncio
async def test_flash_command_returns_on_first_reply():
    mc = _FakeMeshcore()
    send = _replying_send(mc, "update available: v1.18.0.2", "OTA: connecting", delay=0.05)

    reply = await run_meshcomod_contact_command(mc, "ota update", send)

    assert reply == "update available: v1.18.0.2"


@pytest.mark.asyncio
async def test_no_reply_texts():
    async def send():
        return None

    with patch("app.services.companion_cli.collect_meshcomod_replies", AsyncMock(return_value=[])):
        assert await run_meshcomod_contact_command(_FakeMeshcore(), "status", send) == (
            MESHCOMOD_NO_REPLY_TEXT
        )
        assert await run_meshcomod_contact_command(_FakeMeshcore(), "ota url x", send) == (
            MESHCOMOD_FLASH_NO_REPLY_TEXT
        )


def _meshcomod_radio_manager(rm, mc):
    rm.require_connected = MagicMock()
    rm.firmware_ver_code = 27
    rm.firmware_version = MESHCOMOD_VERSION
    rm.meshcore = mc
    rm.radio_operation = _operation(mc)


@pytest.mark.asyncio
async def test_radio_cli_route_sends_meshcomod_command_as_dm():
    mc = _FakeMeshcore()
    mc.commands = MagicMock()
    mc.commands.run_cli_command = AsyncMock()

    async def fake_send(**_kwargs):
        mc.reply("no update: v1.18.0.1-pre4 is current")

    send_dm = AsyncMock(side_effect=fake_send)
    with (
        patch("app.routers.radio.radio_manager") as rm,
        patch("app.routers.radio.radio_cli_supported", return_value=True),
        patch("app.routers.radio.ContactRepository.get_by_key", AsyncMock(return_value=None)),
        patch("app.routers.radio.send_direct_message_to_contact", send_dm),
        patch("app.services.companion_cli.MESHCOMOD_QUIET_SECONDS", 0.05),
    ):
        _meshcomod_radio_manager(rm, mc)
        response = await run_radio_cli(RadioCliRequest(command="ota check"))

    assert response.reply == "no update: v1.18.0.1-pre4 is current"
    mc.commands.run_cli_command.assert_not_awaited()
    kwargs = send_dm.await_args.kwargs
    assert kwargs["text"] == "ota check"
    assert kwargs["contact"].public_key == MESHCOMOD_COMMAND_CONTACT_KEY
    assert kwargs["radio_manager"] is rm


@pytest.mark.asyncio
async def test_radio_cli_route_keeps_stock_commands_on_the_command_line():
    mc = MagicMock()
    mc.commands.run_cli_command = AsyncMock(
        return_value=_event(EventType.CLI_REPLY, {"text": "> v1.18.0.1"})
    )
    send_dm = AsyncMock()
    with (
        patch("app.routers.radio.radio_manager") as rm,
        patch("app.routers.radio.radio_cli_supported", return_value=True),
        patch("app.routers.radio.send_direct_message_to_contact", send_dm),
    ):
        _meshcomod_radio_manager(rm, mc)
        response = await run_radio_cli(RadioCliRequest(command="ver"))

    assert response.reply == "> v1.18.0.1"
    send_dm.assert_not_awaited()
