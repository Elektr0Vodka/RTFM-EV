"""Keep remote CLI secrets out of the logs.

The log ring buffer is served by ``/api/debug``, which users paste into bug
reports, so remote CLI commands that carry a secret (and the replies that echo
one back) must be masked before they are logged.

Secret-bearing commands, per the repeater/room ``CommonCLI`` and OpenHop:

- ``password <pw>`` sets the admin password; the reply echoes it back
  (``password now: <pw>``).
- ``set guest.password <pw>`` / ``get guest.password``.
- ``set prv.key <hex>`` / ``get prv.key``.
"""

import logging
import re

_REDACTED = "***"

# Optional "XX|" correlation tag, then optional leading spaces (the firmware
# skips them), then the secret-bearing keyword. Group 1 keeps everything up to
# and including the separator before the secret value.
_SECRET_ARG_RE = re.compile(
    r"^((?:[0-9A-Fa-f]{2}\|)?\s*(?:password|set\s+guest\.password|set\s+prv\.key)\s+)\S.*$",
    re.DOTALL,
)
_SECRET_COMMAND_RE = re.compile(
    r"^(?:[0-9A-Fa-f]{2}\|)?\s*(?:password\s|(?:get|set)\s+(?:guest\.password|prv\.key)\b)"
)

# meshcore's send_cmd logs ``Sending command to <hex>: <cmd>`` at DEBUG.
_LIBRARY_SEND_CMD_RE = re.compile(r"^(Sending command to [0-9a-fA-F]*: )(.*)$", re.DOTALL)


def redact_cli_command(command: str) -> str:
    """Return ``command`` with any secret argument replaced by ``***``."""
    return _SECRET_ARG_RE.sub(lambda m: m.group(1) + _REDACTED, command)


def is_secret_cli_command(command: str) -> bool:
    """True when the command sets or reads a secret, so its reply may carry one."""
    return _SECRET_COMMAND_RE.match(command) is not None


def redact_cli_reply(command: str, reply: str) -> str:
    """Mask the reply to a secret-bearing command; pass other replies through."""
    return _REDACTED if is_secret_cli_command(command) else reply


class CliSecretRedactFilter(logging.Filter):
    """Redact secrets from the meshcore library's own ``send_cmd`` debug line."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        match = _LIBRARY_SEND_CMD_RE.match(message)
        if match is None:
            return True
        redacted = redact_cli_command(match.group(2))
        if redacted != match.group(2):
            record.msg = match.group(1) + redacted
            record.args = None
        return True
