"""The companion radio's own command line (MeshCore companion firmware 1.18+).

Firmware 1.18 (``FIRMWARE_VER_CODE`` 14) added ``CMD_RUN_CLI_COMMAND`` (66),
answered by ``RESP_CODE_CLI_REPLY`` (29) with the reply text
(``examples/companion_radio/MyMesh.cpp``). It runs on the radio itself, so it
never transmits. The same firmware also accepts ``TXT_TYPE_CLI_COMMAND`` (3)
in ``CMD_SEND_TXT_MSG``, which is what lets us send a command to another
companion; an older radio rejects that text type.
"""

import re

from meshcore import EventType

from app.services.meshcomod import is_meshcomod
from app.services.openhop import is_openhop

COMPANION_CLI_MIN_VER_CODE = 14
COMPANION_CLI_MIN_VERSION = (1, 18)

_VERSION_RE = re.compile(r"v?(\d+)\.(\d+)")


class CompanionCliError(Exception):
    """The radio answered the command with an error frame."""


def _version_at_least(version: str | None, minimum: tuple[int, int]) -> bool:
    match = _VERSION_RE.match((version or "").strip())
    if match is None:
        return False
    return (int(match.group(1)), int(match.group(2))) >= minimum


def firmware_supports_cli(ver_code: object, version: str | None, model: str | None) -> bool:
    """True when the connected companion firmware has the 1.18 command line.

    meshcomod has reported version code 27 since before 1.18, so for it the
    version string decides (``v1.18.0.1`` and later have the command line).
    OpenHop is a Python daemon with its own CLI, so it is excluded.
    """
    if not isinstance(ver_code, int) or isinstance(ver_code, bool):
        return False
    if ver_code < COMPANION_CLI_MIN_VER_CODE:
        return False
    if is_meshcomod(ver_code, version) and not _version_at_least(
        version, COMPANION_CLI_MIN_VERSION
    ):
        return False
    return not is_openhop(model)


def radio_cli_supported() -> bool:
    """``firmware_supports_cli`` for the radio that is connected now."""
    from app.services.radio_runtime import radio_runtime as radio_manager

    return firmware_supports_cli(
        getattr(radio_manager, "firmware_ver_code", None),
        getattr(radio_manager, "firmware_version", None),
        getattr(radio_manager, "device_model", None),
    )


async def run_local_cli(mc, command: str) -> str:
    """Run ``command`` on the connected radio and return its reply text."""
    result = await mc.commands.run_cli_command(command)
    if result.type == EventType.ERROR:
        raise CompanionCliError(f"The radio rejected the command: {result.payload}")
    return str((result.payload or {}).get("text", ""))
