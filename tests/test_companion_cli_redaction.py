"""Companion 1.18 CLI secrets stay out of the logs."""

import logging

import pytest

from app.log_redaction import (
    CliSecretRedactFilter,
    is_secret_cli_command,
    redact_cli_command,
    redact_cli_reply,
)


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("set pin 123456", "set pin ***"),
        ("set wifi.pwd hunter2 extra", "set wifi.pwd ***"),
        ("0A|set wifi.pwd hunter2", "0A|set wifi.pwd ***"),
        ("set wifi.ssid MyNet", "set wifi.ssid MyNet"),
        ("get wifi.pwd", "get wifi.pwd"),
    ],
)
def test_redact_companion_commands(command, expected):
    assert redact_cli_command(command) == expected


@pytest.mark.parametrize(
    ("command", "secret"),
    [
        ("get wifi.pwd", True),
        ("set wifi.pwd x", True),
        ("set pin 123456", True),
        ("get wifi.ssid", False),
        ("get name", False),
    ],
)
def test_secret_detection(command, secret):
    assert is_secret_cli_command(command) is secret


def test_reply_to_get_wifi_pwd_is_masked():
    assert redact_cli_reply("get wifi.pwd", "> hunter2") == "***"
    assert redact_cli_reply("set pin 123456", "> pin is now 123456") == "***"


def test_library_cli_debug_line_is_redacted():
    record = logging.LogRecord(
        "meshcore", logging.DEBUG, __file__, 1, "Sending cli command: %s", ("set wifi.pwd x",), None
    )
    CliSecretRedactFilter().filter(record)
    assert record.getMessage() == "Sending cli command: set wifi.pwd ***"
