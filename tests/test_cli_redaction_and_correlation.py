"""Tests for remote CLI secret redaction and reply correlation.

Redaction: remote CLI commands such as ``password <pw>`` and replies such as
``password now: <pw>`` must never reach the logs (the log ring buffer is served
by ``/api/debug``, which users paste into bug reports).

Correlation: repeater/room firmware (and OpenHop) reflect an optional ``XX|``
prefix from the command back at the start of the reply. Tagging each command
lets us drop a late reply that belongs to an earlier command instead of
returning it as the answer to the current one.
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.log_redaction import (
    CliSecretRedactFilter,
    is_secret_cli_command,
    redact_cli_command,
)
from app.models import CommandRequest
from app.radio import radio_manager
from app.repository import ContactRepository
from app.routers import server_control
from app.routers.repeaters import send_repeater_command

KEY_A = "aa" * 32

_MONOTONIC = "app.routers.server_control._monotonic"


@pytest.fixture(autouse=True)
def _reset_radio_state():
    prev = radio_manager._meshcore
    prev_lock = radio_manager._operation_lock
    yield
    radio_manager._meshcore = prev
    radio_manager._operation_lock = prev_lock


def _radio_result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _advancing_clock(start=0.0, step=0.1):
    t = start

    def _tick():
        nonlocal t
        val = t
        t += step
        return val

    return _tick


def _mock_mc():
    mc = MagicMock()
    mc.commands = MagicMock()
    mc.commands.send_cmd = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.commands.get_msg = AsyncMock(return_value=_radio_result(EventType.NO_MORE_MSGS))
    mc.commands.add_contact = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.subscribe = MagicMock(return_value=MagicMock(unsubscribe=MagicMock()))
    mc.stop_auto_message_fetching = AsyncMock()
    mc.start_auto_message_fetching = AsyncMock()
    return mc


def _cli_reply(text: str):
    return _radio_result(
        EventType.CONTACT_MSG_RECV,
        {"pubkey_prefix": KEY_A[:12], "text": text, "txt_type": 1},
    )


async def _insert_contact(public_key: str, name: str = "Repeater", contact_type: int = 2):
    await ContactRepository.upsert(
        {
            "public_key": public_key,
            "name": name,
            "type": contact_type,
            "flags": 0,
            "direct_path": None,
            "direct_path_len": -1,
            "direct_path_hash_mode": -1,
            "last_advert": None,
            "lat": None,
            "lon": None,
            "last_seen": None,
            "on_radio": False,
            "last_contacted": None,
            "first_seen": None,
        }
    )


async def _run_command(mc, command: str):
    with (
        patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch(_MONOTONIC, side_effect=_advancing_clock()),
        patch("app.routers.server_control.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.server_control.drain_pending_messages",
            new_callable=AsyncMock,
            return_value=0,
        ),
    ):
        return await send_repeater_command(KEY_A, CommandRequest(command=command))


def _sent_command(mc) -> str:
    return mc.commands.send_cmd.await_args.args[1]


class TestRedactCliCommand:
    @pytest.mark.parametrize(
        ("command", "expected"),
        [
            ("password hunter2", "password ***"),
            ("set guest.password letmein", "set guest.password ***"),
            ("set prv.key " + "ab" * 64, "set prv.key ***"),
            ("  password hunter2", "  password ***"),
            ("1F|password hunter2", "1F|password ***"),
            ("get name", "get name"),
            ("get guest.password", "get guest.password"),
            ("reboot", "reboot"),
        ],
    )
    def test_redacts_secret_arguments(self, command, expected):
        assert redact_cli_command(command) == expected

    @pytest.mark.parametrize(
        "command",
        [
            "password hunter2",
            "set guest.password x",
            "get guest.password",
            "set prv.key abc",
            "get prv.key",
            "0A|get guest.password",
        ],
    )
    def test_secret_commands_detected(self, command):
        assert is_secret_cli_command(command)

    @pytest.mark.parametrize("command", ["get name", "ver", "set name password"])
    def test_ordinary_commands_not_secret(self, command):
        assert not is_secret_cli_command(command)


class TestLibraryLogFilter:
    def test_filter_redacts_meshcore_send_cmd_debug_line(self):
        record = logging.LogRecord(
            "meshcore",
            logging.DEBUG,
            __file__,
            1,
            "Sending command to %s: %s",
            ("aabbcc", "password hunter2"),
            None,
        )
        assert CliSecretRedactFilter().filter(record) is True
        assert "hunter2" not in record.getMessage()
        assert "password ***" in record.getMessage()

    def test_filter_leaves_other_lines_alone(self):
        record = logging.LogRecord(
            "meshcore", logging.DEBUG, __file__, 1, "Sending command to %s: %s", ("aa", "ver"), None
        )
        CliSecretRedactFilter().filter(record)
        assert record.getMessage() == "Sending command to aa: ver"


class TestCommandLoggingRedaction:
    @pytest.mark.asyncio
    async def test_password_command_and_reply_not_logged(self, test_db, caplog):
        mc = _mock_mc()
        await _insert_contact(KEY_A)

        async def _reply_with_echo(*_args, **_kwargs):
            tag = _sent_command(mc)[:3]
            return _cli_reply(f"{tag}password now: hunter2")

        mc.commands.get_msg = AsyncMock(side_effect=_reply_with_echo)

        with caplog.at_level(logging.DEBUG):
            response = await _run_command(mc, "password hunter2")

        assert "hunter2" not in caplog.text
        # The API caller still gets the real reply (it is the admin's own action).
        assert response.response == "password now: hunter2"
        assert response.command == "password hunter2"


class TestCliReplyCorrelation:
    @pytest.mark.asyncio
    async def test_command_is_sent_with_echo_tag(self, test_db):
        mc = _mock_mc()
        await _insert_contact(KEY_A)
        mc.commands.get_msg = AsyncMock(return_value=_cli_reply("> 52.1"))

        await _run_command(mc, "get lat")

        sent = _sent_command(mc)
        assert len(sent) == len("get lat") + 3
        assert sent[2] == "|"
        assert sent[3:] == "get lat"
        int(sent[:2], 16)  # two hex digits

    @pytest.mark.asyncio
    async def test_echoed_tag_is_stripped_from_reply(self, test_db):
        mc = _mock_mc()
        await _insert_contact(KEY_A)

        async def _reply(*_args, **_kwargs):
            return _cli_reply(f"{_sent_command(mc)[:3]}> 52.1")

        mc.commands.get_msg = AsyncMock(side_effect=_reply)

        response = await _run_command(mc, "get lat")

        assert response.response == "52.1"

    @pytest.mark.asyncio
    async def test_reply_with_other_tag_is_dropped_as_stale(self, test_db):
        """A late reply to an earlier command carries that command's tag and
        must not be returned as this command's answer."""
        mc = _mock_mc()
        await _insert_contact(KEY_A)
        calls = 0

        async def _replies(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            tag = _sent_command(mc)[:3]
            other = "00|" if tag != "00|" else "01|"
            if calls == 1:
                return _cli_reply(f"{other}> stale-name")
            return _cli_reply(f"{tag}> 52.1")

        mc.commands.get_msg = AsyncMock(side_effect=_replies)

        response = await _run_command(mc, "get lat")

        assert response.response == "52.1"

    @pytest.mark.asyncio
    async def test_untagged_reply_still_accepted_for_older_firmware(self, test_db):
        mc = _mock_mc()
        await _insert_contact(KEY_A)
        mc.commands.get_msg = AsyncMock(return_value=_cli_reply("> 52.1"))

        response = await _run_command(mc, "get lat")

        assert response.response == "52.1"

    @pytest.mark.asyncio
    async def test_single_char_command_is_not_tagged(self, test_db):
        """Firmware only strips the tag when the tagged command is > 4 chars."""
        mc = _mock_mc()
        await _insert_contact(KEY_A)
        mc.commands.get_msg = AsyncMock(return_value=_cli_reply("ok"))

        await _run_command(mc, "x")

        assert _sent_command(mc) == "x"

    def test_tags_rotate(self):
        first = server_control._next_cli_echo_tag()
        second = server_control._next_cli_echo_tag()
        assert first != second
        assert first.endswith("|") and second.endswith("|")

    def test_subscription_capture_ignores_stale_tag(self):
        """The subscription path must apply the same tag check as get_msg."""
        assert server_control._reply_matches_tag("0A|> x", "0A|")
        assert server_control._reply_matches_tag("> x", "0A|")
        assert not server_control._reply_matches_tag("0B|> x", "0A|")
        assert server_control._reply_matches_tag("0B|> x", None)
