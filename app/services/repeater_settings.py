"""Allow-list + validation for the structured repeater settings editor.

Every ``set`` the editor sends is a CLI message transmitted over RF to a remote
repeater, so the server refuses anything that is not on this allow-list and
anything whose value the stock firmware would reject or misread.

Verbs and ranges are taken from the stock repeater CLI,
``src/helpers/CommonCLI.cpp`` in github.com/meshcore-dev/MeshCore (main at
e94125987ed87497e706a0b54d1e80c709343980): ``handleSetCmd`` for the accepted
syntax/ranges and ``handleGetCmd`` for the read-back format. The list itself
mirrors meshcore-open's ``repeater_settings_screen.dart`` (zjs81/meshcore-open,
MIT), minus ``prv.key`` (identity secret, deliberately excluded) and the admin
``password`` command (not a ``set``/``get`` pair and not in scope).

Firmware facts relied on here (CommonCLI.cpp, same commit):

- ``set radio f,bw,sf,cr`` is the only over-the-air way to change frequency;
  ``set freq`` is serial-only (``sender_timestamp == 0``). The firmware checks
  freq 150-2500, bw 7-500, sf 5-12, cr 5-8, saves prefs and replies
  ``OK - reboot to apply``. ``get radio`` then reports the SAVED prefs, which
  the radio only uses after a reboot.
- ``advert.interval`` is stored as ``mins / 2`` and read back ``* 2``;
  ``agc.reset.interval`` is stored as ``secs / 4`` (uint8) and read back ``* 4``.
  We only accept values that survive that round trip unchanged.
- ``tx`` has no range check on ``set``; prefs are constrained to -9..30 dBm on
  load, so that is the range we accept.
- ``name`` rejects ``[ ] \\ : , ? *`` and is stored in ``char[32]``;
  ``guest.password`` in ``char[16]``; ``owner.info`` in ``char[120]`` with ``|``
  translated to newline (and back on ``get``).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

SetStatus = Literal["ok", "mismatch", "rejected", "unverified"]


class SettingValidationError(ValueError):
    """Raised when a setting key is not allow-listed or its value is invalid."""


# Standard LoRa bandwidths (kHz), the same list meshcore-open offers. The
# firmware accepts any 7-500 kHz, but a non-standard bandwidth is almost always
# a typo that strands the repeater, so only the standard set is allowed.
LORA_BANDWIDTHS_KHZ: tuple[Decimal, ...] = tuple(
    Decimal(v)
    for v in ("7.8", "10.4", "15.6", "20.8", "31.25", "41.7", "62.5", "125", "250", "500")
)

LOOP_DETECT_MODES = ("off", "minimal", "moderate", "strict")

_NAME_FORBIDDEN = set("[]\\:,?*")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class SettingSpec:
    """One editable setting.

    ``normalize`` validates the user value and returns the exact argument text
    sent after ``set <verb> ``. ``matches`` compares the ``get <verb>`` reply
    with that argument.
    """

    verb: str
    normalize: Callable[[str], str]
    matches: Callable[[str, str], bool]
    reboot_required: bool = False
    strong_confirm: bool = False
    secret: bool = False


# --- value parsers ----------------------------------------------------------


def _parse_decimal(raw: str, *, max_decimals: int) -> Decimal:
    text = raw.strip()
    if not re.fullmatch(r"[+-]?\d+(\.\d+)?", text):
        raise SettingValidationError(f"'{raw}' is not a plain decimal number")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise SettingValidationError(f"'{raw}' is not a number") from exc
    exponent = value.as_tuple().exponent
    decimals = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    if decimals > max_decimals:
        raise SettingValidationError(f"'{raw}' has more than {max_decimals} decimal places")
    return value


def _fmt_decimal(value: Decimal) -> str:
    """Plain (non-exponent) text without trailing zeros, e.g. 52.1, 0.5, 20."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in ("-0", "+0", ""):
        text = "0"
    return text


def _int_in(lo: int, hi: int, *, step: int = 1, allow_zero: bool = False) -> Callable[[str], str]:
    def normalize(raw: str) -> str:
        text = raw.strip()
        if not re.fullmatch(r"[+-]?\d+", text):
            raise SettingValidationError(f"'{raw}' is not a whole number")
        value = int(text)
        if allow_zero and value == 0:
            return "0"
        if not lo <= value <= hi:
            extra = " or 0 (off)" if allow_zero else ""
            raise SettingValidationError(f"must be between {lo} and {hi}{extra}")
        if value % step != 0:
            raise SettingValidationError(f"must be a multiple of {step}")
        return str(value)

    return normalize


def _decimal_in(lo: str, hi: str, *, max_decimals: int) -> Callable[[str], str]:
    lo_d, hi_d = Decimal(lo), Decimal(hi)

    def normalize(raw: str) -> str:
        value = _parse_decimal(raw, max_decimals=max_decimals)
        if not lo_d <= value <= hi_d:
            raise SettingValidationError(f"must be between {lo} and {hi}")
        return _fmt_decimal(value)

    return normalize


def _choice(options: tuple[str, ...]) -> Callable[[str], str]:
    def normalize(raw: str) -> str:
        text = raw.strip().lower()
        if text not in options:
            raise SettingValidationError(f"must be one of: {', '.join(options)}")
        return text

    return normalize


def _text(
    *, max_bytes: int, forbidden: set[str] | None = None, newline_to_pipe: bool = False
) -> Callable[[str], str]:
    """Free text. Newlines become ``|`` only for owner.info (the firmware's own
    line separator, CommonCLI.cpp). Leading/trailing spaces are rejected, not
    stripped, so the value sent is exactly what the user typed."""

    def normalize(raw: str) -> str:
        text = raw
        if newline_to_pipe:
            text = text.strip("\r\n")
            text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "|")
        if not text.strip():
            raise SettingValidationError("must not be empty")
        if text != text.strip():
            raise SettingValidationError("must not start or end with spaces")
        if _CONTROL_RE.search(text):
            raise SettingValidationError("must not contain control characters")
        if forbidden and any(ch in forbidden for ch in text):
            raise SettingValidationError("must not contain any of: " + " ".join(sorted(forbidden)))
        if len(text.encode("utf-8")) > max_bytes:
            raise SettingValidationError(f"must be at most {max_bytes} bytes")
        return text

    return normalize


def _normalize_radio(raw: str) -> str:
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 4:
        raise SettingValidationError("radio must be 'freq,bw,sf,cr'")
    freq = _parse_decimal(parts[0], max_decimals=3)
    if not Decimal("150") <= freq <= Decimal("2500"):
        raise SettingValidationError("frequency must be between 150 and 2500 MHz")
    bw = _parse_decimal(parts[1], max_decimals=3)
    if bw not in LORA_BANDWIDTHS_KHZ:
        allowed = ", ".join(_fmt_decimal(b) for b in LORA_BANDWIDTHS_KHZ)
        raise SettingValidationError(f"bandwidth must be one of: {allowed} kHz")
    sf = _int_in(5, 12)(parts[2])
    cr = _int_in(5, 8)(parts[3])
    return f"{_fmt_decimal(freq)},{_fmt_decimal(bw)},{sf},{cr}"


# --- read-back comparators --------------------------------------------------


def _as_float(text: str) -> float | None:
    try:
        value = float(text.strip().rstrip("%").strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _exact(readback: str, expected: str) -> bool:
    return readback.strip() == expected


def _exact_ci(readback: str, expected: str) -> bool:
    return readback.strip().lower() == expected.lower()


def _numeric(tolerance: float) -> Callable[[str, str], bool]:
    """Compare as numbers. Firmware stores floats as float32 and prints them
    with ``StrHelper::ftoa`` (7 truncated fraction digits), so exact text
    equality would report false mismatches."""

    def matches(readback: str, expected: str) -> bool:
        got, want = _as_float(readback), _as_float(expected)
        if got is None or want is None:
            return False
        return abs(got - want) <= tolerance + abs(want) * 3e-7

    return matches


def _radio_matches(readback: str, expected: str) -> bool:
    got = [p.strip() for p in readback.strip().split(",")]
    want = expected.split(",")
    if len(got) != 4:
        return False
    return (
        _numeric(1e-3)(got[0], want[0])
        and _numeric(1e-3)(got[1], want[1])
        and got[2] == want[2]
        and got[3] == want[3]
    )


_ON_OFF = ("on", "off")

SETTINGS: dict[str, SettingSpec] = {
    # Identity
    "name": SettingSpec("name", _text(max_bytes=31, forbidden=_NAME_FORBIDDEN), _exact),
    "lat": SettingSpec("lat", _decimal_in("-90", "90", max_decimals=6), _numeric(1e-6)),
    "lon": SettingSpec("lon", _decimal_in("-180", "180", max_decimals=6), _numeric(1e-6)),
    "owner.info": SettingSpec("owner.info", _text(max_bytes=119, newline_to_pipe=True), _exact),
    "guest.password": SettingSpec("guest.password", _text(max_bytes=15), _exact, secret=True),
    # Radio (applies after reboot; strong confirm)
    "radio": SettingSpec(
        "radio", _normalize_radio, _radio_matches, reboot_required=True, strong_confirm=True
    ),
    "tx": SettingSpec("tx", _int_in(-9, 30), _numeric(0)),
    "dutycycle": SettingSpec(
        # get dutycycle prints 100/(af+1) with one decimal, so allow 0.05 slack.
        "dutycycle",
        _decimal_in("1", "100", max_decimals=1),
        _numeric(0.05 + 1e-9),
    ),
    "radio.rxgain": SettingSpec("radio.rxgain", _choice(_ON_OFF), _exact_ci),
    "int.thresh": SettingSpec("int.thresh", _int_in(0, 255), _numeric(0)),
    "agc.reset.interval": SettingSpec("agc.reset.interval", _int_in(0, 1020, step=4), _numeric(0)),
    # Routing
    "repeat": SettingSpec("repeat", _choice(_ON_OFF), _exact_ci),
    "allow.read.only": SettingSpec("allow.read.only", _choice(_ON_OFF), _exact_ci),
    "flood.max": SettingSpec("flood.max", _int_in(0, 64), _numeric(0)),
    "multi.acks": SettingSpec("multi.acks", _choice(("0", "1")), _numeric(0)),
    "loop.detect": SettingSpec("loop.detect", _choice(LOOP_DETECT_MODES), _exact_ci),
    "path.hash.mode": SettingSpec("path.hash.mode", _choice(("0", "1", "2")), _numeric(0)),
    "txdelay": SettingSpec("txdelay", _decimal_in("0", "2", max_decimals=3), _numeric(1e-6)),
    "direct.txdelay": SettingSpec(
        "direct.txdelay", _decimal_in("0", "2", max_decimals=3), _numeric(1e-6)
    ),
    # Adverts
    "advert.interval": SettingSpec(
        "advert.interval", _int_in(60, 240, step=2, allow_zero=True), _numeric(0)
    ),
    "flood.advert.interval": SettingSpec(
        "flood.advert.interval", _int_in(3, 168, allow_zero=True), _numeric(0)
    ),
}


def get_spec(setting: str) -> SettingSpec:
    spec = SETTINGS.get(setting)
    if spec is None:
        raise SettingValidationError(f"setting '{setting}' is not editable")
    return spec


def build_set_command(setting: str, value: str) -> tuple[SettingSpec, str, str]:
    """Validate and return ``(spec, normalized_value, cli_command)``.

    Raises ``SettingValidationError`` for anything off the allow-list or out of
    range; nothing is sent in that case.
    """
    spec = get_spec(setting)
    if not isinstance(value, str):
        raise SettingValidationError("value must be a string")
    normalized = spec.normalize(value)
    return spec, normalized, f"set {spec.verb} {normalized}"


def is_error_reply(reply: str | None) -> bool:
    """True when the firmware answered a ``set``/``get`` with an error sentinel."""
    if reply is None:
        return False
    text = reply.strip().lower()
    return (
        text.startswith("error")
        or text.startswith("unknown config")
        or text.startswith("unknown command")
        or text.startswith("??")
    )


def classify_result(
    spec: SettingSpec, expected: str, set_reply: str | None, readback: str | None
) -> SetStatus:
    """Outcome of one set + read-back round trip."""
    if is_error_reply(set_reply):
        return "rejected"
    if readback is None or is_error_reply(readback):
        return "unverified"
    return "ok" if spec.matches(readback, expected) else "mismatch"
