"""The companion radio's own command line (MeshCore companion firmware 1.18+).

Firmware 1.18 (``FIRMWARE_VER_CODE`` 14) added ``CMD_RUN_CLI_COMMAND`` (66),
answered by ``RESP_CODE_CLI_REPLY`` (29) with the reply text
(``examples/companion_radio/MyMesh.cpp``). It runs on the radio itself, so it
never transmits. The same firmware also accepts ``TXT_TYPE_CLI_COMMAND`` (3)
in ``CMD_SEND_TXT_MSG``, which is what lets us send a command to another
companion; an older radio rejects that text type.

meshcomod keeps its own commands (wifi, tcp, ble, ota, status, ...) out of
that command line: ``MyMesh::handleMeshcomodCommand`` only runs them for a DM
to its "Meshcomod" command contact, and the 1.18 command line answers them
with "Unknown command". So on meshcomod the console sends those as a DM to
that contact and collects the DMs it answers with.
"""

import asyncio
import re
from collections.abc import Awaitable, Callable

from meshcore import EventType

from app.meshcomod_contact import MESHCOMOD_COMMAND_CONTACT_PREFIX
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


# First words handleMeshcomodCommand runs and the 1.18 command line does not
# know (examples/companion_radio/MyMesh.cpp, kMeshcomodHelpMsg). ``ok`` and
# ``cancel`` answer the confirmation that ``tcp off`` and ``ble off`` ask for.
# ver, clock, get, set, reboot and advert are in both; they stay on the command line.
MESHCOMOD_CONTACT_COMMANDS = frozenset(
    {"help", "status", "mac", "ota", "wifi", "tcp", "ble", "ok", "cancel"}
)
# These flash the radio from inside the command handler, which keeps it from
# handing over its reply until the flash ends (or it reboots).
_MESHCOMOD_FLASH_COMMANDS = frozenset({"update", "url"})

# wifi scan and ota check go to the network before they answer.
MESHCOMOD_FIRST_REPLY_TIMEOUT = 15.0
# A long reply comes as several DMs right after each other.
MESHCOMOD_QUIET_SECONDS = 1.5
MESHCOMOD_MAX_WAIT = 20.0

MESHCOMOD_NO_REPLY_TEXT = (
    "(no reply from meshcomod yet; a late reply lands in the Meshcomod conversation)"
)
MESHCOMOD_FLASH_NO_REPLY_TEXT = (
    "(OTA started: the radio answers once the flash ends, in the Meshcomod conversation. "
    "It reboots when the update succeeds.)"
)


def _words(command: str) -> list[str]:
    return command.lower().split()


def routes_to_meshcomod_contact(command: str, ver_code: object, version: str | None) -> bool:
    """True when ``command`` must go to meshcomod's command contact, not the command line."""
    words = _words(command)
    return (
        bool(words)
        and words[0] in MESHCOMOD_CONTACT_COMMANDS
        and is_meshcomod(ver_code if isinstance(ver_code, int) else None, version)
    )


def is_meshcomod_flash_command(command: str) -> bool:
    """``ota update`` / ``ota url <url>``: the reply may only come after the flash."""
    words = _words(command)
    return len(words) >= 2 and words[0] == "ota" and words[1] in _MESHCOMOD_FLASH_COMMANDS


async def collect_meshcomod_replies(
    mc,
    send: Callable[[], Awaitable[object]],
    *,
    first_reply_timeout: float | None = None,
    quiet_seconds: float | None = None,
    max_wait: float | None = None,
    stop_after_first: bool = False,
) -> list[str]:
    """Run ``send`` and return the texts of the DMs the command contact answers with.

    Listens only: the radio announces the replies with ``MSG_WAITING`` and the
    usual message fetch pulls them, so they are stored in the Meshcomod
    conversation as before and nothing here holds the radio lock. The listener
    is in place before ``send`` runs, so a fast reply is not missed. Waits up to
    ``first_reply_timeout`` for the first reply, then stops once no further
    reply came for ``quiet_seconds`` (or right away with ``stop_after_first``),
    never longer than ``max_wait`` in total. Unset waits use the module defaults.
    """
    first_reply_timeout = first_reply_timeout or MESHCOMOD_FIRST_REPLY_TIMEOUT
    quiet_seconds = quiet_seconds or MESHCOMOD_QUIET_SECONDS
    max_wait = max_wait or MESHCOMOD_MAX_WAIT
    queue: asyncio.Queue[str] = asyncio.Queue()

    def _capture(event) -> None:
        payload = event.payload or {}
        if payload.get("txt_type", 0) == 0:
            queue.put_nowait(str(payload.get("text", "")))

    subscription = mc.subscribe(
        EventType.CONTACT_MSG_RECV,
        _capture,
        attribute_filters={"pubkey_prefix": MESHCOMOD_COMMAND_CONTACT_PREFIX},
    )
    try:
        await send()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + max_wait
        replies: list[str] = []
        wait = first_reply_timeout
        while True:
            timeout = min(wait, deadline - loop.time())
            if timeout <= 0:
                break
            try:
                replies.append(await asyncio.wait_for(queue.get(), timeout))
            except TimeoutError:
                break
            if stop_after_first:
                break
            wait = quiet_seconds
        return replies
    finally:
        subscription.unsubscribe()


async def run_meshcomod_contact_command(
    mc, command: str, send: Callable[[], Awaitable[object]]
) -> str:
    """Send ``command`` to meshcomod's command contact and return its reply text."""
    flash = is_meshcomod_flash_command(command)
    replies = await collect_meshcomod_replies(mc, send, stop_after_first=flash)
    if replies:
        return "\n".join(replies)
    return MESHCOMOD_FLASH_NO_REPLY_TEXT if flash else MESHCOMOD_NO_REPLY_TEXT
