"""An observer's web config over the LAN (plan 32, Phase 4): the rules.

DMC observer firmware can serve a small web config on its LAN address once
``start webconfig`` was given on its command line
(``src/helpers/esp32/WebConfigServer.cpp``, ``dmc-observer-dev``). It speaks
plain HTTP on port 80:

- ``GET /api/status``: mode (``lan`` or ``setup``), name, the first 8 bytes of
  the public key (``node_id``), firmware, role, board. No login needed.
- ``POST /api/login {password}``: the node's admin password; a session cookie.
- ``GET /api/config``: the settings, in the web config's own JSON names. The
  Wi-Fi password and the broker passwords and tokens are masked.
- ``POST /api/config {set: {<CLI key>: <text>}, reboot, reqid}``: queues
  ``set <key> <text>`` for each key; only an allow-list of keys is taken
  (``src/helpers/WebConfigKeys.h``). ``GET /api/config/result?reqid=`` then
  answers the reply of each command.

This module is pure: it validates the address, turns a ``GET /api/config``
answer into the toolbox file format, plans the ``set`` commands for a stored
config and checks one command's result. The HTTP calls are in
``fleet_webconfig_client``.

Rules this keeps: one key per save (so the apply goes one command at a time
and can stop at the first unexpected reply), never ``reboot``, never the
web config's command terminal (``/api/cli``, which is not allow-listed), never
the private key or the admin password.
"""

import ipaddress
import math
import re
import socket
from collections.abc import Callable
from typing import Any

from app.services.fleet_device_cli import (
    _MISSING,
    ApplyPlan,
    ApplyStep,
    _as_text,
    _js_round,
    _number,
    _plan_mqtt_field,
    _Planner,
    _var_text,
    normalize_packet_filter,
    resolve_secrets,
    same_var,
)
from app.snmp.address import normalize_host

PORT = 80
SECRET_SENTINEL = "********"

# The web config's allow-list (WebConfigKeys.h WC_ALLOWED_SET_KEYS), plus the
# per-slot keys mqtt1..6.<field>. The admin password is a separate key there;
# this app never sends it.
ALLOWED_SET_KEYS = (
    "name",
    "lat",
    "lon",
    "radio",
    "tx",
    "af",
    "rxdelay",
    "txdelay",
    "cad",
    "radio.rxgain",
    "repeat",
    "advert.interval",
    "flood.advert.interval",
    "flood.max",
    "flood.max.advert",
    "flood.max.unscoped",
    "loop.detect",
    "wifi.ssid",
    "wifi.pwd",
    "wifi.powersave",
    "mqtt.origin",
    "mqtt.iata",
    "mqtt.status",
    "mqtt.packets",
    "mqtt.raw",
    "mqtt.tx",
    "mqtt.rx",
    "mqtt.interval",
    "mqtt.neighbors",
    "mqtt.neighbors.interval",
    "mqtt.ntp",
    "mqtt.owner",
    "mqtt.email",
    "timezone",
    "timezone.offset",
    "snmp",
    "snmp.community",
)
_SLOT_FIELDS = ("preset", "server", "port", "username", "password", "token", "topic", "audience")
_SLOT_KEY = re.compile(
    r"mqtt([1-6])\.(preset|server|port|username|password|token|topic|audience|filter)"
)
# What the web config masks in its answers (WebConfigKeys.h wcIsSecretKey).
_MASKED = ("wifi.pwd",)
_MASKED_SLOT_FIELDS = ("password", "token")
_START_REPLY = re.compile(r"WebConfig started: http://([0-9A-Fa-f.:\[\]]+)/")
_NODE_ID = re.compile(r"[0-9a-f]{16}")
_REQUEST_ID = re.compile(r"[0-9a-f]{16}")


class WebConfigError(ValueError):
    """The web config cannot be used for this. ``code`` is shown translated."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


# --- the address --------------------------------------------------------------


# A LAN address is one of these ranges and nothing else: ``is_private`` also
# counts loopback, link-local and the documentation ranges.
_LAN_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
)


def _is_lan(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped
    return any(address in network for network in _LAN_NETWORKS)


def lan_address(host: str, *, resolve: Callable[..., list[Any]] = socket.getaddrinfo) -> str:
    """The LAN address to connect to for ``host``, or WebConfigError.

    The host is an address or a name; a name must resolve to LAN addresses
    only (private ranges; never loopback, link-local or a public address), so
    the server cannot be pointed at itself, at a cloud metadata address or at
    the internet. The answer is the address itself, which is what the server
    then connects to, so a second lookup cannot give another one.
    """
    try:
        name = normalize_host(host)
    except ValueError:
        raise WebConfigError("host_invalid") from None
    try:
        infos = resolve(name, PORT, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError):
        raise WebConfigError("host_unresolved") from None
    addresses: list[str] = []
    for info in infos:
        text = str(info[4][0]).split("%", 1)[0]
        try:
            address = ipaddress.ip_address(text)
        except ValueError:
            raise WebConfigError("host_not_lan") from None
        if not _is_lan(address):
            raise WebConfigError("host_not_lan")
        addresses.append(str(address))
    if not addresses:
        raise WebConfigError("host_unresolved")
    ipv4 = [address for address in addresses if ":" not in address]
    return (ipv4 or addresses)[0]


def parse_start_reply(reply: str | None) -> str | None:
    """The address in ``start webconfig``'s reply, or None (``Err: ...``)."""
    match = _START_REPLY.search(reply or "")
    if not match:
        return None
    text = match.group(1).strip("[]")
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def identity_matches(status: dict[str, Any], public_key: str) -> bool:
    """Whether ``/api/status``'s ``node_id`` (8 bytes) is the start of ``public_key``."""
    node_id = str(status.get("node_id") or "").lower()
    return bool(_NODE_ID.fullmatch(node_id)) and public_key.lower().startswith(node_id)


def new_request_id(random_hex: Callable[[int], str]) -> str:
    """A request id as the web config wants it: 16 hex characters."""
    request_id = random_hex(8).lower()
    if not _REQUEST_ID.fullmatch(request_id):
        raise ValueError("a request id is 16 hex characters")
    return request_id


# --- reading ------------------------------------------------------------------


def _radio_text(value: Any) -> str:
    """A JSON number as the CLI writes it: 62.5, 250 (not 250.0)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return _as_text(value)
    return _as_text(_number(float(value)))


def _num(value: Any) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return _number(float(value))


def _round(value: Any, digits: int) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return _js_round(float(value), digits)


def _section(config: dict[str, Any], name: str) -> dict[str, Any]:
    section = config.get(name)
    return section if isinstance(section, dict) else {}


def _masked(value: Any) -> bool:
    return value == SECRET_SENTINEL


def document_from_config(config: dict[str, Any]) -> dict[str, Any]:
    """``GET /api/config`` as a toolbox file: the settings the web config shows.

    Only those: no packet filter, region, hardware, alerts, guest password,
    private key or owner info, which the web config does not show. A masked
    secret is left out, an empty one is kept as empty.
    """
    radio = _section(config, "radio")
    variables: dict[str, Any] = {}

    def put(key: str, value: Any) -> None:
        if value is not None:
            variables[key] = value

    put("name", radio.get("name"))
    put("repeat", radio.get("repeat"))
    if all(part in radio for part in ("freq", "bw", "sf", "cr")):
        freq = radio["freq"]
        variables["radio"] = {
            "freq": f"{float(freq):.3f}" if isinstance(freq, (int, float)) else _as_text(freq),
            "bw": _radio_text(radio["bw"]),
            "sf": _as_text(radio["sf"]),
            "cr": _as_text(radio["cr"]),
        }
    put("tx", _num(radio.get("tx")))
    put("af", _num(radio.get("af")))
    put("rxdelay", _round(radio.get("rxdelay"), 1))
    put("txdelay", _round(radio.get("txdelay"), 1))
    put("flood.max", _num(radio.get("flood_max")))
    put("flood.advert.interval", _num(radio.get("flood_advert_interval")))
    put("advert.interval", _num(radio.get("advert_interval")))
    put("lat", _round(radio.get("lat"), 5))
    put("lon", _round(radio.get("lon"), 5))
    put("loop.detect", radio.get("loop_detect"))
    put("cad", radio.get("cad"))
    put("flood.max.unscoped", _num(radio.get("flood_max_unscoped")))
    put("flood.max.advert", _num(radio.get("flood_max_advert")))
    put("radio.rxgain", radio.get("rxgain"))
    document: dict[str, Any] = {"vars": variables}

    wifi = _section(config, "wifi")
    if not isinstance(config.get("mqtt"), dict):
        return document
    mqtt_in = _section(config, "mqtt")
    mqtt: dict[str, Any] = {}

    def put_mqtt(key: str, value: Any) -> None:
        if value is not None and not _masked(value):
            mqtt[key] = value

    put_mqtt("origin", mqtt_in.get("origin"))
    put_mqtt("iata", mqtt_in.get("iata"))
    put_mqtt("status", mqtt_in.get("status"))
    put_mqtt("packets", mqtt_in.get("packets"))
    put_mqtt("raw", mqtt_in.get("raw"))
    put_mqtt("tx", mqtt_in.get("tx"))
    put_mqtt("rx", mqtt_in.get("rx"))
    put_mqtt("interval", _num(mqtt_in.get("interval")))
    put_mqtt("neighbors", mqtt_in.get("neighbors"))
    put_mqtt("neighborsInterval", _num(mqtt_in.get("neighbors_interval")))
    put_mqtt("ntp", mqtt_in.get("ntp"))
    put_mqtt("owner", mqtt_in.get("owner"))
    put_mqtt("email", mqtt_in.get("email"))
    slots = []
    for slot_in in mqtt_in.get("slots") or []:
        if not isinstance(slot_in, dict):
            continue
        slot: dict[str, Any] = {}
        for field in _SLOT_FIELDS:
            value = slot_in.get(field)
            if value is not None and not _masked(value):
                slot[field] = _num(value) if field == "port" else value
        slot["filter"] = normalize_packet_filter(slot_in.get("filter"))
        slots.append(slot)
    mqtt["slots"] = slots
    put_mqtt("snmp", mqtt_in.get("snmp"))
    put_mqtt("snmpCommunity", mqtt_in.get("snmp_community"))
    put_mqtt("wifiSsid", wifi.get("ssid"))
    put_mqtt("wifiPassword", wifi.get("pwd"))
    put_mqtt("wifiPowersave", wifi.get("powersave"))
    put_mqtt("timezone", mqtt_in.get("timezone"))
    put_mqtt("timezoneOffset", _num(mqtt_in.get("timezone_offset")))
    document["mqtt"] = mqtt
    return document


def _device_masked(config: dict[str, Any], path: tuple[str | int, ...]) -> bool:
    """Whether the device holds a value at ``path`` that the web config hides."""
    if path == ("mqtt", "wifiPassword"):
        wifi = _section(config, "wifi")
        return _masked(wifi.get("pwd"))
    if len(path) == 4 and path[1] == "slots" and path[3] in _MASKED_SLOT_FIELDS:
        slots = _section(config, "mqtt").get("slots") or []
        index = int(path[2])
        if index < len(slots) and isinstance(slots[index], dict):
            return _masked(slots[index].get(str(path[3])))
    return False


# --- planning -----------------------------------------------------------------

# The vars the web config can set, in the toolbox file's order.
_LAN_VARS = (
    "name",
    "repeat",
    "radio",
    "tx",
    "af",
    "rxdelay",
    "txdelay",
    "flood.max",
    "flood.advert.interval",
    "advert.interval",
    "lat",
    "lon",
    "loop.detect",
    "cad",
    "flood.max.unscoped",
    "flood.max.advert",
    "radio.rxgain",
)
# (file field, CLI key, kind, secret, reboot): in the order the toolbox writes them.
_LAN_MQTT: tuple[tuple[str, str, str, bool, bool], ...] = (
    ("origin", "mqtt.origin", "text", False, False),
    ("iata", "mqtt.iata", "text", False, False),
    ("status", "mqtt.status", "bool", False, False),
    ("packets", "mqtt.packets", "bool", False, False),
    ("raw", "mqtt.raw", "bool", False, False),
    ("tx", "mqtt.tx", "choice", False, False),
    ("rx", "mqtt.rx", "bool", False, False),
    ("interval", "mqtt.interval", "number", False, False),
    ("neighbors", "mqtt.neighbors", "bool", False, False),
    ("neighborsInterval", "mqtt.neighbors.interval", "number", False, False),
    ("ntp", "mqtt.ntp", "text", False, False),
    ("owner", "mqtt.owner", "text", False, False),
    ("email", "mqtt.email", "text", False, False),
    ("wifiSsid", "wifi.ssid", "text", False, True),
    ("wifiPassword", "wifi.pwd", "text", True, True),
    ("wifiPowersave", "wifi.powersave", "choice", False, False),
    ("timezone", "timezone", "text", False, False),
    ("timezoneOffset", "timezone.offset", "number", False, False),
)
_LAN_MQTT_END: tuple[tuple[str, str, str, bool, bool], ...] = (
    ("snmp", "snmp", "bool", False, True),
    ("snmpCommunity", "snmp.community", "text", False, True),
)
# mqtt fields of the file that only describe the device, never set.
_MQTT_CAPABILITY = ("neighborsSupported",)
_MQTT_SECTIONS_ON_LAN = ("vars", "mqtt")


def _lan_mqtt_change(
    planner: _Planner,
    path: tuple[str | int, ...],
    key: str,
    kind: str,
    secret: bool,
    reboot: bool,
    value: Any,
    current: Any,
    config: dict[str, Any],
) -> None:
    """One mqtt setting over the web config; an empty value is never sent."""
    if value is _MISSING:
        planner.skip(path, "secret_unavailable", secret=True)
        return
    if _device_masked(config, path):
        # The device has a value the web config does not show: it cannot be
        # compared, and sending it each time would rewrite it blind.
        planner.skip(path, "secret_unknown", value, secret=True)
        return
    if current is _MISSING:
        current = "" if isinstance(value, str) else current
    if value == "":
        if current != "":
            planner.skip(path, "empty_not_sent", value, current, secret)
        else:
            planner.same(path, value, secret)
        return
    readable = not secret
    _plan_mqtt_field(
        planner, path, key, kind, secret, reboot, "send", value, current, readable=readable
    )


def plan_webconfig(
    desired: dict[str, Any],
    secret_values: dict[int, str],
    config: dict[str, Any],
    *,
    allow_radio: bool = False,
) -> ApplyPlan:
    """The ``set`` commands over the web config that make the device match ``desired``.

    Only what the web config can set; the rest of the file is listed as
    ``not_over_webconfig``. The private key is never among it, so the device
    must already be the asset (the caller checks ``/api/status``).
    """
    if not isinstance(desired.get("vars"), dict):
        raise WebConfigError("not_a_device_file")
    want = resolve_secrets(desired, secret_values)
    have = document_from_config(config)
    planner = _Planner()

    have_vars = have["vars"]
    for key in want["vars"]:
        path = ("vars", key)
        if key not in _LAN_VARS:
            planner.skip(path, "not_over_webconfig", secret=key in ("prv.key", "guest.password"))
    for key in _LAN_VARS:
        if key not in want["vars"]:
            continue
        path = ("vars", key)
        value = want["vars"][key]
        if key not in have_vars:
            planner.skip(path, "not_on_device", value)
            continue
        current = have_vars[key]
        if same_var(key, value, current):
            planner.same(path, value)
            continue
        if key == "radio" and not allow_radio:
            planner.skip(path, "needs_radio_tick", value, current)
            continue
        text = _var_text(key, value)
        if text is None:
            planner.skip(path, "bad_value", value, current)
            continue
        command = f"set {key} {text}"
        planner.change(
            ApplyStep("vars", path, command, command, reboot=key == "radio", expect=value),
            value,
            current,
        )

    for section in want:
        if section not in _MQTT_SECTIONS_ON_LAN:
            planner.skip((section,), "not_over_webconfig")

    wanted_mqtt = want.get("mqtt")
    if isinstance(wanted_mqtt, dict):
        have_mqtt = have.get("mqtt", {})
        lan_fields = {field for field, *_rest in (*_LAN_MQTT, *_LAN_MQTT_END)}
        for field in wanted_mqtt:
            if field not in lan_fields and field not in ("slots", *_MQTT_CAPABILITY):
                planner.skip(("mqtt", field), "not_over_webconfig")

        def fields(table: tuple[tuple[str, str, str, bool, bool], ...]) -> None:
            for field, key, kind, secret, reboot in table:
                if field in wanted_mqtt:
                    _lan_mqtt_change(
                        planner,
                        ("mqtt", field),
                        key,
                        kind,
                        secret,
                        reboot,
                        wanted_mqtt[field],
                        have_mqtt.get(field, _MISSING),
                        config,
                    )

        fields(_LAN_MQTT)
        slots = wanted_mqtt.get("slots")
        have_slots = have_mqtt.get("slots", [])
        if isinstance(slots, list):
            for index in range(min(len(slots), len(have_slots), 6)):
                slot = slots[index] if isinstance(slots[index], dict) else {}
                current = have_slots[index]
                number = index + 1
                preset = slot.get("preset", current.get("preset"))
                if "preset" in slot:
                    _lan_mqtt_change(
                        planner,
                        ("mqtt", "slots", index, "preset"),
                        f"mqtt{number}.preset",
                        "text",
                        False,
                        False,
                        preset,
                        current.get("preset", _MISSING),
                        config,
                    )
                if preset == "custom":
                    for field in (
                        "server",
                        "port",
                        "username",
                        "password",
                        "token",
                        "topic",
                        "audience",
                    ):
                        if field in slot:
                            _lan_mqtt_change(
                                planner,
                                ("mqtt", "slots", index, field),
                                f"mqtt{number}.{field}",
                                "number" if field == "port" else "text",
                                field in _MASKED_SLOT_FIELDS,
                                False,
                                slot[field],
                                current.get(field, _MISSING),
                                config,
                            )
                if preset != "none" and isinstance(slot.get("filter"), str):
                    _lan_mqtt_change(
                        planner,
                        ("mqtt", "slots", index, "filter"),
                        f"mqtt{number}.filter",
                        "text",
                        False,
                        False,
                        normalize_packet_filter(slot["filter"]),
                        current.get("filter", _MISSING),
                        config,
                    )
        fields(_LAN_MQTT_END)

    steps = []
    for step in planner.steps:
        # No `get` follows a save: the read-back is a fresh GET /api/config.
        step.readback = []
        steps.append(step)
    return ApplyPlan(
        steps=steps,
        rows=planner.rows,
        reboot=any(step.reboot for step in steps),
        rekey=False,
    )


# --- one step -----------------------------------------------------------------


def step_key_value(command: str) -> tuple[str, str]:
    """``set <key> <value>`` of a step as the web config's ``set`` entry, or WebConfigError."""
    if any(char in command for char in "\r\n\0") or not command.startswith("set "):
        raise WebConfigError("not_over_webconfig")
    rest = command[4:]
    key, _space, value = rest.partition(" ")
    if key not in ALLOWED_SET_KEYS and not _SLOT_KEY.fullmatch(key):
        raise WebConfigError("not_over_webconfig")
    return key, value


def _value_at(document: dict[str, Any], path: tuple[str | int, ...]) -> Any:
    value: Any = document
    for part in path:
        if isinstance(value, dict) and isinstance(part, str) and part in value:
            value = value[part]
            continue
        if isinstance(value, list) and isinstance(part, int) and part < len(value):
            value = value[part]
            continue
        return _MISSING
    return value


def check_webconfig_step(
    step: ApplyStep, result: dict[str, Any], config_after: dict[str, Any]
) -> tuple[bool, str | None]:
    """``(ok, reason)`` for one save: its result, then the setting read back."""
    if result.get("state") != "done":
        return False, "no_reply"
    replies = result.get("results") or []
    reply = str(replies[0].get("reply", "")) if replies and isinstance(replies[0], dict) else ""
    if not result.get("all_ok") or not reply.strip().upper().startswith("OK"):
        return False, "unexpected_reply"
    if step.check == "reply":
        return True, None
    value = _value_at(document_from_config(config_after), step.path)
    if value is _MISSING:
        return False, "no_readback"
    if step.section == "vars":
        same = same_var(str(step.path[1]), step.expect, value)
    elif step.path[-1] == "filter":
        same = normalize_packet_filter(step.expect) == value
    else:
        same = value == step.expect
    return (True, None) if same else (False, "readback_differs")


def result_reply(step: ApplyStep, result: dict[str, Any]) -> str:
    """The device's reply as it may be shown and logged: never for a secret."""
    if step.secret:
        return ""
    replies = result.get("results") or []
    if replies and isinstance(replies[0], dict):
        return str(replies[0].get("reply", ""))[:160]
    return ""


__all__ = [
    "ALLOWED_SET_KEYS",
    "PORT",
    "WebConfigError",
    "check_webconfig_step",
    "document_from_config",
    "identity_matches",
    "lan_address",
    "new_request_id",
    "parse_start_reply",
    "plan_webconfig",
    "result_reply",
    "step_key_value",
]
