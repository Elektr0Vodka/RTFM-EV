"""The text command line of a repeater or room server on a cable (plan 32, Phase 3).

A repeater or room server answers a text command line on its USB serial
port. A line ``<command>\\r`` is echoed and answered with
``  -> <reply>\\r\\n`` (``examples/simple_repeater/main.cpp``); ``get <key>``
answers ``> <value>``, ``set <key> <value>`` answers ``OK`` or an error.

This module holds the rules only. It never opens a port: the browser (or,
later, the server) sends the commands and hands the replies back, as a map
of command to reply (``None`` for a command the device did not answer).

- ``read_commands`` says which commands are still needed to read a device.
  It works in rounds: what is asked next depends on the firmware version and
  on the features the device answers to.
- ``read_device`` builds the config file from the replies, in the format the
  Dutch MeshCore toolbox's USB config page writes, so a stored snapshot is a
  file the toolbox reads again.
- ``plan_apply`` turns a stored config into the ``set`` commands that make
  the device match it, one per setting, each with the read-back that proves
  it took.
- ``check_step`` decides whether a command's reply and its read-back are
  what was expected.

Commands and reply formats come from the firmware source (stock
``src/helpers/CommonCLI.cpp``, DMC ``examples/simple_repeater/Filter.cpp`` and
``src/helpers/CommonCLI_Observer.cpp``) and the file format from the toolbox
source; no code is taken from the toolbox, which has no licence file.

What is never sent: ``erase``, ``reboot``, ``advert`` or anything else that
is not in ``ALLOWED_COMMANDS``; the region tree is not rewritten (it would
mean removing every region first).
"""

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from app.decoder import derive_public_key
from app.services import fleet_config

# --- what may be sent ---------------------------------------------------------

# The first word of every command this app sends over the cable, and for
# ``region`` and ``filter`` the second. Everything else is refused, so a
# stored document can never make the app send ``erase``, ``reboot`` or a
# command that transmits (``advert``, ``discover.neighbors``).
ALLOWED_COMMANDS = ("ver", "board", "get", "set", "filter", "region")
_REGION_SUBCOMMANDS = ("", "home", "default", "save")
_FILTER_SUBCOMMANDS = ("", "hops", "rate", "channel", "hash", "malformed", "on", "off")
# ``set freq`` is the old serial-only way to change the frequency; the radio
# is set with ``set radio`` so it goes through the radio tick.
_REFUSED_SET_KEYS = ("freq",)
# The firmware reads a command line into 160 bytes (``static char command[160]``).
MAX_COMMAND_LENGTH = 159


class DeviceCliError(ValueError):
    """The device's replies or a document cannot be used. Shown to the user."""


class DeviceMismatchError(DeviceCliError):
    """The device on the cable is not the asset the config belongs to."""


def command_allowed(command: str) -> bool:
    """Whether ``command`` is one this app may send over the cable."""
    if not command or command != command.strip() or len(command) > MAX_COMMAND_LENGTH:
        return False
    if any(char in command for char in "\r\n\0"):
        return False
    words = command.split(" ")
    head = words[0]
    if head not in ALLOWED_COMMANDS:
        return False
    sub = words[1] if len(words) > 1 else ""
    if head == "region":
        return sub in _REGION_SUBCOMMANDS
    if head == "filter":
        if sub not in _FILTER_SUBCOMMANDS:
            return False
        if sub == "channel":
            return len(words) > 2 and words[2] in ("list", "add", "remove")
        return True
    if head in ("get", "set"):
        if not sub:
            return False
        return not (head == "set" and sub in _REFUSED_SET_KEYS)
    return len(words) == 1


# --- reply helpers ------------------------------------------------------------

_NUMBER = re.compile(r"-?\d+(\.\d+)?")
# Bounded digit runs: searching a long run of digits stays linear (CodeQL
# polynomial-redos); a version part never has more than a few digits.
_VERSION = re.compile(r"v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})")
_HEX_KEY = re.compile(r"[0-9a-f]{64}")
_PRIVATE_KEY = re.compile(r"[0-9a-fA-F]{128}")
# A value that is not there: no stored secret, or a read-back that shows nothing.
_MISSING = object()


def _stripped(reply: str | None) -> str:
    return (reply or "").strip()


def get_value(reply: str | None) -> str | None:
    """The value of a ``> value`` reply, or None when the reply is something else."""
    text = _stripped(reply)
    if not text.startswith("> "):
        return None
    return text[2:].strip()


def _number(value: float) -> int | float:
    """A float as JSON writes it in a browser: 20.0 is 20."""
    if math.isfinite(value) and value.is_integer() and abs(value) < 2**53:
        return int(value)
    return value


def _scalar(text: str) -> Any:
    """A reply value as the toolbox reads it: number, on/off as a boolean, else text."""
    if text == "":
        return ""
    if _NUMBER.fullmatch(text):
        return _number(float(text))
    lowered = text.lower()
    if lowered == "on":
        return True
    if lowered == "off":
        return False
    return text


def _as_text(value: Any) -> str:
    """``String(value)`` in a browser."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return str(_number(value)) if math.isfinite(value) else "NaN"
    return str(value)


def _js_round(value: float, digits: int) -> int | float:
    """``Math.round(value * 10**digits) / 10**digits``."""
    factor = 10**digits
    return _number(math.floor(value * factor + 0.5) / factor)


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str) and _NUMBER.fullmatch(value.strip()):
        return float(value.strip())
    return None


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("on", "true", "1"):
            return True
        if lowered in ("off", "false", "0"):
            return False
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    return None


def parse_version(reply: str | None) -> tuple[int, int, int]:
    match = _VERSION.search(_stripped(reply))
    if not match:
        return (0, 0, 0)
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _onoff(value: bool) -> str:
    return "on" if value else "off"


# --- vars ---------------------------------------------------------------------

# The CLI variables the toolbox file holds in ``vars``, in its order, with the
# type its reader gives them. ``prv.key`` is added after these when the device
# answers it.
VAR_KEYS: tuple[tuple[str, str], ...] = (
    ("name", "text"),
    ("repeat", "bool"),
    ("allow.read.only", "bool"),
    ("radio", "radio"),
    ("tx", "number"),
    ("af", "number"),
    ("rxdelay", "number"),
    ("txdelay", "number"),
    ("direct.txdelay", "number"),
    ("flood.max", "number"),
    ("flood.advert.interval", "number"),
    ("advert.interval", "number"),
    ("guest.password", "text"),
    ("lat", "number"),
    ("lon", "number"),
    ("int.thresh", "number"),
    ("agc.reset.interval", "number"),
    ("multi.acks", "text"),
    ("owner.info", "text"),
    ("path.hash.mode", "text"),
    ("loop.detect", "text"),
    ("cad", "bool"),
    ("flood.max.unscoped", "number"),
    ("flood.max.advert", "number"),
    ("radio.rxgain", "bool"),
    ("adc.multiplier", "number"),
)
_VAR_KIND: dict[str, str] = dict(VAR_KEYS)
# Keys older firmware does not have; the toolbox does not ask for them there.
VAR_MIN_VERSION: dict[str, tuple[int, int, int]] = {
    "owner.info": (1, 12, 0),
    "path.hash.mode": (1, 14, 0),
    "loop.detect": (1, 14, 0),
}
_DELAY_KEYS = ("rxdelay", "txdelay", "direct.txdelay")
_POSITION_KEYS = ("lat", "lon")
PRIVATE_KEY = "prv.key"
_SECRET_VARS = ("guest.password", PRIVATE_KEY)
_REBOOT_VARS = ("radio", PRIVATE_KEY)


def _js_to_number(value: Any) -> float:
    """``Number(value)`` in a browser."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text == "":
        return 0.0
    try:
        return float(text)
    except ValueError:
        return math.nan


def read_var(key: str, reply: str | None) -> tuple[bool, Any]:
    """``(present, value)`` of one ``get <key>`` reply, as the toolbox file holds it."""
    kind = _VAR_KIND.get(key, "text")
    text = get_value(reply)
    value: Any = None if text is None else _scalar(text)
    if value is None:
        return (True, "") if kind == "text" else (False, None)
    if kind == "bool" and not isinstance(value, bool):
        # radio.rxgain on a board without it falls through to the radio reply.
        return False, None
    if key == "radio":
        parts = _as_text(value).split(",")
        freq = _to_float(parts[0])
        if freq is None:
            return False, None
        bw = parts[1].replace(".0", "", 1) if len(parts) > 1 else "125"
        sf = parts[2] if len(parts) > 2 else "9"
        cr = parts[3] if len(parts) > 3 else "5"
        value = {"freq": f"{freq:.3f}", "bw": bw, "sf": sf, "cr": cr}
    elif key == "owner.info":
        value = _as_text(value).replace("|", "\n")
    elif key in _DELAY_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool):
        value = _js_round(float(value), 1)
    elif key in _POSITION_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool):
        value = _js_round(float(value), 5)
    elif key == "loop.detect":
        value = "off" if value is False else _as_text(value)
    elif key == "multi.acks":
        value = _as_text(_number(_js_to_number(value)))
    return True, value


def _var_wanted(version: tuple[int, int, int], key: str) -> bool:
    needed = VAR_MIN_VERSION.get(key)
    return needed is None or version >= needed


def _same_radio(want: Any, have: Any) -> bool:
    if not isinstance(want, dict) or not isinstance(have, dict):
        return False
    pairs = (("freq", 0.0005), ("bw", 0.0005), ("sf", 0.0), ("cr", 0.0))
    for part, tolerance in pairs:
        a, b = _to_float(want.get(part)), _to_float(have.get(part))
        if a is None or b is None or abs(a - b) > tolerance + 1e-9:
            return False
    return True


def same_var(key: str, want: Any, have: Any) -> bool:
    """Whether the device's value ``have`` is the file's ``want`` for one variable."""
    if key == "radio":
        return _same_radio(want, have)
    if _VAR_KIND.get(key) == "bool":
        return _as_bool(want) is not None and _as_bool(want) == _as_bool(have)
    if key == "owner.info":
        return _as_text(want).replace("|", "\n") == _as_text(have).replace("|", "\n")
    a, b = _to_float(want), _to_float(have)
    if a is not None and b is not None:
        tolerance = 0.000005 if key in _POSITION_KEYS else 1e-6
        return abs(a - b) <= tolerance + 1e-9
    if key == PRIVATE_KEY:
        return _as_text(want).lower() == _as_text(have).lower()
    return _as_text(want) == _as_text(have)


def _radio_text(want: Any) -> str | None:
    """``freq,bw,sf,cr`` for ``set radio``, or None when the values are out of range."""
    if not isinstance(want, dict):
        return None
    freq, bw = _to_float(want.get("freq")), _to_float(want.get("bw"))
    sf, cr = _to_float(want.get("sf")), _to_float(want.get("cr"))
    if freq is None or bw is None or sf is None or cr is None:
        return None
    # The firmware's own limits (``set radio`` in CommonCLI.cpp).
    if not (150 <= freq <= 2500 and 7 <= bw <= 500 and 5 <= sf <= 12 and 5 <= cr <= 8):
        return None
    if not (sf.is_integer() and cr.is_integer()):
        return None
    return f"{_as_text(_number(freq))},{_as_text(_number(bw))},{int(sf)},{int(cr)}"


def _var_text(key: str, want: Any) -> str | None:
    """The value as ``set <key>`` takes it, or None when it cannot be sent."""
    if key == "radio":
        return _radio_text(want)
    if _VAR_KIND.get(key) == "bool":
        flag = _as_bool(want)
        return None if flag is None else _onoff(flag)
    if isinstance(want, (dict, list)) or want is None:
        return None
    text = _as_text(want)
    if key == "owner.info":
        text = text.replace("\r\n", "\n").replace("\n", "|")
    if text == "" and key != "owner.info":
        return None
    if any(char in text for char in "\r\n\0"):
        return None
    return text


# --- filter (DMC repeater) ----------------------------------------------------

FILTER_TYPE_COUNT = 12
FILTER_COMMANDS = (
    "filter hops",
    "filter rate",
    "filter channel list",
    "filter hash",
    "filter malformed",
)
_FILTER_STATUS = re.compile(r"Filter\s+(?:on|off):\s*Blocked", re.IGNORECASE)
_FILTER_ENABLED = re.compile(r"Filter:?\s+(on|off)\b", re.IGNORECASE)
_FILTER_HOPS = re.compile(r"^\s*(\d{1,2})\s*:\s*(\d+)\s*$")
# This firmware adds a third number, the soft limit; the file does not hold it.
_FILTER_RATE = re.compile(r"^\s*(\d{1,2})\s*:\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*$")
_FILTER_HASH = re.compile(r"minimal\s+(\d+)\s+bytes", re.IGNORECASE)
_FILTER_MALFORMED = re.compile(r"scan\s+(on|off)\b", re.IGNORECASE)
# Anchored at the end of a stripped part, with no leading \s*: a long run of
# spaces in a reply must not make the search backtrack (CodeQL polynomial-redos).
_FILTER_CHANNEL_HASH = re.compile(r"\([0-9a-fA-F]{1,2}\)$")
_FILTER_OK = re.compile(
    r"^>?\s*Filter:\s*(OK|on|off|channel \S+ (added|removed)|malformed scan (on|off))\s*$",
    re.IGNORECASE,
)


def is_filter_status(reply: str | None) -> bool:
    return bool(_FILTER_STATUS.search(reply or ""))


def _filter_defaults() -> dict[str, Any]:
    per_type = [{"hops": 8, "rateLimit": 5, "rateSecs": 60} for _ in range(FILTER_TYPE_COUNT)]
    per_type[5]["hops"] = 32
    per_type[2]["rateLimit"] = 20
    per_type[4]["rateLimit"] = 10
    per_type[5]["rateLimit"] = 20
    return {
        "enabled": False,
        "perType": per_type,
        "channels": [],
        "minHashBytes": 1,
        "malformed": False,
    }


def _filter_lines(reply: str | None, pattern: re.Pattern[str]) -> dict[int, re.Match[str]]:
    out: dict[int, re.Match[str]] = {}
    for line in (reply or "").split("\n"):
        match = pattern.match(line.rstrip("\r"))
        if match:
            out[int(match.group(1))] = match
    return out


def filter_soft_limits(reply: str | None) -> dict[int, int]:
    """The soft limit per packet type from ``filter rate``, where the firmware shows one."""
    return {
        index: int(match.group(4))
        for index, match in _filter_lines(reply, _FILTER_RATE).items()
        if match.group(4) is not None
    }


def _filter_channels(reply: str | None) -> list[str]:
    body = re.sub(r"^>\s*", "", _stripped(reply)).strip()
    if not body or body.lower() == "none":
        return []
    names = (_without_channel_hash(part) for part in body.split(","))
    return [name for name in names if name]


def _without_channel_hash(part: str) -> str:
    """``#test (a1)`` -> ``#test``: the channel hash the firmware adds is dropped."""
    text = part.strip()
    match = _FILTER_CHANNEL_HASH.search(text)
    return text[: match.start()].rstrip() if match else text


def read_filter(replies: dict[str, str | None]) -> dict[str, Any]:
    """The ``filter`` section from the replies of the filter commands."""
    section = _filter_defaults()
    enabled = _FILTER_ENABLED.search(replies.get("filter") or "")
    section["enabled"] = bool(enabled) and enabled.group(1).lower() == "on"
    hops = _filter_lines(replies.get("filter hops"), _FILTER_HOPS)
    rates = _filter_lines(replies.get("filter rate"), _FILTER_RATE)
    for index in range(FILTER_TYPE_COUNT):
        if index in hops:
            section["perType"][index]["hops"] = int(hops[index].group(2))
        if index in rates:
            section["perType"][index]["rateLimit"] = int(rates[index].group(2))
            section["perType"][index]["rateSecs"] = int(rates[index].group(3))
    section["channels"] = _filter_channels(replies.get("filter channel list"))
    hash_bytes = _FILTER_HASH.search(replies.get("filter hash") or "")
    if hash_bytes:
        section["minHashBytes"] = int(hash_bytes.group(1))
    malformed = _FILTER_MALFORMED.search(replies.get("filter malformed") or "")
    section["malformed"] = bool(malformed) and malformed.group(1).lower() == "on"
    return section


# --- region ---------------------------------------------------------------------

_REGION_SKIP = re.compile(r"unknown command|error|-none-", re.IGNORECASE)
# Replies " home is [now] <name>" and " default scope is [now] <name>",
# read with plain string handling (no backtracking on a long reply).
_REGION_HOME = "home is"
_REGION_DEFAULT = "default scope is"
# The firmware writes the region dump into a 160-byte reply and stops there.
_REGION_DUMP_FULL = 150


def region_supported(reply: str | None) -> bool:
    text = reply or ""
    return not re.search("unknown command", text, re.IGNORECASE) and "*" in text


def parse_region_tree(reply: str | None) -> dict[str, Any]:
    """The ``region`` dump as a tree: one space of indent per level, ``F`` = flood allowed."""
    root: dict[str, Any] = {"name": "*", "flood": False, "children": []}
    stack: list[dict[str, Any] | None] = []
    for raw in (reply or "").split("\n"):
        line = raw.rstrip("\r")
        if not line.strip() or _REGION_SKIP.search(line):
            continue
        depth = len(line) - len(line.lstrip())
        body = line.strip()
        flood = len(body) > 1 and body.endswith("F") and body[-2].isspace()
        if flood:
            body = body[:-1].rstrip()
        name = body.rstrip("^").removeprefix("#").strip()
        if not name:
            continue
        if name == "*":
            root["flood"] = flood
            stack = [root]
            continue
        node: dict[str, Any] = {"name": name, "flood": flood, "children": []}
        parent = stack[depth - 1] if 1 <= depth <= len(stack) else None
        (parent or root)["children"].append(node)
        while len(stack) <= depth:
            stack.append(None)
        stack[depth] = node
        del stack[depth + 1 :]
    return root


def region_names(tree: dict[str, Any]) -> set[str]:
    names: set[str] = set()

    def walk(node: dict[str, Any]) -> None:
        for child in node["children"]:
            names.add(child["name"])
            walk(child)

    walk(tree)
    return names


def tree_to_def(root: dict[str, Any]) -> str:
    """The tree as the space-separated ``def`` text of the file (``X|Y`` jumps back to Y)."""
    tokens: list[str] = []

    def emit(node: dict[str, Any]) -> None:
        children = node["children"]
        for index, child in enumerate(children):
            tokens.append(child["name"])
            emit(child)
            if index != len(children) - 1:
                tokens[-1] += f"|{node['name']}"

    emit(root)
    return " ".join(tokens)


def _region_value(reply: str | None, marker: str, unset: str) -> str | None:
    """The name after ``marker`` (an optional ``now`` skipped), or None when unset."""
    text = reply or ""
    at = text.lower().find(marker)
    rest = text[at + len(marker) :] if at >= 0 else ""
    if not rest[:1].isspace():
        return None
    words = rest.split()
    if len(words) > 1 and words[0].lower() == "now":
        words = words[1:]
    value = " ".join(words)
    if not value or value == unset:
        return None
    return value.removeprefix("#")


def read_region(replies: dict[str, str | None]) -> dict[str, Any]:
    """The ``region`` section: ``{def, home, default}``."""
    tree = parse_region_tree(replies.get("region"))
    return {
        "def": tree_to_def(tree),
        "home": _region_value(replies.get("region home"), _REGION_HOME, "*") or "",
        "default": _region_value(replies.get("region default"), _REGION_DEFAULT, "<null>") or "",
    }


# --- hardware -------------------------------------------------------------------

HARDWARE_KEYS = (
    "bridge.type",
    "bridge.enabled",
    "bridge.delay",
    "bridge.source",
    "bridge.baud",
    "bridge.channel",
    "bridge.secret",
    "radio.fem.rxgain",
    "radio.fem.txgain",
    "extra.sf",
)
_BRIDGE_MAX_BAUD = 115200


def _strip_prompt(reply: str | None) -> str:
    return re.sub(r"^>\s?", "", _stripped(reply)).strip()


def _first_int(reply: str | None) -> int:
    match = re.search(r"-?\d+", _strip_prompt(reply))
    return int(match.group(0)) if match else 0


def _is_onoff(reply: str | None) -> bool:
    return _strip_prompt(reply).lower() in ("on", "off")


def _is_on(reply: str | None) -> bool:
    return _strip_prompt(reply).lower() == "on"


def read_hardware(replies: dict[str, str | None]) -> dict[str, Any]:
    """The ``hardware`` section; each ``...Supported`` flag says what this build has."""

    def get(key: str) -> str | None:
        return replies.get(f"get {key}")

    section: dict[str, Any] = {
        "bridgeType": "none",
        "bridgeSupported": False,
        "bridgeEnabled": False,
        "bridgeDelay": 0,
        "bridgeSource": "tx",
        "rs232Supported": False,
        "bridgeBaud": _BRIDGE_MAX_BAUD,
        "espnowSupported": False,
        "bridgeChannel": 1,
        "bridgeSecret": "",
        "femRxSupported": False,
        "femRxgain": False,
        "femTxSupported": False,
        "femTxgain": False,
        "extraSfSupported": False,
        "extraSf": "",
    }
    bridge_type = _strip_prompt(get("bridge.type"))
    section["bridgeType"] = bridge_type if bridge_type in ("rs232", "espnow") else "none"
    section["bridgeSupported"] = _is_onoff(get("bridge.enabled"))
    if section["bridgeSupported"]:
        section["bridgeEnabled"] = _is_on(get("bridge.enabled"))
        section["bridgeDelay"] = _first_int(get("bridge.delay"))
        source = _strip_prompt(get("bridge.source")).lower()
        section["bridgeSource"] = "rx" if source in ("logrx", "rx") else "tx"

    def has_number(key: str) -> bool:
        reply = get(key)
        return _stripped(reply).startswith(">") and bool(re.match(r"\d", _strip_prompt(reply)))

    section["rs232Supported"] = has_number("bridge.baud")
    if section["rs232Supported"]:
        section["bridgeBaud"] = _first_int(get("bridge.baud")) or _BRIDGE_MAX_BAUD
    section["espnowSupported"] = has_number("bridge.channel")
    if section["espnowSupported"]:
        section["bridgeChannel"] = _first_int(get("bridge.channel")) or 1
        section["bridgeSecret"] = _strip_prompt(get("bridge.secret"))
    section["femRxSupported"] = _is_onoff(get("radio.fem.rxgain"))
    if section["femRxSupported"]:
        section["femRxgain"] = _is_on(get("radio.fem.rxgain"))
    section["femTxSupported"] = _is_onoff(get("radio.fem.txgain"))
    if section["femTxSupported"]:
        section["femTxgain"] = _is_on(get("radio.fem.txgain"))
    # ``get extra.sf`` always answers, without the prompt; only a list of
    # numbers means a board that uses it.
    extra_sf = _stripped(get("extra.sf"))
    section["extraSfSupported"] = bool(re.match(r"\d", extra_sf))
    if section["extraSfSupported"]:
        section["extraSf"] = extra_sf
    return section


def _hardware_field(name: str, reply: str | None) -> Any:
    """One hardware setting from its own ``get`` reply, for a read-back.

    ``read_hardware`` needs the capability replies too; after a ``set`` only
    that one setting is read again.
    """
    if name in ("bridgeEnabled", "femRxgain", "femTxgain"):
        return _is_on(reply) if _is_onoff(reply) else _MISSING
    if name in ("bridgeDelay", "bridgeBaud", "bridgeChannel"):
        return _first_int(reply) if re.match(r"-?\d", _strip_prompt(reply)) else _MISSING
    if name == "bridgeSource":
        source = _strip_prompt(reply).lower()
        return (
            "rx" if source in ("logrx", "rx") else "tx" if source in ("logtx", "tx") else _MISSING
        )
    if name == "bridgeSecret":
        return _strip_prompt(reply) if _stripped(reply).startswith(">") else _MISSING
    if name == "extraSf":
        return _stripped(reply)
    return _MISSING


def _hardware_present(section: dict[str, Any]) -> bool:
    return any(
        section[flag]
        for flag in (
            "bridgeSupported",
            "rs232Supported",
            "espnowSupported",
            "femRxSupported",
            "femTxSupported",
            "extraSfSupported",
        )
    )


# --- mqtt (DMC observer) --------------------------------------------------------

MQTT_SLOT_COUNT = 6
_MQTT_GLOBAL_KEYS = (
    "mqtt.origin",
    "mqtt.iata",
    "mqtt.packets",
    "mqtt.raw",
    "mqtt.tx",
    "mqtt.rx",
    "mqtt.interval",
    "mqtt.neighbors",
    "mqtt.neighbors.interval",
    "radio.watchdog",
    "mqtt.ntp",
    "mqtt.owner",
    "mqtt.email",
    "alert",
    "alert.psk",
    "alert.hashtag",
    "alert.region",
    "alert.wifi",
    "alert.mqtt",
    "alert.interval",
    "snmp",
    "snmp.community",
    "wifi.ssid",
    "wifi.pwd",
    "wifi.powersave",
    "timezone",
    "timezone.offset",
)
_MQTT_SLOT_FIELDS = (
    "preset",
    "server",
    "port",
    "username",
    "password",
    "token",
    "topic",
    "audience",
    "filter",
)
MQTT_KEYS = (
    *_MQTT_GLOBAL_KEYS,
    *(f"mqtt{slot}.{name}" for slot in range(1, MQTT_SLOT_COUNT + 1) for name in _MQTT_SLOT_FIELDS),
)
MQTT_PROBE = "get mqtt.config.valid"
_MQTT_UNSET = re.compile(r"^\((unset|not set|default:)", re.IGNORECASE)
# Over the air the observer hides these; over the cable it shows them.
_MQTT_HIDDEN = "(serial only)"
# MeshCore payload types the slot filter knows (MQTTPacketFilter.h).
_PACKET_TYPES = {
    "req": 0,
    "response": 1,
    "txt_msg": 2,
    "ack": 3,
    "advert": 4,
    "grp_txt": 5,
    "grp_data": 6,
    "anon_req": 7,
    "path": 8,
    "trace": 9,
    "multipart": 10,
    "control": 11,
    "raw_custom": 15,
}


def mqtt_supported(reply: str | None) -> bool:
    return _strip_prompt(reply).lower() in ("valid", "invalid")


def normalize_packet_filter(spec: Any) -> str:
    """A slot filter as the firmware shows it: ``all``, ``none`` or numbers in order."""
    text = str(spec or "").strip().lower()
    if text in ("", "all"):
        return "all"
    if text == "none":
        return "none"
    chosen: set[int] = set()
    for token in (part.strip() for part in text.split(",")):
        if not token:
            continue
        if token in _PACKET_TYPES:
            chosen.add(_PACKET_TYPES[token])
        elif re.fullmatch(r"\d+", token) and int(token) <= 15:
            chosen.add(int(token))
    if chosen == set(_PACKET_TYPES.values()):
        return "all"
    if not chosen:
        return "none"
    return ",".join(str(number) for number in sorted(chosen))


def _mqtt_defaults() -> dict[str, Any]:
    return {
        "origin": "",
        "iata": "",
        "status": True,
        "packets": True,
        "raw": False,
        "tx": "advert",
        "rx": True,
        "interval": 5,
        "neighbors": False,
        "neighborsInterval": 24,
        "neighborsSupported": False,
        "radioWatchdog": 5,
        "ntp": "",
        "owner": "",
        "email": "",
        "slots": [
            {
                "preset": "none",
                "server": "",
                "port": 0,
                "username": "",
                "password": "",
                "token": "",
                "topic": "",
                "audience": "",
                "filter": "all",
            }
            for _ in range(MQTT_SLOT_COUNT)
        ],
        "alert": False,
        "alertPsk": "",
        "alertHashtag": "",
        "alertRegion": "",
        "alertWifi": 30,
        "alertMqtt": 240,
        "alertInterval": 60,
        "snmp": False,
        "snmpCommunity": "public",
        "wifiSsid": "",
        "wifiPassword": "",
        "wifiPowersave": "none",
        "timezone": "",
        "timezoneOffset": 0,
    }


@dataclass
class _MqttRead:
    section: dict[str, Any]
    hidden: list[str]


def _read_mqtt(replies: dict[str, str | None]) -> _MqttRead:
    section = _mqtt_defaults()
    hidden: list[str] = []

    def get(key: str) -> str | None:
        return replies.get(f"get {key}")

    def text(key: str) -> str:
        value = _strip_prompt(get(key))
        if value.endswith(_MQTT_HIDDEN):
            hidden.append(key)
            return ""
        return "" if _MQTT_UNSET.match(value) else value

    def boolean(key: str) -> bool:
        return _is_on(get(key))

    section["origin"] = text("mqtt.origin")
    section["iata"] = text("mqtt.iata")
    section["packets"] = boolean("mqtt.packets")
    section["raw"] = boolean("mqtt.raw")
    tx = _strip_prompt(get("mqtt.tx")).lower()
    section["tx"] = tx if tx in ("advert", "on") else "off"
    section["rx"] = boolean("mqtt.rx")
    section["interval"] = _first_int(get("mqtt.interval")) or 5
    neighbors = _strip_prompt(get("mqtt.neighbors")).lower()
    section["neighborsSupported"] = neighbors in ("on", "off")
    section["neighbors"] = neighbors == "on"
    section["neighborsInterval"] = _first_int(get("mqtt.neighbors.interval")) or 24
    section["radioWatchdog"] = _first_int(get("radio.watchdog"))
    section["ntp"] = text("mqtt.ntp")
    section["owner"] = text("mqtt.owner")
    section["email"] = text("mqtt.email")
    section["alert"] = boolean("alert")
    section["alertPsk"] = text("alert.psk")
    section["alertHashtag"] = text("alert.hashtag")
    section["alertRegion"] = text("alert.region")
    section["alertWifi"] = _first_int(get("alert.wifi"))
    section["alertMqtt"] = _first_int(get("alert.mqtt"))
    section["alertInterval"] = _first_int(get("alert.interval")) or 60
    section["snmp"] = boolean("snmp")
    section["snmpCommunity"] = text("snmp.community") or "public"
    section["wifiSsid"] = text("wifi.ssid")
    section["wifiPassword"] = text("wifi.pwd")
    powersave = _strip_prompt(get("wifi.powersave")).lower()
    section["wifiPowersave"] = powersave if powersave in ("min", "max") else "none"
    section["timezone"] = text("timezone")
    section["timezoneOffset"] = _first_int(get("timezone.offset"))
    for index, slot in enumerate(section["slots"]):
        number = index + 1
        slot["preset"] = text(f"mqtt{number}.preset") or "none"
        slot["server"] = text(f"mqtt{number}.server")
        slot["port"] = _first_int(get(f"mqtt{number}.port"))
        slot["username"] = text(f"mqtt{number}.username")
        slot["password"] = text(f"mqtt{number}.password")
        slot["token"] = text(f"mqtt{number}.token")
        slot["topic"] = text(f"mqtt{number}.topic")
        slot["audience"] = text(f"mqtt{number}.audience")
        slot["filter"] = normalize_packet_filter(_strip_prompt(get(f"mqtt{number}.filter")))
    return _MqttRead(section, hidden)


def read_mqtt(replies: dict[str, str | None]) -> dict[str, Any]:
    """The ``mqtt`` section from the ``get`` replies of an observer."""
    return _read_mqtt(replies).section


# --- reading a device -----------------------------------------------------------

IDENTITY_COMMANDS = ("ver", "board", "get role", "get public.key")


def read_commands(replies: dict[str, str | None]) -> list[str]:
    """The commands still to send to read the device; empty when the read is complete.

    Round 1 asks who the device is, round 2 every variable its firmware has
    and whether it has the packet filter, the observer settings, the
    hardware settings and the region tree, round 3 the settings of the
    features it has.
    """

    def missing(commands: list[str]) -> list[str]:
        return [command for command in commands if command not in replies]

    first = missing(list(IDENTITY_COMMANDS))
    if first:
        return first
    if replies.get("ver") is None:
        raise DeviceCliError(
            "The device does not answer its command line. Is it a repeater or room "
            "server, and is no other program using the port?"
        )
    version = parse_version(replies["ver"])
    second = [f"get {key}" for key, _kind in VAR_KEYS if _var_wanted(version, key)]
    second += [f"get {PRIVATE_KEY}", "filter", MQTT_PROBE]
    second += [f"get {key}" for key in HARDWARE_KEYS]
    second.append("region")
    pending = missing(second)
    if pending:
        return pending
    third: list[str] = []
    if is_filter_status(replies.get("filter")):
        third += FILTER_COMMANDS
    if region_supported(replies.get("region")):
        third += ["region home", "region default"]
    if mqtt_supported(replies.get(MQTT_PROBE)):
        third += [f"get {key}" for key in MQTT_KEYS]
    return missing(third)


@dataclass
class DeviceIdentity:
    public_key: str | None
    role: str | None
    firmware_version: str | None
    board: str | None
    name: str | None


@dataclass
class DeviceRead:
    document: dict[str, Any]
    identity: DeviceIdentity
    profile: str
    # Codes the UI explains: ``region_cut_off``, ``hidden:<key>``.
    warnings: list[str] = field(default_factory=list)


def _identity(replies: dict[str, str | None], name: Any) -> DeviceIdentity:
    key = (get_value(replies.get("get public.key")) or "").lower()
    role = get_value(replies.get("get role"))
    version = _stripped(replies.get("ver")).split(" (Build", 1)[0].strip()
    board = _stripped(replies.get("board"))
    if not board or re.search(r"unknown command|^\?\?", board, re.IGNORECASE):
        board = ""
    return DeviceIdentity(
        public_key=key if _HEX_KEY.fullmatch(key) else None,
        role=role or None,
        firmware_version=version or None,
        board=board or None,
        name=_as_text(name) if name not in (None, "") else None,
    )


def read_vars(replies: dict[str, str | None]) -> dict[str, Any]:
    version = parse_version(replies.get("ver"))
    out: dict[str, Any] = {}
    for key, _kind in VAR_KEYS:
        if not _var_wanted(version, key) or f"get {key}" not in replies:
            continue
        present, value = read_var(key, replies[f"get {key}"])
        if present:
            out[key] = value
    private = get_value(replies.get(f"get {PRIVATE_KEY}"))
    if private:
        out[PRIVATE_KEY] = private
    return out


def read_device(replies: dict[str, str | None]) -> DeviceRead:
    """The device's config file from a complete set of replies."""
    if read_commands(replies):
        raise DeviceCliError("The read of the device is not complete")
    document: dict[str, Any] = {"vars": read_vars(replies)}
    warnings: list[str] = []
    if is_filter_status(replies.get("filter")):
        document["filter"] = read_filter(replies)
    if region_supported(replies.get("region")):
        document["region"] = read_region(replies)
        if len(replies.get("region") or "") >= _REGION_DUMP_FULL:
            warnings.append("region_cut_off")
    hardware = read_hardware(replies)
    if _hardware_present(hardware):
        document["hardware"] = hardware
    if mqtt_supported(replies.get(MQTT_PROBE)):
        mqtt = _read_mqtt(replies)
        document["mqtt"] = mqtt.section
        warnings += [f"hidden:{key}" for key in mqtt.hidden]
    identity = _identity(replies, document["vars"].get("name"))
    if identity.public_key is None:
        raise DeviceCliError("The device did not give its public key")
    return DeviceRead(document, identity, fleet_config.detect_profile(document), warnings)


# --- applying a config ----------------------------------------------------------


@dataclass
class ApplyStep:
    section: str
    path: tuple[str | int, ...]
    command: str
    # The command as shown and logged: a secret value is replaced.
    display: str
    secret: bool = False
    reboot: bool = False
    # Commands that read the setting back, and what that must show.
    readback: list[str] = field(default_factory=list)
    expect: Any = None
    # ``value``: the read-back shows ``expect``. ``reply``: only the reply is
    # checked (the setting cannot be read back). ``public_key``: the reply of
    # ``set prv.key`` names ``expect`` as the new public key.
    check: str = "value"


@dataclass
class ApplyRow:
    path: tuple[str | int, ...]
    status: str  # "change", "same" or "skip"
    configured: str
    device: str
    reason: str | None = None


@dataclass
class ApplyPlan:
    steps: list[ApplyStep]
    rows: list[ApplyRow]
    reboot: bool
    # The device is to take the asset's identity (``set prv.key`` with the
    # asset's private key) instead of already having it.
    rekey: bool


_SECRET_SHOWN = "********"


def _shown(value: Any, secret: bool) -> str:
    if value is _MISSING:
        return ""
    if secret:
        return _SECRET_SHOWN if value not in (None, "") else ""
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return _as_text(value)


def resolve_secrets(document: Any, values: dict[int, str]) -> Any:
    """``document`` with each placeholder replaced by its value, or a marker when there is none."""
    if isinstance(document, dict):
        if fleet_config.SECRET in document:
            secret_id = document[fleet_config.SECRET]
            if isinstance(secret_id, int) and secret_id in values:
                text = values[secret_id]
                if document.get(fleet_config.ENCODED):
                    try:
                        return json.loads(text)
                    except ValueError:
                        return _MISSING
                return text
            return _MISSING
        return {key: resolve_secrets(item, values) for key, item in document.items()}
    if isinstance(document, list):
        return [resolve_secrets(item, values) for item in document]
    return document


class _Planner:
    def __init__(self) -> None:
        self.steps: list[ApplyStep] = []
        self.rows: list[ApplyRow] = []

    def same(self, path: tuple[str | int, ...], value: Any, secret: bool = False) -> None:
        shown = _shown(value, secret)
        self.rows.append(ApplyRow(path, "same", shown, shown))

    def skip(
        self,
        path: tuple[str | int, ...],
        reason: str,
        want: Any = _MISSING,
        have: Any = _MISSING,
        secret: bool = False,
    ) -> None:
        self.rows.append(ApplyRow(path, "skip", _shown(want, secret), _shown(have, secret), reason))

    def change(self, step: ApplyStep, want: Any, have: Any) -> None:
        if not command_allowed(step.command):
            self.skip(step.path, "bad_value", want, have, step.secret)
            return
        self.steps.append(step)
        self.rows.append(
            ApplyRow(step.path, "change", _shown(want, step.secret), _shown(have, step.secret))
        )


def _display(command: str, secret: bool, value: str) -> str:
    if not secret:
        return command
    return command[: len(command) - len(value)] + _SECRET_SHOWN


def _plan_vars(
    planner: _Planner,
    want: dict[str, Any],
    have: dict[str, Any],
    *,
    allow_private_key: bool,
    allow_radio: bool,
    expected_public_key: str | None,
) -> None:
    keys = [key for key, _kind in VAR_KEYS if key in want]
    keys += [key for key in want if key not in _VAR_KIND and key != PRIVATE_KEY]
    if PRIVATE_KEY in want:
        keys.append(PRIVATE_KEY)
    for key in keys:
        path = ("vars", key)
        value = want[key]
        secret = key in _SECRET_VARS
        if value is _MISSING:
            planner.skip(path, "secret_unavailable", secret=True)
            continue
        if key not in _VAR_KIND and key != PRIVATE_KEY:
            planner.skip(path, "unknown_key", value, have.get(key, _MISSING))
            continue
        if key not in have:
            planner.skip(path, "not_on_device", value, secret=secret)
            continue
        current = have[key]
        if same_var(key, value, current):
            planner.same(path, value, secret)
            continue
        if key == PRIVATE_KEY:
            if not allow_private_key:
                planner.skip(path, "needs_key_tick", value, current, secret=True)
                continue
            text = _as_text(value).strip()
            if not _PRIVATE_KEY.fullmatch(text):
                planner.skip(path, "bad_value", value, current, secret=True)
                continue
            public_key = derive_public_key(bytes.fromhex(text)).hex()
            if expected_public_key is not None and public_key != expected_public_key:
                planner.skip(path, "key_not_asset", value, current, secret=True)
                continue
            command = f"set {PRIVATE_KEY} {text.lower()}"
            planner.change(
                ApplyStep(
                    "vars",
                    path,
                    command,
                    _display(command, True, text),
                    secret=True,
                    reboot=True,
                    expect=public_key,
                    check="public_key",
                ),
                value,
                current,
            )
            continue
        if key == "radio" and not allow_radio:
            planner.skip(path, "needs_radio_tick", value, current)
            continue
        text = _var_text(key, value)
        if text is None:
            planner.skip(path, "bad_value", value, current, secret)
            continue
        command = f"set {key} {text}"
        planner.change(
            ApplyStep(
                "vars",
                path,
                command,
                _display(command, secret, text),
                secret=secret,
                reboot=key in _REBOOT_VARS,
                readback=[f"get {key}"],
                expect=value,
            ),
            value,
            current,
        )


def _int_field(value: Any, low: int, high: int) -> int | None:
    number = _to_float(value)
    if number is None or not number.is_integer() or not low <= number <= high:
        return None
    return int(number)


def _plan_filter(
    planner: _Planner,
    want: dict[str, Any],
    have: dict[str, Any],
    soft: dict[int, int],
) -> None:
    def step(path: tuple[str | int, ...], command: str, readback: str, expect: Any) -> ApplyStep:
        return ApplyStep("filter", path, command, command, readback=[readback], expect=expect)

    hash_bytes = want.get("minHashBytes", _MISSING)
    if hash_bytes is not _MISSING:
        path = ("filter", "minHashBytes")
        number = _int_field(hash_bytes, 1, 3)
        if number is None:
            planner.skip(path, "bad_value", hash_bytes, have["minHashBytes"])
        elif number == have["minHashBytes"]:
            planner.same(path, number)
        else:
            planner.change(
                step(path, f"filter hash {number}", "filter hash", number),
                number,
                have["minHashBytes"],
            )
    malformed = want.get("malformed", _MISSING)
    if malformed is not _MISSING:
        path = ("filter", "malformed")
        if not isinstance(malformed, bool):
            planner.skip(path, "bad_value", malformed, have["malformed"])
        elif malformed == have["malformed"]:
            planner.same(path, malformed)
        else:
            planner.change(
                step(path, f"filter malformed {_onoff(malformed)}", "filter malformed", malformed),
                malformed,
                have["malformed"],
            )
    per_type = want.get("perType")
    if isinstance(per_type, list):
        for index in range(min(len(per_type), FILTER_TYPE_COUNT)):
            entry = per_type[index] if isinstance(per_type[index], dict) else {}
            current = have["perType"][index]
            if "hops" in entry:
                path = ("filter", "perType", index, "hops")
                hops = _int_field(entry["hops"], 0, 64)
                if hops is None:
                    planner.skip(path, "bad_value", entry["hops"], current["hops"])
                elif hops == current["hops"]:
                    planner.same(path, hops)
                else:
                    planner.change(
                        step(path, f"filter hops {index} {hops}", "filter hops", hops),
                        hops,
                        current["hops"],
                    )
        for index in range(min(len(per_type), FILTER_TYPE_COUNT)):
            entry = per_type[index] if isinstance(per_type[index], dict) else {}
            current = have["perType"][index]
            if "rateLimit" not in entry and "rateSecs" not in entry:
                continue
            path = ("filter", "perType", index, "rate")
            limit = _int_field(entry.get("rateLimit", current["rateLimit"]), 0, 65535)
            secs = _int_field(entry.get("rateSecs", current["rateSecs"]), 0, 4294967295)
            shown_want = f"{entry.get('rateLimit')},{entry.get('rateSecs')}"
            shown_have = f"{current['rateLimit']},{current['rateSecs']}"
            if limit is None or secs is None:
                planner.skip(path, "bad_value", shown_want, shown_have)
            elif (limit, secs) == (current["rateLimit"], current["rateSecs"]):
                planner.same(path, shown_have)
            else:
                command = f"filter rate {index} {limit} {secs}"
                # Leaving out the soft limit sets it to 0; keep the device's own.
                if 0 < soft.get(index, 0) < limit:
                    command += f" {soft[index]}"
                planner.change(
                    step(path, command, "filter rate", {"rateLimit": limit, "rateSecs": secs}),
                    f"{limit},{secs}",
                    shown_have,
                )
    channels = want.get("channels")
    if isinstance(channels, list):
        wanted = [name for name in channels if isinstance(name, str)]
        for name in wanted:
            path = ("filter", "channels", name)
            if not name or re.search(r"\s", name):
                planner.skip(path, "bad_value", name)
            elif name in have["channels"]:
                planner.same(path, name)
            else:
                planner.change(
                    step(path, f"filter channel add {name}", "filter channel list", True),
                    name,
                    _MISSING,
                )
        for name in have["channels"]:
            if name not in wanted:
                planner.change(
                    step(
                        ("filter", "channels", name),
                        f"filter channel remove {name}",
                        "filter channel list",
                        False,
                    ),
                    _MISSING,
                    name,
                )
    enabled = want.get("enabled", _MISSING)
    if enabled is not _MISSING:
        path = ("filter", "enabled")
        if not isinstance(enabled, bool):
            planner.skip(path, "bad_value", enabled, have["enabled"])
        elif enabled == have["enabled"]:
            planner.same(path, enabled)
        else:
            # Last, so the filter is set up before it is switched on.
            planner.change(
                step(path, f"filter {_onoff(enabled)}", "filter", enabled),
                enabled,
                have["enabled"],
            )


def _plan_region(planner: _Planner, want: dict[str, Any], replies: dict[str, str | None]) -> None:
    tree = parse_region_tree(replies.get("region"))
    have = read_region(replies)
    names = region_names(tree)
    wanted_def = want.get("def")
    if isinstance(wanted_def, str):
        path = ("region", "def")
        if " ".join(wanted_def.split()) == " ".join(have["def"].split()):
            planner.same(path, have["def"])
        else:
            planner.skip(path, "region_tree", wanted_def, have["def"])
    home_changed = False
    home = want.get("home")
    if isinstance(home, str):
        path = ("region", "home")
        target = home.strip()
        if target == have["home"]:
            planner.same(path, target)
        elif not target:
            planner.skip(path, "home_clear", target, have["home"])
        elif target not in names or re.search(r"\s", target):
            planner.skip(path, "not_in_tree", target, have["home"])
        else:
            planner.change(
                ApplyStep(
                    "region",
                    path,
                    f"region home {target}",
                    f"region home {target}",
                    readback=["region home"],
                    expect=target,
                ),
                target,
                have["home"],
            )
            home_changed = True
    default = want.get("default")
    if isinstance(default, str):
        path = ("region", "default")
        target = default.strip()
        if target == have["default"]:
            planner.same(path, target)
        elif target and (target not in names or re.search(r"\s", target)):
            # The firmware would add a missing region to the tree.
            planner.skip(path, "not_in_tree", target, have["default"])
        else:
            command = f"region default {target or '<null>'}"
            planner.change(
                ApplyStep(
                    "region",
                    path,
                    command,
                    command,
                    readback=["region default"],
                    expect=target,
                ),
                target,
                have["default"],
            )
    if home_changed:
        # The home region is kept over a restart only after ``region save``.
        planner.steps.append(
            ApplyStep("region", ("region", "save"), "region save", "region save", check="reply")
        )


def _plain_change(
    planner: _Planner,
    section: str,
    path: tuple[str | int, ...],
    command: str,
    readback_key: str | None,
    want: Any,
    have: Any,
    *,
    secret: bool = False,
    reboot: bool = False,
    value_text: str = "",
) -> None:
    planner.change(
        ApplyStep(
            section,
            path,
            command,
            _display(command, secret, value_text) if secret else command,
            secret=secret,
            reboot=reboot,
            readback=[f"get {readback_key}"] if readback_key else [],
            expect=want,
            check="value" if readback_key else "reply",
        ),
        want,
        have,
    )


def _typed_like(value: Any, example: Any) -> bool:
    if isinstance(example, bool):
        return isinstance(value, bool)
    if isinstance(example, (int, float)):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, str)


def _bad_text(value: str) -> bool:
    return any(char in value for char in "\r\n\0")


def _plan_hardware(planner: _Planner, want: dict[str, Any], have: dict[str, Any]) -> None:
    fields = (
        ("bridgeEnabled", "bridgeSupported", "bridge.enabled", False, False),
        ("bridgeDelay", "bridgeSupported", "bridge.delay", False, False),
        ("bridgeSource", "bridgeSupported", "bridge.source", False, False),
        ("bridgeBaud", "rs232Supported", "bridge.baud", False, False),
        ("bridgeChannel", "espnowSupported", "bridge.channel", False, False),
        ("bridgeSecret", "espnowSupported", "bridge.secret", True, True),
        ("femRxgain", "femRxSupported", "radio.fem.rxgain", False, False),
        ("femTxgain", "femTxSupported", "radio.fem.txgain", False, False),
        ("extraSf", "extraSfSupported", "extra.sf", False, True),
    )
    for name, flag, key, secret, skip_empty in fields:
        if name not in want:
            continue
        path = ("hardware", name)
        value = want[name]
        if value is _MISSING:
            planner.skip(path, "secret_unavailable", secret=True)
            continue
        if not have[flag]:
            # The file holds every field; one this build lacks keeps its
            # default there, which is not worth a line.
            if value != have[name]:
                planner.skip(path, "not_on_device", value, secret=secret)
            continue
        current = have[name]
        if not _typed_like(value, current) or (isinstance(value, str) and _bad_text(value)):
            planner.skip(path, "bad_value", value, current, secret)
            continue
        if name == "bridgeSource" and value not in ("rx", "tx"):
            planner.skip(path, "bad_value", value, current)
            continue
        if value == current:
            planner.same(path, value, secret)
            continue
        if skip_empty and value == "":
            planner.skip(path, "empty_not_sent", value, current, secret)
            continue
        text = _onoff(value) if isinstance(value, bool) else _as_text(value)
        _plain_change(
            planner,
            "hardware",
            path,
            f"set {key} {text}",
            key,
            value,
            current,
            secret=secret,
            value_text=text,
        )


# (file field, CLI key, kind, secret, reboot, empty value: "skip" | "clear" | "none" | "send")
_MQTT_FIELDS: tuple[tuple[str, str, str, bool, bool, str], ...] = (
    ("origin", "mqtt.origin", "text", False, False, "clear"),
    ("iata", "mqtt.iata", "text", False, False, "skip"),
    ("status", "mqtt.status", "bool", False, False, "send"),
    ("packets", "mqtt.packets", "bool", False, False, "send"),
    ("raw", "mqtt.raw", "bool", False, False, "send"),
    ("tx", "mqtt.tx", "choice", False, False, "send"),
    ("rx", "mqtt.rx", "bool", False, False, "send"),
    ("interval", "mqtt.interval", "number", False, False, "send"),
    ("neighbors", "mqtt.neighbors", "bool", False, False, "send"),
    ("neighborsInterval", "mqtt.neighbors.interval", "number", False, False, "send"),
    ("radioWatchdog", "radio.watchdog", "number", False, False, "send"),
    ("ntp", "mqtt.ntp", "text", False, False, "none"),
    ("owner", "mqtt.owner", "text", False, False, "skip"),
    ("email", "mqtt.email", "text", False, False, "skip"),
    ("wifiSsid", "wifi.ssid", "text", False, True, "skip"),
    ("wifiPassword", "wifi.pwd", "text", True, True, "skip"),
    ("wifiPowersave", "wifi.powersave", "choice", False, False, "send"),
    ("timezone", "timezone", "text", False, False, "skip"),
    ("timezoneOffset", "timezone.offset", "number", False, False, "send"),
)
_MQTT_ALERT_FIELDS: tuple[tuple[str, str, str, bool, bool, str], ...] = (
    ("alertPsk", "alert.psk", "text", True, False, "clear"),
    ("alertHashtag", "alert.hashtag", "text", False, False, "clear"),
    ("alertRegion", "alert.region", "text", False, False, "clear"),
    ("alertWifi", "alert.wifi", "number", False, False, "send"),
    ("alertMqtt", "alert.mqtt", "number", False, False, "send"),
    ("alertInterval", "alert.interval", "number", False, False, "send"),
    # The master switch last, once the alert is set up.
    ("alert", "alert", "bool", False, False, "send"),
    ("snmp", "snmp", "bool", False, True, "send"),
    ("snmpCommunity", "snmp.community", "text", True, True, "skip"),
)
_MQTT_CHOICES = {"tx": ("off", "on", "advert"), "wifiPowersave": ("none", "min", "max")}
_MQTT_SLOT_SECRETS = ("password", "token")


def _plan_mqtt_field(
    planner: _Planner,
    path: tuple[str | int, ...],
    key: str,
    kind: str,
    secret: bool,
    reboot: bool,
    empty: str,
    value: Any,
    current: Any,
    *,
    readable: bool = True,
) -> None:
    if value is _MISSING:
        planner.skip(path, "secret_unavailable", secret=True)
        return
    if not _typed_like(value, current) or (isinstance(value, str) and _bad_text(value)):
        planner.skip(path, "bad_value", value, current, secret)
        return
    if kind == "choice" and value not in _MQTT_CHOICES[str(path[-1])]:
        planner.skip(path, "bad_value", value, current)
        return
    if value == current:
        planner.same(path, value, secret)
        return
    if value == "" and empty == "skip":
        planner.skip(path, "empty_not_sent", value, current, secret)
        return
    if isinstance(value, bool):
        text = _onoff(value)
    elif value == "" and empty == "none":
        text = "none"
    else:
        text = _as_text(value)
    command = f"set {key} {text}" if text != "" else f"set {key}"
    _plain_change(
        planner,
        "mqtt",
        path,
        command,
        key if readable else None,
        value,
        current,
        secret=secret and text != "",
        reboot=reboot,
        value_text=text,
    )


def _plan_mqtt(planner: _Planner, want: dict[str, Any], have: dict[str, Any]) -> None:
    for name, key, kind, secret, reboot, empty in _MQTT_FIELDS:
        if name not in want:
            continue
        path = ("mqtt", name)
        if name in ("neighbors", "neighborsInterval") and not have["neighborsSupported"]:
            if want[name] != have[name]:
                planner.skip(path, "not_on_device", want[name])
            continue
        # The firmware cannot report mqtt.status: only its reply is checked.
        _plan_mqtt_field(
            planner,
            path,
            key,
            kind,
            secret,
            reboot,
            empty,
            want[name],
            have[name],
            readable=name != "status",
        )
    slots = want.get("slots")
    if isinstance(slots, list):
        for index in range(min(len(slots), MQTT_SLOT_COUNT)):
            slot = slots[index] if isinstance(slots[index], dict) else {}
            current = have["slots"][index]
            number = index + 1
            preset = slot.get("preset", current["preset"])
            if "preset" in slot:
                _plan_mqtt_field(
                    planner,
                    ("mqtt", "slots", index, "preset"),
                    f"mqtt{number}.preset",
                    "text",
                    False,
                    False,
                    "skip",
                    preset,
                    current["preset"],
                )
            if preset == "custom":
                for name in (
                    "server",
                    "port",
                    "username",
                    "password",
                    "token",
                    "topic",
                    "audience",
                ):
                    if name not in slot:
                        continue
                    value = slot[name]
                    _plan_mqtt_field(
                        planner,
                        ("mqtt", "slots", index, name),
                        f"mqtt{number}.{name}",
                        "number" if name == "port" else "text",
                        name in _MQTT_SLOT_SECRETS,
                        False,
                        "skip",
                        value,
                        current[name],
                    )
            if preset != "none" and "filter" in slot and isinstance(slot["filter"], str):
                _plan_mqtt_field(
                    planner,
                    ("mqtt", "slots", index, "filter"),
                    f"mqtt{number}.filter",
                    "text",
                    False,
                    False,
                    "send",
                    normalize_packet_filter(slot["filter"]),
                    current["filter"],
                )
    for name, key, kind, secret, reboot, empty in _MQTT_ALERT_FIELDS:
        if name in want:
            _plan_mqtt_field(
                planner,
                ("mqtt", name),
                key,
                kind,
                secret,
                reboot,
                empty,
                want[name],
                have[name],
            )


def plan_apply(
    desired: dict[str, Any],
    secret_values: dict[int, str],
    replies: dict[str, str | None],
    *,
    asset_public_key: str,
    allow_private_key: bool = False,
    allow_radio: bool = False,
) -> ApplyPlan:
    """The commands that make the device of ``replies`` match ``desired``.

    ``desired`` is a stored toolbox document; its secrets are looked up in
    ``secret_values`` (vault id to value) and a secret that is not there is
    skipped. Only settings the device has are set, one command each, and
    each is read back afterwards. The device must be the asset's: its public
    key is the asset's, or the document's private key belongs to the asset's
    public key and the private key tick is on (the device then takes the
    asset's identity).
    """
    if not isinstance(desired.get("vars"), dict):
        raise DeviceCliError("Only a toolbox config file can be applied over the cable")
    device = read_device(replies)
    want = resolve_secrets(desired, secret_values)
    rekey = device.identity.public_key != asset_public_key
    if rekey:
        private = want["vars"].get(PRIVATE_KEY, _MISSING)
        text = _as_text(private).strip() if private is not _MISSING else ""
        belongs = bool(_PRIVATE_KEY.fullmatch(text)) and (
            derive_public_key(bytes.fromhex(text)).hex() == asset_public_key
        )
        if not (allow_private_key and belongs):
            raise DeviceMismatchError(
                "This device is not this asset: its public key is "
                f"{device.identity.public_key}. Only a config with this asset's private "
                "key, applied with the private key tick, gives it the asset's identity."
            )
    planner = _Planner()
    _plan_vars(
        planner,
        want["vars"],
        device.document["vars"],
        allow_private_key=allow_private_key,
        allow_radio=allow_radio,
        expected_public_key=asset_public_key,
    )
    for section in ("filter", "region", "hardware", "mqtt"):
        wanted = want.get(section)
        if not isinstance(wanted, dict):
            continue
        if section not in device.document:
            planner.skip((section,), "not_on_device")
            continue
        if section == "filter":
            _plan_filter(
                planner,
                wanted,
                device.document["filter"],
                filter_soft_limits(replies.get("filter rate")),
            )
        elif section == "region":
            _plan_region(planner, wanted, replies)
        elif section == "hardware":
            _plan_hardware(planner, wanted, device.document["hardware"])
        else:
            _plan_mqtt(planner, wanted, device.document["mqtt"])
    # A private key step goes last: the other settings are written to the
    # device as it is, and the new identity only takes over after a restart.
    planner.steps.sort(key=lambda step: step.path == ("vars", PRIVATE_KEY))
    return ApplyPlan(
        steps=planner.steps,
        rows=planner.rows,
        reboot=any(step.reboot for step in planner.steps),
        rekey=rekey,
    )


# --- checking a step ------------------------------------------------------------

_REGION_SET_OK = re.compile(r"(home is now|default scope is now)\s+\S+", re.IGNORECASE)


def _reply_ok(step: ApplyStep, reply: str) -> bool:
    if step.section == "filter":
        return bool(_FILTER_OK.match(reply))
    if step.section == "region" and step.command != "region save":
        return bool(_REGION_SET_OK.search(reply))
    return reply.upper().startswith("OK")


def _read_back(step: ApplyStep, replies: dict[str, str | None]) -> Any:
    """The setting as the read-back shows it, in the form ``step.expect`` has."""
    path = step.path
    if step.section == "vars":
        present, value = read_var(str(path[1]), replies.get(step.readback[0]))
        return value if present else _MISSING
    if step.section == "filter":
        section = read_filter({**replies, "filter": replies.get("filter", "")})
        if path[1] == "perType":
            entry = section["perType"][int(path[2])]
            if path[3] == "rate":
                return {"rateLimit": entry["rateLimit"], "rateSecs": entry["rateSecs"]}
            return entry["hops"]
        if path[1] == "channels":
            return path[2] in section["channels"]
        return section[str(path[1])]
    if step.section == "region":
        return read_region({"region": "", **replies})[str(path[1])]
    if step.section == "hardware":
        return _hardware_field(str(path[1]), replies.get(step.readback[0]))
    if step.section == "mqtt":
        section = read_mqtt(replies)
        if path[1] == "slots":
            return section["slots"][int(path[2])][str(path[3])]
        return section[str(path[1])]
    return _MISSING


def _same(step: ApplyStep, value: Any) -> bool:
    if value is _MISSING:
        return False
    if step.section == "vars":
        return same_var(str(step.path[1]), step.expect, value)
    if step.section == "mqtt" and step.path[-1] == "filter":
        return normalize_packet_filter(step.expect) == value
    return value == step.expect


def check_step(
    step: ApplyStep, reply: str | None, readback: dict[str, str | None]
) -> tuple[bool, str | None]:
    """``(ok, reason)`` for one sent command. ``reason`` never holds a secret value."""
    text = _stripped(reply)
    if reply is None:
        return False, "no_reply"
    if step.check == "public_key":
        match = re.search(r"New pubkey:\s*([0-9a-fA-F]{64})", text)
        if not text.upper().startswith("OK") or not match:
            return False, "unexpected_reply"
        if match.group(1).lower() != step.expect:
            return False, "other_public_key"
        return True, None
    if not _reply_ok(step, text):
        return False, "unexpected_reply"
    if step.check == "reply":
        return True, None
    for command in step.readback:
        if readback.get(command) is None:
            return False, "no_readback"
    if not _same(step, _read_back(step, readback)):
        return False, "readback_differs"
    return True, None


def reply_shown(step: ApplyStep, reply: str | None) -> str:
    """The device's reply as it may be shown and logged: never for a secret command."""
    if step.secret or reply is None:
        return ""
    return _stripped(reply)[:160]
