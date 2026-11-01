"""Rules for an observer's web config over the LAN (plan 32, Phase 4). No network."""

import socket
from typing import Any

import pytest

from app.services import fleet_config, fleet_webconfig
from app.services.fleet_device_cli import ApplyStep
from app.services.fleet_webconfig import (
    WebConfigError,
    check_webconfig_step,
    document_from_config,
    lan_address,
    parse_start_reply,
    plan_webconfig,
    step_key_value,
)
from tests.fleet_device_cli_samples import PRIVATE_KEY, PUBLIC_KEY
from tests.fleet_webconfig_samples import SENTINEL, config, result, status


def _resolver(*addresses: str):
    def resolve(host: str, port: int, *args: Any, **kwargs: Any):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port)) for address in addresses
        ]

    return resolve


# --- the address --------------------------------------------------------------


@pytest.mark.parametrize("host", ["192.168.1.20", "10.0.0.5", "172.16.4.1", "fd00::1"])
def test_private_addresses_are_accepted(host: str) -> None:
    assert lan_address(host, resolve=_resolver(host)) == host


@pytest.mark.parametrize(
    ("host", "code"),
    [
        ("8.8.8.8", "host_not_lan"),
        ("127.0.0.1", "host_not_lan"),
        ("169.254.169.254", "host_not_lan"),
        ("::1", "host_not_lan"),
        ("100.64.0.1", "host_not_lan"),
        ("http://192.168.1.20", "host_invalid"),
        ("192.168.1.20:80", "host_invalid"),
        ("", "host_invalid"),
    ],
)
def test_other_addresses_are_refused(host: str, code: str) -> None:
    with pytest.raises(WebConfigError) as caught:
        lan_address(host, resolve=_resolver(host or "0.0.0.0"))
    assert caught.value.code == code


def test_a_name_must_resolve_to_lan_addresses_only() -> None:
    assert lan_address("observer.lan", resolve=_resolver("192.168.1.20")) == "192.168.1.20"
    with pytest.raises(WebConfigError) as caught:
        lan_address("observer.lan", resolve=_resolver("192.168.1.20", "203.0.113.5"))
    assert caught.value.code == "host_not_lan"

    def nothing(*_args: Any, **_kwargs: Any):
        raise socket.gaierror("no such name")

    with pytest.raises(WebConfigError) as caught:
        lan_address("observer.lan", resolve=nothing)
    assert caught.value.code == "host_unresolved"


def test_start_reply_gives_the_address() -> None:
    reply = "WebConfig started: http://192.168.1.20/ (admin password login)"
    assert parse_start_reply(reply) == "192.168.1.20"
    assert parse_start_reply(reply + " WARN: low heap") == "192.168.1.20"
    assert parse_start_reply("Err: WiFi not connected") is None
    assert parse_start_reply(None) is None


def test_identity_is_the_first_eight_bytes_of_the_key() -> None:
    assert fleet_webconfig.identity_matches(status(), PUBLIC_KEY)
    assert not fleet_webconfig.identity_matches(status("cd" * 32), PUBLIC_KEY)
    assert not fleet_webconfig.identity_matches({"node_id": ""}, PUBLIC_KEY)


# --- reading ------------------------------------------------------------------


def test_document_from_config_is_in_the_toolbox_format() -> None:
    document = document_from_config(config())
    variables = document["vars"]

    assert variables["radio"] == {"freq": "869.618", "bw": "62.5", "sf": "7", "cr": "5"}
    assert variables["af"] == 1 and isinstance(variables["af"], int)
    assert variables["lat"] == 52.37403 and variables["lon"] == 4.88969
    assert variables["repeat"] is True and variables["radio.rxgain"] is True
    assert variables["flood.max"] == 64 and variables["advert.interval"] == 120
    assert variables["loop.detect"] == "off"
    assert list(variables)[:3] == ["name", "repeat", "radio"]
    mqtt = document["mqtt"]
    assert mqtt["wifiSsid"] == "MeshNet" and "wifiPassword" not in mqtt
    assert mqtt["neighborsInterval"] == 24 and mqtt["timezoneOffset"] == 0
    assert mqtt["snmpCommunity"] == "mesh-readonly"
    assert "alertPsk" not in mqtt and "radioWatchdog" not in mqtt
    slot = mqtt["slots"][0]
    assert slot["preset"] == "custom" and slot["port"] == 8883
    assert "password" not in slot and slot["token"] == ""
    assert fleet_config.detect_profile(document) == "dmc_observer"


def test_masked_secrets_never_reach_the_document() -> None:
    document = document_from_config(config())
    assert SENTINEL not in str(document)


# --- planning -----------------------------------------------------------------


def _plan(desired: dict[str, Any], current: dict[str, Any] | None = None, **kwargs: Any):
    return plan_webconfig(desired, kwargs.pop("secrets", {}), current or config(), **kwargs)


def _skips(plan) -> dict[str, str]:
    return {
        fleet_config.path_label(row.path): row.reason for row in plan.rows if row.status == "skip"
    }


def test_nothing_to_do_when_the_device_matches() -> None:
    plan = _plan(document_from_config(config()))
    assert plan.steps == [] and _skips(plan) == {}


def test_a_change_is_one_set_command() -> None:
    desired = document_from_config(config())
    desired["vars"]["tx"] = 20
    desired["mqtt"]["slots"][0]["topic"] = "meshcore/other"
    desired["mqtt"]["status"] = False
    plan = _plan(desired)

    assert [step.command for step in plan.steps] == [
        "set tx 20",
        "set mqtt.status off",
        "set mqtt1.topic meshcore/other",
    ]
    assert all(step.readback == [] for step in plan.steps)
    assert plan.steps[0].check == "value" and plan.steps[0].expect == 20
    # Over the web config mqtt.status can be read back.
    assert plan.steps[1].check == "value"
    assert plan.rekey is False


def test_radio_needs_its_tick() -> None:
    desired = document_from_config(config())
    desired["vars"]["radio"] = {"freq": "869.525", "bw": "250", "sf": "11", "cr": "5"}

    assert _skips(_plan(desired)) == {"vars/radio": "needs_radio_tick"}
    plan = _plan(desired, allow_radio=True)
    assert [step.command for step in plan.steps] == ["set radio 869.525,250,11,5"]
    assert plan.reboot is True


def test_what_the_web_config_cannot_set_is_listed() -> None:
    desired = document_from_config(config())
    desired["vars"]["prv.key"] = PRIVATE_KEY
    desired["vars"]["guest.password"] = "guest"
    desired["vars"]["owner.info"] = "x"
    desired["mqtt"]["alertPsk"] = "00" * 16
    desired["mqtt"]["neighborsSupported"] = False
    desired["filter"] = {"enabled": True}
    desired["region"] = {"def": "nl", "home": "nl", "default": ""}
    plan = _plan(desired)

    assert plan.steps == []
    assert _skips(plan) == {
        "vars/prv.key": "not_over_webconfig",
        "vars/guest.password": "not_over_webconfig",
        "vars/owner.info": "not_over_webconfig",
        "mqtt/alertPsk": "not_over_webconfig",
        "filter": "not_over_webconfig",
        "region": "not_over_webconfig",
    }


def test_a_masked_secret_is_only_set_when_the_device_has_none() -> None:
    stored, _found = fleet_config.split_secrets(
        {**document_from_config(config()), "mqtt": {"wifiPassword": "new-wifi-pass"}}
    )
    fleet_config.set_placeholder(stored, ("mqtt", "wifiPassword"), 4)

    plan = _plan(stored, secrets={4: "new-wifi-pass"})
    assert plan.steps == [] and _skips(plan) == {"mqtt/wifiPassword": "secret_unknown"}

    empty = config()
    empty["wifi"]["pwd"] = ""
    plan = _plan(stored, empty, secrets={4: "new-wifi-pass"})
    step = plan.steps[0]
    assert step.command == "set wifi.pwd new-wifi-pass"
    assert step.display == "set wifi.pwd ********" and step.secret is True
    assert step.check == "reply" and step.reboot is True


def test_every_planned_command_is_one_the_web_config_takes() -> None:
    desired = document_from_config(config())
    desired["vars"].update({"name": "X", "tx": 1, "lat": 51.0})
    desired["mqtt"].update({"origin": "", "ntp": "time.example.org", "snmp": False})
    desired["mqtt"]["slots"][1]["filter"] = "advert"
    plan = _plan(desired, allow_radio=True)

    assert plan.steps
    for step in plan.steps:
        key, _value = step_key_value(step.command)
        assert key in fleet_webconfig.ALLOWED_SET_KEYS or key.startswith("mqtt")


def test_a_companion_file_is_refused() -> None:
    with pytest.raises(fleet_webconfig.WebConfigError):
        _plan({"version": 1, "name": "x", "radio": {}})


# --- one step -----------------------------------------------------------------


def _step(command: str = "set tx 20", path=("vars", "tx"), expect: Any = 20, **kw: Any):
    return ApplyStep("vars", path, command, command, expect=expect, **kw)


def test_check_ok_and_read_back() -> None:
    after = config()
    after["radio"]["tx"] = 20
    assert check_webconfig_step(_step(), result("tx"), after) == (True, None)


def test_check_unexpected_answers() -> None:
    after = config()
    after["radio"]["tx"] = 20
    assert check_webconfig_step(_step(), {"state": "pending"}, after) == (False, "no_reply")
    assert check_webconfig_step(_step(), result("tx", "Error, max 30", all_ok=False), after) == (
        False,
        "unexpected_reply",
    )
    assert check_webconfig_step(_step(), result("tx"), config()) == (False, "readback_differs")


def test_a_reply_only_step_needs_no_read_back() -> None:
    step = _step("set wifi.pwd x", ("mqtt", "wifiPassword"), "x", check="reply", secret=True)
    assert check_webconfig_step(step, result("wifi.pwd"), config()) == (True, None)


@pytest.mark.parametrize(
    "command",
    [
        "erase",
        "set password newadmin",
        "set guest.password x",
        "set prv.key " + "ab" * 64,
        "set tx 20\nreboot",
        "get tx",
        "set mqtt7.server x",
    ],
)
def test_commands_the_web_config_must_not_get(command: str) -> None:
    with pytest.raises(WebConfigError):
        step_key_value(command)


def test_step_key_value() -> None:
    assert step_key_value("set mqtt1.topic meshcore/a b") == ("mqtt1.topic", "meshcore/a b")
    assert step_key_value("set mqtt.origin") == ("mqtt.origin", "")
