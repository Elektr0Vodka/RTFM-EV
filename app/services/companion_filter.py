"""meshcomod companion receive filter, driven through the companion command line.

meshcomod's companion firmware (branch ``Feat/companion-receive-filter``) adds a
``filter`` CLI that hides or drops unwanted channel traffic on the radio itself
(``examples/companion_radio/CompanionFilter.cpp``). It has no binary frame, so
everything here is ``CMD_RUN_CLI_COMMAND`` text: the commands run on the radio and
never transmit.

The reply formats come from ``CompanionFilter.cpp`` and ``filter/FilterStats.h``.
A reply is at most 158 bytes; a list that did not fit ends in ``..`` and its last
entry may be cut, so it is dropped and the list is reported as truncated.
Patterns never contain spaces (the CLI splits on spaces), so an entry's pattern
runs up to its first space even when it contains a comma.
"""

import logging
import re
from typing import Any

from app.services.companion_cli import CompanionCliError, run_local_cli

logger = logging.getLogger(__name__)

PATH_MAX = 8
PATH_BYTES_MAX = 4
RULE_MAX = 8
SENDER_PATTERN_MAX = 15
TEXT_PATTERN_MAX = 23
AGE_MAX_MINS = 10080
SECS_MAX = 65535
COUNTER_KEYS = ("malformed", "age", "path", "sender", "text")
RULE_KINDS = ("sender", "text")

TRUNCATED_MARKER = ".."

_SUMMARY_RE = re.compile(
    r"^> Filter (?P<state>on|off): Hidden \[ Malformed: (?P<malformed>\d+) \| "
    r"Age: (?P<age>\d+) \| Path: (?P<path>\d+) \| Sender: (?P<sender>\d+) \| "
    r"Text: (?P<text>\d+) \]"
)
_MALFORMED_SETTING_RE = re.compile(r"^> Filter: malformed text scan (on|off)$")
_AGE_RE = re.compile(r"^> Message age: max (?P<mins>\d+)m, dropped (?P<dropped>\d+)")
_MALFORMED_STATS_RE = re.compile(
    r"^> Blocked (?P<total>\d+) \[ short:(?P<short>\d+) time:(?P<time>\d+) "
    r"empty:(?P<empty>\d+) utf8:(?P<utf8>\d+) \]"
)
_RULE_ENTRY_RE = re.compile(
    r"(?P<pattern>[^ ]+) (?:block|throttle (?P<secs>\d+)s)(?: (?P<prob>\d+)%)?"
)
_RULE_STAT_RE = re.compile(r"(?P<pattern>[^ ]+): (?P<hidden>\d+)(?: \(pass (?P<passes>\d+)\))?")
_PATH_STAT_RE = re.compile(r"(?P<prefix>[0-9A-Fa-f]+): (?P<hidden>\d+)")
_HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")

AGE_OFF_REPLY = "> Filter: message age limit off"
NO_MALFORMED_REPLY = "> Filter: no malformed drops recorded"
EMPTY_LIST_REPLY = "None"


class CompanionFilterError(Exception):
    """The radio refused a filter command, or answered with something unexpected."""


# ---- reply parsers --------------------------------------------------------------


def parse_summary(reply: str) -> dict[str, Any] | None:
    """``filter``: on/off state and the five hidden counters, or None."""
    match = _SUMMARY_RE.match(reply.strip())
    if match is None:
        return None
    return {
        "enabled": match.group("state") == "on",
        **{key: int(match.group(key)) for key in COUNTER_KEYS},
    }


def parse_malformed_setting(reply: str) -> bool | None:
    """``filter malformed``: whether the malformed scan is on."""
    match = _MALFORMED_SETTING_RE.match(reply.strip())
    return None if match is None else match.group(1) == "on"


def parse_age(reply: str) -> dict[str, Any] | None:
    """``filter age``: limit in minutes (0 = off), drops, and whether the clock is set."""
    text = reply.strip()
    if text == AGE_OFF_REPLY:
        return {"age_mins": 0, "dropped": None, "clock_set": None}
    match = _AGE_RE.match(text)
    if match is None:
        return None
    return {
        "age_mins": int(match.group("mins")),
        "dropped": int(match.group("dropped")),
        "clock_set": "clock not set" not in text,
    }


def parse_malformed_stats(reply: str) -> dict[str, int] | None:
    """``filter stats malformed``: the total and the count per reason."""
    text = reply.strip()
    if text == NO_MALFORMED_REPLY:
        return {"total": 0, "short": 0, "time": 0, "empty": 0, "utf8": 0}
    match = _MALFORMED_STATS_RE.match(text)
    if match is None:
        return None
    return {key: int(value) for key, value in match.groupdict().items()}


def _split_truncated(reply: str) -> tuple[str, bool]:
    text = reply.strip()
    if text.endswith(TRUNCATED_MARKER):
        return text[: -len(TRUNCATED_MARKER)], True
    return text, False


def _walk_entries(text: str, entry_re: re.Pattern[str]) -> list[re.Match[str]] | None:
    """Match comma-separated entries from the start; None when the text does not parse."""
    matches: list[re.Match[str]] = []
    pos = 0
    while pos < len(text):
        match = entry_re.match(text, pos)
        if match is None:
            return None
        matches.append(match)
        pos = match.end()
        if pos < len(text):
            if text[pos] != ",":
                return None
            pos += 1
    return matches


def _parse_entries(
    reply: str, entry_re: re.Pattern[str]
) -> tuple[list[re.Match[str]], bool] | None:
    text, truncated = _split_truncated(reply)
    if not truncated and text == EMPTY_LIST_REPLY:
        return [], False
    if truncated:
        # The cut can land anywhere in the last entry (a rule can lose its
        # " 50%", a prefix its last digits), so only entries before the last
        # comma are trusted. A pattern may itself contain commas, so walk the
        # longest prefix that parses.
        cut = text.rstrip(",")
        while cut:
            idx = cut.rfind(",")
            if idx < 0:
                return [], True
            cut = cut[:idx]
            matches = _walk_entries(cut, entry_re)
            if matches is not None:
                return matches, True
        return [], True
    matches = _walk_entries(text, entry_re)
    if matches is None:
        return None
    return matches, False


def parse_path_list(reply: str) -> tuple[list[str], bool] | None:
    """``filter path list``: prefixes (upper-case hex) and whether the list was clipped."""
    text, truncated = _split_truncated(reply)
    if not truncated and text == EMPTY_LIST_REPLY:
        return [], False
    parts = [part for part in text.split(",") if part]
    if truncated and parts:
        parts = parts[:-1]
    if not all(_HEX_RE.match(part) for part in parts):
        return None
    return [part.upper() for part in parts], truncated


def parse_path_stats(reply: str) -> tuple[dict[str, int], bool] | None:
    """``filter stats path``: drops per prefix."""
    parsed = _parse_entries(reply, _PATH_STAT_RE)
    if parsed is None:
        return None
    matches, truncated = parsed
    return {m.group("prefix").upper(): int(m.group("hidden")) for m in matches}, truncated


def parse_rule_list(reply: str) -> tuple[list[dict[str, Any]], bool] | None:
    """``filter sender|text list``: rules in firmware order."""
    parsed = _parse_entries(reply, _RULE_ENTRY_RE)
    if parsed is None:
        return None
    matches, truncated = parsed
    rules = [
        {
            "pattern": m.group("pattern"),
            "secs": int(m.group("secs") or 0),
            "prob": int(m.group("prob") or 100),
        }
        for m in matches
    ]
    return rules, truncated


def parse_rule_stats(reply: str) -> tuple[dict[str, dict[str, int]], bool] | None:
    """``filter stats sender|text``: hidden count and throttle passes per rule."""
    parsed = _parse_entries(reply, _RULE_STAT_RE)
    if parsed is None:
        return None
    matches, truncated = parsed
    stats = {
        m.group("pattern"): {
            "hidden": int(m.group("hidden")),
            "passes": int(m.group("passes") or 0),
        }
        for m in matches
    }
    return stats, truncated


def is_success_reply(reply: str) -> bool:
    """True for a ``> Filter: ...`` confirmation, false for ``Failed`` and errors."""
    text = reply.strip()
    if not text.startswith("> Filter: "):
        return False
    rest = text[len("> Filter: ") :]
    return not rest.startswith(("error", "syntax error", "command error"))


# ---- input validation -----------------------------------------------------------


def normalize_path_prefix(value: str) -> str:
    prefix = value.strip().upper()
    if not _HEX_RE.match(prefix) or len(prefix) % 2 or not 2 <= len(prefix) <= 2 * PATH_BYTES_MAX:
        raise ValueError("A path prefix is 2-8 hex digits (whole bytes)")
    return prefix


def validate_pattern(kind: str, pattern: str) -> str:
    """A rule pattern as the firmware accepts it: no spaces, byte length capped."""
    if kind not in RULE_KINDS:
        raise ValueError(f"Unknown rule list {kind!r}")
    if not pattern or any(ch.isspace() for ch in pattern):
        raise ValueError("A pattern cannot be empty or contain spaces")
    if any(ord(ch) < 32 for ch in pattern):
        raise ValueError("A pattern cannot contain control characters")
    limit = SENDER_PATTERN_MAX if kind == "sender" else TEXT_PATTERN_MAX
    if len(pattern.encode("utf-8")) > limit:
        raise ValueError(f"A {kind} pattern is at most {limit} bytes")
    return pattern


def validate_rule_args(secs: int, prob: int) -> None:
    if not 0 <= secs <= SECS_MAX:
        raise ValueError(f"secs is 0-{SECS_MAX}")
    if not 1 <= prob <= 100:
        raise ValueError("prob is 1-100")


def validate_age(age_mins: int) -> None:
    if not 0 <= age_mins <= AGE_MAX_MINS:
        raise ValueError(f"The age limit is 1-{AGE_MAX_MINS} minutes, or 0 for off")


def rule_add_command(kind: str, pattern: str, secs: int, prob: int) -> str:
    validate_pattern(kind, pattern)
    validate_rule_args(secs, prob)
    command = f"filter {kind} add {pattern}"
    if secs or prob != 100:
        command += f" {secs}"
    if prob != 100:
        command += f" {prob}"
    return command


# ---- radio operations -----------------------------------------------------------


async def _run(mc, command: str) -> str:
    try:
        return await run_local_cli(mc, command)
    except CompanionCliError as exc:
        raise CompanionFilterError(str(exc)) from exc


async def _run_change(mc, command: str) -> str:
    reply = await _run(mc, command)
    if not is_success_reply(reply):
        raise CompanionFilterError(f"The radio refused '{command}': {reply.strip() or '(empty)'}")
    return reply


async def probe_filter(mc) -> bool:
    """True when the radio answers ``filter`` with the filter summary."""
    try:
        reply = await run_local_cli(mc, "filter")
    except Exception as exc:  # noqa: BLE001 - a probe never breaks connect
        logger.debug("Companion filter probe failed: %s", exc)
        return False
    return parse_summary(reply) is not None


async def read_counters(mc) -> dict[str, Any] | None:
    """The ``filter`` summary only (the 60s sampler's single command)."""
    return parse_summary(await _run(mc, "filter"))


def _require(value, command: str, reply: str):
    if value is None:
        raise CompanionFilterError(f"Unexpected reply to '{command}': {reply.strip()!r}")
    return value


async def read_filter(mc) -> dict[str, Any]:
    """Settings and live counters, parsed from ten CLI replies."""
    replies: dict[str, str] = {}
    for command in (
        "filter",
        "filter malformed",
        "filter age",
        "filter path list",
        "filter sender list",
        "filter text list",
        "filter stats malformed",
        "filter stats path",
        "filter stats sender",
        "filter stats text",
    ):
        replies[command] = await _run(mc, command)

    def parsed(command: str, parser):
        return _require(parser(replies[command]), command, replies[command])

    summary = parsed("filter", parse_summary)
    malformed_on = parsed("filter malformed", parse_malformed_setting)
    age = parsed("filter age", parse_age)
    paths, paths_truncated = parsed("filter path list", parse_path_list)
    path_stats, path_stats_truncated = parsed("filter stats path", parse_path_stats)
    malformed_stats = parsed("filter stats malformed", parse_malformed_stats)

    rules: dict[str, list[dict[str, Any]]] = {}
    truncated = {"path": paths_truncated or path_stats_truncated}
    for kind in RULE_KINDS:
        rule_list, list_truncated = parsed(f"filter {kind} list", parse_rule_list)
        rule_stats, stats_truncated = parsed(f"filter stats {kind}", parse_rule_stats)
        for rule in rule_list:
            stat = rule_stats.get(rule["pattern"])
            rule["hidden"] = stat["hidden"] if stat else None
            rule["passes"] = stat["passes"] if stat else None
        rules[kind] = rule_list
        truncated[kind] = list_truncated or stats_truncated

    return {
        "config": {
            "enabled": summary["enabled"],
            "malformed": malformed_on,
            "age_mins": age["age_mins"],
            "paths": paths,
            "sender_rules": [
                {k: r[k] for k in ("pattern", "secs", "prob")} for r in rules["sender"]
            ],
            "text_rules": [{k: r[k] for k in ("pattern", "secs", "prob")} for r in rules["text"]],
        },
        "counters": {key: summary[key] for key in COUNTER_KEYS},
        "malformed_reasons": {k: v for k, v in malformed_stats.items() if k != "total"},
        "age_clock_set": age["clock_set"],
        "path_hits": [{"prefix": p, "hidden": path_stats.get(p)} for p in paths],
        "sender_rules": rules["sender"],
        "text_rules": rules["text"],
        "truncated": truncated,
    }


async def apply_settings(
    mc,
    *,
    enabled: bool | None = None,
    malformed: bool | None = None,
    age_mins: int | None = None,
) -> None:
    if malformed is not None:
        await _run_change(mc, f"filter malformed {'on' if malformed else 'off'}")
    if age_mins is not None:
        validate_age(age_mins)
        await _run_change(mc, f"filter age {age_mins if age_mins else 'off'}")
    if enabled is not None:
        await _run_change(mc, f"filter {'on' if enabled else 'off'}")


async def add_path(mc, prefix: str) -> None:
    await _run_change(mc, f"filter path add {normalize_path_prefix(prefix)}")


async def remove_path(mc, prefix: str) -> None:
    await _run_change(mc, f"filter path remove {normalize_path_prefix(prefix)}")


async def add_rule(mc, kind: str, pattern: str, secs: int = 0, prob: int = 100) -> None:
    await _run_change(mc, rule_add_command(kind, pattern, secs, prob))


async def remove_rule(mc, kind: str, pattern: str) -> None:
    validate_pattern(kind, pattern)
    await _run_change(mc, f"filter {kind} remove {pattern}")


async def restore_config(mc, config: dict[str, Any]) -> None:
    """Replace the radio's filter settings with ``config`` (a backup)."""
    await _run_change(mc, "filter reset")
    await apply_settings(
        mc,
        malformed=bool(config.get("malformed")),
        age_mins=int(config.get("age_mins") or 0),
    )
    for prefix in config.get("paths") or []:
        await add_path(mc, prefix)
    for kind in RULE_KINDS:
        for rule in config.get(f"{kind}_rules") or []:
            await add_rule(
                mc,
                kind,
                rule["pattern"],
                int(rule.get("secs") or 0),
                int(rule.get("prob") or 100),
            )
    await apply_settings(mc, enabled=bool(config.get("enabled")))


def counter_deltas(samples: list[dict[str, Any]]) -> list[dict[str, int]]:
    """Per-interval hidden counts from cumulative samples (oldest first).

    Each sample has ``timestamp``, the five counters and ``radio_identity_id``.
    The counters live in RAM on the radio, so a value lower than the previous
    sample means the radio restarted: that interval counts the new value. No
    delta is taken across two radios.
    """
    out: list[dict[str, int]] = []
    previous: dict[int | None, dict[str, Any]] = {}
    for sample in samples:
        radio = sample.get("radio_identity_id")
        before_sample = previous.get(radio)
        if before_sample is not None:
            row: dict[str, int] = {"timestamp": int(sample["timestamp"])}
            for key in COUNTER_KEYS:
                now = int(sample.get(key) or 0)
                before = int(before_sample.get(key) or 0)
                row[key] = now - before if now >= before else now
            out.append(row)
        previous[radio] = sample
    return out


def bin_deltas(
    deltas: list[dict[str, int]], start_ts: int, end_ts: int, bin_count: int
) -> list[dict[str, int]]:
    """Sum per-interval deltas into ``bin_count`` equal bins over the window."""
    span = max(1, end_ts - start_ts)
    width = span / bin_count
    bins = [
        {"timestamp": int(start_ts + i * width), **dict.fromkeys(COUNTER_KEYS, 0)}
        for i in range(bin_count)
    ]
    for row in deltas:
        ts = row["timestamp"]
        if ts < start_ts or ts > end_ts:
            continue
        idx = min(bin_count - 1, int((ts - start_ts) / width))
        for key in COUNTER_KEYS:
            bins[idx][key] += row[key]
    return bins
