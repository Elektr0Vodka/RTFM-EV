"""Fleet config library: a stored config against what the node reported.

Read-only. "Reported" means values this app already stored: the newest
snapshot of each repeater or room pane (``device_config_history``: node info,
radio settings, advert intervals, owner info, regions) and the newest SNMP
poll. Nothing here asks a node anything; a setting whose pane was never
fetched is listed as not reported.

Only keys both sides have are compared, and only for a toolbox-format config
(a companion has no panes). The three sides name and write the same setting
differently, so each compared key has a rule:

- The panes store the CLI reply as text (``"22"``, ``"on"``,
  ``"869.6179809,62.5,7,5"``).
- The toolbox file holds parsed values: numbers, booleans, the radio as
  ``{freq, bw, sf, cr}``. It rounds the position to 5 decimals and the
  frequency to 3, so those are compared within half of that step.
- Where the settings editor's allow-list (``repeater_settings``) has a
  read-back rule for the same CLI key that fits the file's value as well, that
  rule is used. It does not fit the position (the editor expects 6 decimals).

Pure functions: the caller reads the snapshots and hands them in.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.services import repeater_settings
from app.services.fleet_config import Path, path_label

Snapshots = dict[str, dict[str, Any]]

# Float32 on the device and 7 printed digits: the same slack the editor allows.
_RELATIVE_SLACK = 3e-7


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def _number_within(tolerance: float) -> Callable[[Any, str], bool]:
    def same(configured: Any, reported: str) -> bool:
        want, got = _as_number(configured), _as_number(reported)
        if want is None or got is None:
            return False
        return abs(got - want) <= tolerance + abs(want) * _RELATIVE_SLACK

    return same


def _same_text(configured: Any, reported: str) -> bool:
    return str(configured).strip() == reported.strip()


def _same_owner_info(configured: Any, reported: str) -> bool:
    # The CLI shows a line break as "|"; the toolbox file holds the line break.
    def lines(text: str) -> str:
        return text.replace("|", "\n").strip()

    return lines(str(configured)) == lines(reported)


def _cli_text(value: Any) -> str:
    """A document value the way the CLI writes it: on/off for a switch."""
    if isinstance(value, bool):
        return "on" if value else "off"
    return str(value).strip()


def _editor_rule(setting: str) -> Callable[[Any, str], bool]:
    """The settings editor's read-back rule for a CLI key."""
    matches = repeater_settings.get_spec(setting).matches

    def same(configured: Any, reported: str) -> bool:
        return matches(reported, _cli_text(configured))

    return same


def _field(kind: str, name: str) -> Callable[[Snapshots], tuple[str, int, str] | None]:
    """Reads one stored reply: ``(text, timestamp, source)`` or None when absent."""

    def read(snapshots: Snapshots) -> tuple[str, int, str] | None:
        snapshot = snapshots.get(kind)
        if snapshot is None:
            return None
        value = snapshot["data"].get(name)
        if value is None or isinstance(value, (dict, list)):
            return None
        text = str(value)
        if text.strip() == "" or repeater_settings.is_error_reply(text):
            return None
        return text, snapshot["timestamp"], kind

    return read


def _newest(
    *readers: Callable[[Snapshots], tuple[str, int, str] | None],
) -> Callable[[Snapshots], tuple[str, int, str] | None]:
    def read(snapshots: Snapshots) -> tuple[str, int, str] | None:
        found = [value for value in (reader(snapshots) for reader in readers) if value is not None]
        return max(found, key=lambda value: value[1]) if found else None

    return read


def _radio_part(index: int) -> Callable[[Snapshots], tuple[str, int, str] | None]:
    whole = _field("radio_settings", "radio")

    def read(snapshots: Snapshots) -> tuple[str, int, str] | None:
        value = whole(snapshots)
        if value is None:
            return None
        parts = [part.strip() for part in value[0].split(",")]
        if len(parts) != 4:
            return None
        return parts[index], value[1], value[2]

    return read


def _home_region(snapshots: Snapshots) -> tuple[str, int, str] | None:
    """The home region of the admin dump; "" when it has none.

    A guest only gets the flood-allowed names, and a dump cut off at the
    firmware's buffer may have lost the home mark: neither says what the home
    region is.
    """
    snapshot = snapshots.get("regions")
    if snapshot is None or snapshot["data"].get("source") != "cli":
        return None
    entries = snapshot["data"].get("regions")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("is_home"):
            return str(entry.get("name", "")), snapshot["timestamp"], "regions"
    if snapshot["data"].get("truncated"):
        return None
    return "", snapshot["timestamp"], "regions"


@dataclass(frozen=True)
class _Rule:
    path: Path
    read: Callable[[Snapshots], tuple[str, int, str] | None]
    same: Callable[[Any, str], bool]


# In the order of the toolbox file. Half a step of the file's rounding, plus
# the float slack, decides "same" for the position and the frequency.
_RULES: tuple[_Rule, ...] = (
    _Rule(
        ("vars", "name"),
        _newest(
            _field("node_info", "name"), _field("owner_info", "name"), _field("snmp", "node_name")
        ),
        _same_text,
    ),
    _Rule(("vars", "lat"), _field("node_info", "lat"), _number_within(5e-6)),
    _Rule(("vars", "lon"), _field("node_info", "lon"), _number_within(5e-6)),
    _Rule(("vars", "radio", "freq"), _radio_part(0), _number_within(5e-4)),
    _Rule(("vars", "radio", "bw"), _radio_part(1), _number_within(1e-3)),
    _Rule(("vars", "radio", "sf"), _radio_part(2), _number_within(0)),
    _Rule(("vars", "radio", "cr"), _radio_part(3), _number_within(0)),
    _Rule(("vars", "tx"), _field("radio_settings", "tx_power"), _editor_rule("tx")),
    _Rule(("vars", "af"), _field("radio_settings", "airtime_factor"), _number_within(1e-6)),
    _Rule(("vars", "repeat"), _field("radio_settings", "repeat_enabled"), _editor_rule("repeat")),
    _Rule(("vars", "flood.max"), _field("radio_settings", "flood_max"), _editor_rule("flood.max")),
    _Rule(
        ("vars", "advert.interval"),
        _field("advert_intervals", "advert_interval"),
        _editor_rule("advert.interval"),
    ),
    _Rule(
        ("vars", "flood.advert.interval"),
        _field("advert_intervals", "flood_advert_interval"),
        _editor_rule("flood.advert.interval"),
    ),
    _Rule(("vars", "owner.info"), _field("owner_info", "owner_info"), _same_owner_info),
    _Rule(("region", "home"), _home_region, _same_text),
)

_ABSENT = object()


def _configured(document: dict[str, Any], path: Path) -> Any:
    """The document's plain value at ``path``; ``_ABSENT`` when there is none to compare."""
    value: Any = document
    for part in path:
        if not isinstance(value, dict) or part not in value:
            return _ABSENT
        value = value[part]
    if value is None or isinstance(value, (dict, list)):
        return _ABSENT
    return value


def _display(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value)


def compare(
    document: dict[str, Any], snapshots: Snapshots
) -> tuple[list[dict[str, Any]], list[str]]:
    """``(rows, not_reported)`` for a stored config and the newest stored reports.

    ``snapshots`` maps a pane kind (and ``snmp``) to ``{"timestamp", "data"}``.
    A row is one setting both sides have: what the config holds, what the node
    reported, when that report was stored, where it came from, and whether
    they are the same. ``not_reported`` lists the settings of the config that
    could be compared but have no stored report.
    """
    if not isinstance(document.get("vars"), dict):
        return [], []
    rows: list[dict[str, Any]] = []
    not_reported: list[str] = []
    for rule in _RULES:
        configured = _configured(document, rule.path)
        if configured is _ABSENT:
            continue
        label = path_label(rule.path)
        report = rule.read(snapshots)
        if report is None:
            not_reported.append(label)
            continue
        text, timestamp, source = report
        rows.append(
            {
                "path": label,
                "configured": _display(configured),
                "reported": text.strip(),
                "reported_at": timestamp,
                "source": source,
                "same": rule.same(configured, text),
            }
        )
    return rows, not_reported
