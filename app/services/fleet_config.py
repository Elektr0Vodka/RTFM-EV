"""Fleet config library: the rules for a stored config document.

A stored document is the device's own file format with nothing added:

- the file the Dutch MeshCore toolbox's USB config page writes for a repeater
  or room server: ``{vars, filter?, region?, hardware?, mqtt?}``, where a
  section exists only on firmware that has it;
- the version 1 file Settings > Radio writes for a companion.

Two rules hold for everything stored:

1. No secret value sits in a document. ``split_secrets`` takes them out and
   leaves ``{"$secret": null}``; the caller stores the value in the fleet
   vault and writes the vault id into that placeholder, or leaves it null when
   the vault is off or locked.
2. Nothing else is changed. A key this module does not know is kept where it
   is, in the order it came in, and written back as it was.

Which keys are secrets is decided by the file, not by the profile a document
is labelled with, so a wrong label cannot leak one. On top of the known keys,
a text value under a key whose name looks like a secret (password, token,
psk, ...) is treated as one: newer firmware adds keys this table has not seen.

A template is such a document with ``{{name}}`` variables in its text values
and no secret at all. Pure functions only: no database, no vault, no device.
"""

import json
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

SECRET = "$secret"
# Set on a placeholder whose value was not text (the toolbox turns an
# all-digit reply into a number): the vault then holds its JSON form.
ENCODED = "$json"

MAX_DEPTH = 12
MAX_DOCUMENT_BYTES = 256 * 1024
MAX_VARIABLES = 100

TOOLBOX_PROFILES = ("stock", "dmc_repeater", "dmc_observer")
PROFILES = (*TOOLBOX_PROFILES, "companion_v1")
_TOOLBOX_SECTIONS = ("filter", "region", "hardware", "mqtt")

VARIABLE_TYPES = ("text", "number", "boolean")
ASSET_VARIABLES = ("asset.label", "asset.org_serial", "asset.site_name")

Path = tuple[str | int, ...]

_ANY = object()

# Where a secret sits in a file, and the vault kind it is stored as. The
# toolbox file uses its own field names in ``mqtt`` and ``hardware``, not the
# CLI names (``wifiPassword``, not ``wifi.pwd``).
_SECRET_PATHS: tuple[tuple[tuple[Any, ...], str], ...] = (
    (("vars", "prv.key"), "private_key"),
    (("vars", "guest.password"), "guest_password"),
    (("mqtt", "wifiPassword"), "wifi"),
    (("mqtt", "alertPsk"), "other"),
    (("mqtt", "snmpCommunity"), "other"),
    (("mqtt", "slots", _ANY, "password"), "other"),
    (("mqtt", "slots", _ANY, "token"), "other"),
    (("hardware", "bridgeSecret"), "other"),
    (("private_key",), "private_key"),
)
_SECRET_NAME = re.compile(
    r"password|passwd|pwd|secret|token|psk|prv\.?key|private[._]?key", re.IGNORECASE
)

# What makes a file this one device's: left out of a template made from it.
_TOOLBOX_IDENTITY: tuple[Path, ...] = (("vars", "name"), ("vars", "lat"), ("vars", "lon"))
_COMPANION_IDENTITY: tuple[Path, ...] = (("name",), ("lat",), ("lon",), ("exported_at",))

_VARIABLE_USE = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
_VARIABLE_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
_INTEGER = re.compile(r"-?\d+")


class ConfigError(ValueError):
    """A document or template breaks a rule. The message is shown to the user."""


@dataclass(frozen=True)
class FoundSecret:
    """A secret taken out of a document."""

    path: Path
    kind: str
    # What goes into the vault: the text itself, or JSON when ``encoded``.
    text: str
    encoded: bool


def path_label(path: Path) -> str:
    """``vars/prv.key``, ``mqtt/slots/0/token``. Keys hold dots, so ``/`` separates."""
    return "/".join(str(part) for part in path)


def check_size(document: dict[str, Any]) -> None:
    if len(json.dumps(document)) > MAX_DOCUMENT_BYTES:
        raise ConfigError("The file is too large for a config")


def _is_version_1(document: dict[str, Any]) -> bool:
    version = document.get("version")
    return type(version) is int and version == 1


def detect_profile(document: Any) -> str:
    """The profile a file's shape points to. Raises when it is neither format."""
    if not isinstance(document, dict):
        raise ConfigError("A config file is a JSON object")
    if "vars" in document:
        if not isinstance(document["vars"], dict):
            raise ConfigError("This is not a toolbox config file: vars is not an object")
        for section in _TOOLBOX_SECTIONS:
            if section in document and not isinstance(document[section], dict):
                raise ConfigError(f"This is not a toolbox config file: {section} is not an object")
        slots = document.get("mqtt", {}).get("slots")
        if slots is not None and not isinstance(slots, list):
            raise ConfigError("This is not a toolbox config file: mqtt slots is not a list")
        if "mqtt" in document:
            return "dmc_observer"
        # The region tree is in stock firmware too; the packet filter is not.
        return "dmc_repeater" if "filter" in document else "stock"
    if (
        _is_version_1(document)
        and isinstance(document.get("name"), str)
        and isinstance(document.get("radio"), dict)
    ):
        return "companion_v1"
    raise ConfigError(
        "This is not a toolbox config file (no vars) and not a companion config file (version 1)"
    )


def profile_fits(profile: str, document: dict[str, Any]) -> bool:
    """Whether a document has the file format the profile belongs to."""
    if profile in TOOLBOX_PROFILES:
        return isinstance(document.get("vars"), dict)
    if profile == "companion_v1":
        return "vars" not in document and _is_version_1(document)
    return False


def _is_placeholder(value: Any) -> bool:
    return isinstance(value, dict) and SECRET in value


def _known_kind(path: Path) -> str | None:
    for pattern, kind in _SECRET_PATHS:
        if len(pattern) == len(path) and all(
            expected is _ANY or expected == part
            for expected, part in zip(pattern, path, strict=True)
        ):
            return kind
    return None


def _secret_kind(path: Path, value: Any) -> str | None:
    """The vault kind when ``value`` at ``path`` is a secret, else None."""
    if value is None or value == "" or _is_placeholder(value):
        return None
    known = _known_kind(path)
    if known is not None:
        return known
    if isinstance(value, str) and _SECRET_NAME.search(str(path[-1])):
        return "other"
    return None


def split_secrets(
    document: dict[str, Any], *, allow_placeholders: bool = False
) -> tuple[dict[str, Any], list[FoundSecret]]:
    """A copy of ``document`` without its secrets, and the secrets.

    Each secret becomes ``{"$secret": null}``; an empty one stays as it is. A
    file from outside must not hold a placeholder already; a template may hold
    empty ones (``allow_placeholders``).
    """
    found: list[FoundSecret] = []

    def walk(value: Any, path: Path) -> Any:
        if len(path) > MAX_DEPTH:
            raise ConfigError("The file is nested too deep for a config")
        if isinstance(value, dict):
            if SECRET in value:
                if not allow_placeholders or value != {SECRET: None}:
                    raise ConfigError(
                        f"{path_label(path)} holds a {SECRET} entry, which a file cannot have"
                    )
                return {SECRET: None}
            out: dict[str, Any] = {}
            for key, item in value.items():
                child = (*path, key)
                kind = _secret_kind(child, item)
                if kind is None:
                    out[key] = walk(item, child)
                    continue
                encoded = not isinstance(item, str)
                found.append(
                    FoundSecret(child, kind, json.dumps(item) if encoded else item, encoded)
                )
                out[key] = {SECRET: None}
            return out
        if isinstance(value, list):
            return [walk(item, (*path, index)) for index, item in enumerate(value)]
        return value

    return walk(document, ()), found


def set_placeholder(
    document: dict[str, Any], path: Path, secret_id: int, *, encoded: bool = False
) -> None:
    """Point the placeholder at ``path`` to a stored secret."""
    container: Any = document
    for part in path[:-1]:
        container = container[part]
    container[path[-1]] = {SECRET: secret_id, ENCODED: True} if encoded else {SECRET: secret_id}


def _placeholders(value: Any) -> Iterator[dict[str, Any]]:
    if _is_placeholder(value):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _placeholders(item)
    elif isinstance(value, list):
        for item in value:
            yield from _placeholders(item)


def secret_ids(document: dict[str, Any]) -> list[int]:
    """Vault ids the document points to."""
    return [
        placeholder[SECRET]
        for placeholder in _placeholders(document)
        if isinstance(placeholder[SECRET], int)
    ]


def count_placeholders(document: dict[str, Any]) -> tuple[int, int]:
    """``(secrets with a vault id, secrets with no stored value)``."""
    stored = len(secret_ids(document))
    return stored, sum(1 for _ in _placeholders(document)) - stored


def export_document(
    document: dict[str, Any], values: dict[int, str] | None
) -> tuple[dict[str, Any], int, int]:
    """The document as a file again: ``(file, secrets put back, secrets left out)``.

    ``values`` maps vault ids to what the vault holds; None exports without
    secrets. A key whose secret is not put back is left out of the file, so
    the file never carries a placeholder and stays readable by the toolbox.
    """
    counts = {"included": 0, "left_out": 0}
    missing = object()

    def restore(placeholder: dict[str, Any]) -> Any:
        secret_id = placeholder[SECRET]
        if values is not None and isinstance(secret_id, int) and secret_id in values:
            text = values[secret_id]
            try:
                value = json.loads(text) if placeholder.get(ENCODED) else text
            except ValueError:
                value = missing
            if value is not missing:
                counts["included"] += 1
                return value
        counts["left_out"] += 1
        return missing

    def walk(value: Any) -> Any:
        if _is_placeholder(value):
            return restore(value)
        if isinstance(value, dict):
            out: dict[str, Any] = {}
            for key, item in value.items():
                restored = walk(item)
                if restored is not missing:
                    out[key] = restored
            return out
        if isinstance(value, list):
            return [item for item in (walk(entry) for entry in value) if item is not missing]
        return value

    return walk(document), counts["included"], counts["left_out"]


def template_document(document: dict[str, Any]) -> dict[str, Any]:
    """A stored config as the start of a template.

    The device's identity (name, position, and for a companion the export
    date) is left out, and every secret becomes an empty placeholder: a
    template is not tied to one device or to its vault entries.
    """

    def walk(value: Any) -> Any:
        if _is_placeholder(value):
            return {SECRET: None}
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    template = walk(document)
    identity = _TOOLBOX_IDENTITY if "vars" in template else _COMPANION_IDENTITY
    for path in identity:
        container = template
        for part in path[:-1]:
            container = container.get(part) if isinstance(container, dict) else None
        if isinstance(container, dict):
            container.pop(path[-1], None)
    return template


def _used_variables(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        for match in _VARIABLE_USE.finditer(value):
            yield match.group(1)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _used_variables(item)
    elif isinstance(value, list):
        for item in value:
            yield from _used_variables(item)


def _typed(name: str, kind: str, raw: Any) -> Any:
    """``raw`` as the variable's type, or ConfigError."""
    if kind == "number":
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            return raw
        text = str(raw).strip()
        try:
            number = int(text) if _INTEGER.fullmatch(text) else float(text)
        except ValueError:
            raise ConfigError(f"{name} must be a number") from None
        if isinstance(number, float) and not math.isfinite(number):
            raise ConfigError(f"{name} must be a number")
        return number
    if kind == "boolean":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text not in ("true", "false"):
            raise ConfigError(f"{name} must be true or false")
        return text == "true"
    if isinstance(raw, bool):
        return "true" if raw else "false"
    return str(raw)


def _as_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def validate_template(profile: str, document: Any, variables: list[dict[str, Any]]) -> None:
    """Raise ConfigError unless this is a template that can be stored."""
    if not isinstance(document, dict) or not profile_fits(profile, document):
        raise ConfigError("The template document does not have the format of its profile")
    check_size(document)
    _stored, found = split_secrets(document, allow_placeholders=True)
    if found:
        raise ConfigError(
            f"A template cannot hold a secret ({path_label(found[0].path)}). "
            f'Leave it empty or write {{"{SECRET}": null}}; the value is asked for at apply.'
        )

    if len(variables) > MAX_VARIABLES:
        raise ConfigError("Too many variables")
    declared: set[str] = set()
    for variable in variables:
        name = variable.get("name")
        if not isinstance(name, str) or not _VARIABLE_NAME.fullmatch(name):
            raise ConfigError(
                "A variable name starts with a letter and holds letters, digits and _ only"
            )
        if name in declared:
            raise ConfigError(f"The variable {name} is listed twice")
        declared.add(name)
        kind = variable.get("type")
        if kind not in VARIABLE_TYPES:
            raise ConfigError(f"{name}: the type must be text, number or boolean")
        default = variable.get("default", "")
        if not isinstance(default, str):
            raise ConfigError(f"{name}: the default must be text")
        if default != "":
            _typed(name, kind, default)

    for used in _used_variables(document):
        if used not in declared and used not in ASSET_VARIABLES:
            raise ConfigError(
                f"The document uses {{{{{used}}}}}, which is not a variable of this template"
            )


def render_template(
    document: dict[str, Any],
    variables: list[dict[str, Any]],
    values: dict[str, Any],
    asset: dict[str, Any],
) -> dict[str, Any]:
    """The template with its variables filled in, for one asset.

    A value given in ``values`` wins over the variable's default. A text
    variable may be empty; a number or boolean without a value is missing.
    A text value that is one variable and nothing else takes the variable's
    type, so ``"{{power}}"`` becomes the number 20, not the text "20".
    """
    by_name = {variable["name"]: variable for variable in variables}
    missing: list[str] = []
    resolved: dict[str, Any] = {}

    def lookup(name: str) -> Any:
        if name in resolved:
            return resolved[name]
        value: Any = None
        if name in ASSET_VARIABLES:
            value = asset.get(name.split(".", 1)[1]) or None
        elif name in by_name:
            variable = by_name[name]
            kind = variable["type"]
            raw = values.get(name)
            if raw is None or (raw == "" and kind != "text"):
                raw = variable.get("default", "")
            if raw != "" or kind == "text":
                value = _typed(name, kind, raw)
        if value is None and name not in missing:
            missing.append(name)
        resolved[name] = value
        return value

    def fill(text: str) -> Any:
        whole = _VARIABLE_USE.fullmatch(text)
        if whole:
            return lookup(whole.group(1))

        def part(match: re.Match[str]) -> str:
            value = lookup(match.group(1))
            return "" if value is None else _as_text(value)

        return _VARIABLE_USE.sub(part, text)

    def walk(value: Any) -> Any:
        if isinstance(value, str):
            return fill(value)
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    rendered = walk(document)
    if missing:
        raise ConfigError(f"No value for: {', '.join(missing)}")
    return rendered
