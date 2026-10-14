"""Rules of the text command line over a cable (plan 32, Phase 3). No device, no database."""

import copy
from typing import Any

import pytest

from app.services import fleet_config, fleet_device_cli
from app.services.fleet_device_cli import (
    ApplyStep,
    DeviceCliError,
    check_step,
    command_allowed,
    plan_apply,
    read_commands,
    read_device,
)
from tests.fleet_config_samples import keypair
from tests.fleet_device_cli_samples import (
    PRIVATE_KEY,
    PUBLIC_KEY,
    observer_replies,
    stock_replies,
)


def _read_in_rounds(device: dict[str, str | None]) -> tuple[dict[str, str | None], list[list[str]]]:
    """Answer each round of ``read_commands`` from ``device`` like a transport would."""
    replies: dict[str, str | None] = {}
    rounds: list[list[str]] = []
    while True:
        commands = read_commands(replies)
        if not commands:
            return replies, rounds
        rounds.append(commands)
        for command in commands:
            assert command_allowed(command), command
            replies[command] = device.get(command, f"??: {command}")


# --- what may be sent ---------------------------------------------------------


@pytest.mark.parametrize(
    "command",
    [
        "ver",
        "board",
        "get name",
        "set tx 20",
        "filter",
        "filter hops 3 8",
        "filter channel add #test",
        "region",
        "region home nl",
        "region save",
    ],
)
def test_allowed_commands(command: str) -> None:
    assert command_allowed(command)


@pytest.mark.parametrize(
    "command",
    [
        "erase",
        "reboot",
        "advert",
        "advert.zerohop",
        "discover.neighbors",
        "start ota",
        "password secret",
        "region put nl *",
        "region remove nl",
        "region load",
        "region def nl",
        "filter reset",
        "set freq 869.5",
        "set name a\rerase",
        "get",
        " ver",
        "ver now",
        "set owner.info " + "x" * 200,
    ],
)
def test_refused_commands(command: str) -> None:
    assert not command_allowed(command)


# --- reading ------------------------------------------------------------------


def test_read_rounds_of_a_stock_repeater() -> None:
    replies, rounds = _read_in_rounds(stock_replies())

    assert rounds[0] == list(fleet_device_cli.IDENTITY_COMMANDS)
    assert "get owner.info" in rounds[1] and "get loop.detect" in rounds[1]
    assert "get prv.key" in rounds[1] and "region" in rounds[1]
    # No packet filter and no observer settings: only the region questions follow.
    assert rounds[2] == ["region home", "region default"]
    assert len(rounds) == 3
    assert not any(command.startswith("get mqtt1.") for command in replies)


def test_older_firmware_is_not_asked_for_newer_keys() -> None:
    replies, rounds = _read_in_rounds(stock_replies(version="v1.11.0 (Build: 1-Jan-2026)"))

    assert "get owner.info" not in rounds[1]
    assert "get path.hash.mode" not in rounds[1]
    assert "owner.info" not in read_device(replies).document["vars"]


def test_a_device_without_a_command_line_is_refused() -> None:
    replies: dict[str, str | None] = dict.fromkeys(read_commands({}))
    with pytest.raises(DeviceCliError, match="does not answer"):
        read_commands(replies)


def test_read_stock_document_matches_the_toolbox_file() -> None:
    replies, _rounds = _read_in_rounds(stock_replies())
    read = read_device(replies)
    variables = read.document["vars"]

    assert list(read.document) == ["vars", "region"]
    assert read.profile == "stock"
    assert variables["radio"] == {"freq": "869.618", "bw": "62.5", "sf": "7", "cr": "5"}
    assert variables["repeat"] is True and variables["allow.read.only"] is False
    assert variables["af"] == 1 and isinstance(variables["af"], int)
    assert variables["txdelay"] == 0.5
    assert variables["lat"] == 52.37403 and variables["lon"] == 4.88969
    assert variables["owner.info"] == "line one\nline two"
    assert variables["multi.acks"] == "0"
    assert variables["path.hash.mode"] == 1
    assert variables["loop.detect"] == "off"
    # Keys the device does not have are left out, as the toolbox does.
    assert "cad" not in variables
    assert "radio.rxgain" not in variables
    assert "adc.multiplier" not in variables
    assert list(variables)[-1] == "prv.key" and variables["prv.key"] == PRIVATE_KEY
    assert list(variables)[:4] == ["name", "repeat", "allow.read.only", "radio"]
    assert read.document["region"] == {"def": "nl nl-nh", "home": "nl", "default": ""}
    assert read.identity.public_key == PUBLIC_KEY
    assert read.identity.firmware_version == "v1.14.0"
    assert read.identity.board == "Heltec V3"
    assert read.identity.role == "repeater"
    assert read.identity.name == "NL-TST-RPT"
    assert read.warnings == []


def test_read_observer_document() -> None:
    replies, rounds = _read_in_rounds(observer_replies())
    read = read_device(replies)
    document = read.document

    assert list(document) == ["vars", "filter", "region", "hardware", "mqtt"]
    assert read.profile == "dmc_observer"
    assert set(fleet_device_cli.FILTER_COMMANDS) <= set(rounds[2])
    flt = document["filter"]
    assert flt["enabled"] is True
    assert flt["channels"] == ["#test", "Public"]
    assert flt["malformed"] is True and flt["minHashBytes"] == 1
    assert flt["perType"][5] == {"hops": 32, "rateLimit": 5, "rateSecs": 60}
    # The firmware's third number (soft limit) is read, the file keeps two.
    assert flt["perType"][2] == {"hops": 8, "rateLimit": 20, "rateSecs": 60}
    assert fleet_device_cli.filter_soft_limits(replies["filter rate"]) == {
        **dict.fromkeys(range(12), 0),
        2: 3,
    }
    hardware = document["hardware"]
    assert hardware["bridgeType"] == "espnow" and hardware["espnowSupported"] is True
    assert hardware["bridgeEnabled"] is True and hardware["bridgeDelay"] == 500
    assert hardware["bridgeSource"] == "tx" and hardware["bridgeSecret"] == "xor-bridge-key"
    assert hardware["rs232Supported"] is False
    mqtt = document["mqtt"]
    assert mqtt["interval"] == 5 and mqtt["radioWatchdog"] == 5
    assert mqtt["ntp"] == "" and mqtt["alertPsk"] == "" and mqtt["neighborsSupported"] is False
    assert mqtt["snmp"] is True and mqtt["snmpCommunity"] == "mesh-readonly"
    assert mqtt["wifiPassword"] == "wifi-pass-phrase"
    slot = mqtt["slots"][0]
    assert slot["preset"] == "custom" and slot["port"] == 8883
    assert slot["password"] == "broker-pass" and slot["token"] == ""
    assert slot["filter"] == "2,4,5"
    assert mqtt["slots"][1]["preset"] == "dutchmeshcore-1"
    assert read.identity.firmware_version == "v1.14.1-dmc-observer"


def test_read_document_goes_through_the_library_rules() -> None:
    """A read is stored like a file: every secret is found by the Phase 1 rules."""
    replies, _rounds = _read_in_rounds(observer_replies())
    stored, found = fleet_config.split_secrets(read_device(replies).document)

    paths = {fleet_config.path_label(secret.path) for secret in found}
    assert paths == {
        "vars/prv.key",
        "vars/guest.password",
        "hardware/bridgeSecret",
        "mqtt/snmpCommunity",
        "mqtt/wifiPassword",
        "mqtt/slots/0/password",
    }
    assert fleet_config.detect_profile(stored) == "dmc_observer"


def test_hidden_values_are_warned_about() -> None:
    device = observer_replies()
    device["get wifi.pwd"] = "> ******** (serial only)"
    replies, _rounds = _read_in_rounds(device)
    read = read_device(replies)

    assert read.document["mqtt"]["wifiPassword"] == ""
    assert "hidden:wifi.pwd" in read.warnings


def test_a_full_region_dump_is_warned_about() -> None:
    long_tree = "* F\n" + "".join(f" region-{index:02d} F\n" for index in range(14))
    replies, _rounds = _read_in_rounds(stock_replies(region=long_tree))

    assert "region_cut_off" in read_device(replies).warnings


def test_region_tree_with_siblings() -> None:
    tree = fleet_device_cli.parse_region_tree("* F\n nl F\n  nl-nh F\n  nl-zh\n be F\n")

    assert fleet_device_cli.tree_to_def(tree) == "nl nl-nh|nl nl-zh|* be"


# --- planning an apply --------------------------------------------------------


def _current(device: dict[str, str | None]) -> tuple[dict[str, str | None], dict[str, Any]]:
    replies, _rounds = _read_in_rounds(device)
    return replies, read_device(replies).document


def _plan(desired: dict[str, Any], replies: dict[str, str | None], **kwargs: Any):
    secrets: dict[int, str] = kwargs.pop("secrets", {})
    return plan_apply(
        desired, secrets, replies, asset_public_key=kwargs.pop("public_key", PUBLIC_KEY), **kwargs
    )


def _commands(plan) -> list[str]:
    return [step.command for step in plan.steps]


def _skips(plan) -> dict[str, str]:
    return {
        fleet_config.path_label(row.path): row.reason for row in plan.rows if row.status == "skip"
    }


def test_nothing_to_do_when_the_device_matches() -> None:
    replies, document = _current(stock_replies())
    plan = _plan(document, replies, allow_private_key=True, allow_radio=True)

    assert plan.steps == []
    assert plan.reboot is False and plan.rekey is False
    assert all(row.status == "same" for row in plan.rows)


def test_one_change_is_one_command_with_its_read_back() -> None:
    replies, document = _current(stock_replies())
    document["vars"]["tx"] = 20
    document["vars"]["repeat"] = False
    document["vars"]["owner.info"] = "new\ntext"
    plan = _plan(document, replies)

    assert _commands(plan) == ["set repeat off", "set tx 20", "set owner.info new|text"]
    step = plan.steps[1]
    assert step.readback == ["get tx"] and step.expect == 20 and step.check == "value"
    assert plan.reboot is False


def test_radio_needs_its_own_tick() -> None:
    replies, document = _current(stock_replies())
    document["vars"]["radio"] = {"freq": "869.525", "bw": "250", "sf": "11", "cr": "5"}

    assert _plan(document, replies).steps == []
    assert _skips(_plan(document, replies))["vars/radio"] == "needs_radio_tick"
    plan = _plan(document, replies, allow_radio=True)
    assert _commands(plan) == ["set radio 869.525,250,11,5"]
    assert plan.reboot is True


def test_radio_out_of_range_is_not_sent() -> None:
    replies, document = _current(stock_replies())
    document["vars"]["radio"] = {"freq": "86.5", "bw": "250", "sf": "11", "cr": "5"}

    plan = _plan(document, replies, allow_radio=True)
    assert plan.steps == [] and _skips(plan)["vars/radio"] == "bad_value"


def test_secrets_come_from_the_vault_and_are_never_shown() -> None:
    replies, document = _current(stock_replies())
    stored, _found = fleet_config.split_secrets(document)
    fleet_config.set_placeholder(stored, ("vars", "guest.password"), 7)
    fleet_config.set_placeholder(stored, ("vars", "prv.key"), 8)

    plan = _plan(stored, replies, secrets={7: "new-guest", 8: PRIVATE_KEY})
    assert _commands(plan) == ["set guest.password new-guest"]
    step = plan.steps[0]
    assert step.secret is True and step.display == "set guest.password ********"
    row = next(row for row in plan.rows if row.path == ("vars", "guest.password"))
    assert row.configured == "********" and "new-guest" not in row.device

    plan = _plan(stored, replies, secrets={})
    assert plan.steps == []
    assert _skips(plan)["vars/guest.password"] == "secret_unavailable"


def test_private_key_needs_its_own_tick_and_goes_last() -> None:
    other_private, other_public = keypair()
    replies, document = _current(stock_replies(private_key=other_private, public_key=other_public))
    document["vars"]["prv.key"] = PRIVATE_KEY
    document["vars"]["tx"] = 10

    # The device is another key: without the tick this is refused outright.
    with pytest.raises(DeviceCliError, match="not this asset"):
        _plan(document, replies)
    plan = _plan(document, replies, allow_private_key=True)
    assert _commands(plan) == ["set tx 10", f"set prv.key {PRIVATE_KEY}"]
    step = plan.steps[-1]
    assert step.check == "public_key" and step.expect == PUBLIC_KEY and step.reboot is True
    assert PRIVATE_KEY not in step.display
    assert plan.rekey is True


def test_a_private_key_of_another_identity_is_never_written() -> None:
    other_private, _other_public = keypair()
    replies, document = _current(stock_replies())
    document["vars"]["prv.key"] = other_private

    with pytest.raises(DeviceCliError):
        _plan(document, replies, public_key=_other_public, allow_private_key=False)
    plan = _plan(document, replies, allow_private_key=True)
    assert plan.steps == [] and _skips(plan)["vars/prv.key"] == "key_not_asset"


def test_another_device_is_refused() -> None:
    _other_private, other_public = keypair()
    replies, document = _current(stock_replies())

    with pytest.raises(DeviceCliError, match="not this asset"):
        _plan(document, replies, public_key=other_public, allow_private_key=True)


def test_unknown_and_missing_keys_are_skipped() -> None:
    replies, document = _current(stock_replies())
    document["vars"]["future.key"] = 3
    document["vars"]["cad"] = True
    plan = _plan(document, replies)

    assert plan.steps == []
    assert _skips(plan) == {"vars/future.key": "unknown_key", "vars/cad": "not_on_device"}


def test_values_that_would_break_the_line_are_not_sent() -> None:
    replies, document = _current(stock_replies())
    document["vars"]["name"] = "bad\rerase"
    plan = _plan(document, replies)

    assert plan.steps == [] and _skips(plan)["vars/name"] == "bad_value"


def test_region_home_is_set_and_saved_but_the_tree_is_left_alone() -> None:
    replies, document = _current(stock_replies())
    document["region"] = {"def": "nl nl-nh|nl nl-zh", "home": "nl-nh", "default": "nl"}
    plan = _plan(document, replies)

    assert _commands(plan) == ["region home nl-nh", "region default nl", "region save"]
    assert _skips(plan) == {"region/def": "region_tree"}
    document["region"] = {"home": "be"}
    assert _skips(_plan(document, replies)) == {"region/home": "not_in_tree"}


def test_filter_changes_keep_the_soft_limit_and_switch_on_last() -> None:
    replies, document = _current(observer_replies())
    flt = document["filter"]
    flt["enabled"] = False
    flt["perType"][3]["hops"] = 4
    flt["perType"][2]["rateLimit"] = 30
    flt["channels"] = ["#test", "#new"]
    plan = _plan(document, replies)

    assert [step.command for step in plan.steps if step.section == "filter"] == [
        "filter hops 3 4",
        "filter rate 2 30 60 3",
        "filter channel add #new",
        "filter channel remove Public",
        "filter off",
    ]


def test_mqtt_changes() -> None:
    replies, document = _current(observer_replies())
    stored, _found = fleet_config.split_secrets(document)
    fleet_config.set_placeholder(stored, ("mqtt", "slots", 0, "password"), 3)
    fleet_config.set_placeholder(stored, ("mqtt", "wifiPassword"), 4)
    mqtt = stored["mqtt"]
    mqtt["status"] = False
    mqtt["neighbors"] = True
    mqtt["ntp"] = "time.example.org"
    mqtt["snmp"] = False
    mqtt["slots"][0]["topic"] = "meshcore/other"
    mqtt["slots"][1]["filter"] = "advert,grp_txt"
    plan = _plan(stored, replies, secrets={3: "new-broker-pass", 4: "wifi-pass-phrase"})
    commands = [step.command for step in plan.steps if step.section == "mqtt"]

    assert commands == [
        "set mqtt.status off",
        "set mqtt.ntp time.example.org",
        "set mqtt1.password new-broker-pass",
        "set mqtt1.topic meshcore/other",
        "set mqtt2.filter 4,5",
        "set snmp off",
    ]
    by_command = {step.command: step for step in plan.steps}
    assert by_command["set mqtt.status off"].check == "reply"
    assert by_command["set mqtt1.password new-broker-pass"].display == "set mqtt1.password ********"
    assert by_command["set snmp off"].reboot is True
    assert _skips(plan)["mqtt/neighbors"] == "not_on_device"


def test_a_section_the_device_does_not_have_is_skipped() -> None:
    replies, _document = _current(stock_replies())
    _observer_replies, observer = _current(observer_replies())
    plan = _plan(observer, replies, allow_radio=True)

    skips = _skips(plan)
    assert skips["filter"] == "not_on_device"
    assert skips["mqtt"] == "not_on_device"
    assert skips["hardware"] == "not_on_device"


def test_every_planned_command_is_allowed() -> None:
    replies, document = _current(observer_replies())
    changed = copy.deepcopy(document)
    changed["vars"].update(
        {"tx": 1, "name": "X", "radio": {"freq": 869, "bw": 125, "sf": 9, "cr": 5}}
    )
    changed["filter"]["enabled"] = False
    changed["mqtt"]["origin"] = ""
    changed["hardware"]["bridgeEnabled"] = False
    plan = _plan(changed, replies, allow_radio=True, allow_private_key=True)

    assert plan.steps
    assert all(command_allowed(step.command) for step in plan.steps)
    assert "set mqtt.origin" in _commands(plan)


def test_a_companion_file_is_refused() -> None:
    replies, _document = _current(stock_replies())
    with pytest.raises(DeviceCliError, match="toolbox"):
        _plan({"version": 1, "name": "x", "radio": {}}, replies)


# --- checking a step ----------------------------------------------------------


def _var_step(command: str = "set tx 20", expect: Any = 20) -> ApplyStep:
    return ApplyStep("vars", ("vars", "tx"), command, command, readback=["get tx"], expect=expect)


def test_check_ok() -> None:
    assert check_step(_var_step(), "OK", {"get tx": "> 20"}) == (True, None)


def test_check_unexpected_reply() -> None:
    assert check_step(_var_step(), "Error, max 64", {"get tx": "> 20"}) == (
        False,
        "unexpected_reply",
    )
    assert check_step(_var_step(), None, {}) == (False, "no_reply")


def test_check_read_back_differs() -> None:
    assert check_step(_var_step(), "OK", {"get tx": "> 22"}) == (False, "readback_differs")
    assert check_step(_var_step(), "OK", {"get tx": None}) == (False, "no_readback")


def test_check_radio_and_position_within_the_file_precision() -> None:
    radio = {"freq": "869.618", "bw": "62.5", "sf": "7", "cr": "5"}
    step = ApplyStep(
        "vars", ("vars", "radio"), "set radio x", "", readback=["get radio"], expect=radio
    )
    assert check_step(step, "OK - reboot to apply", {"get radio": "> 869.6179809,62.5,7,5"}) == (
        True,
        None,
    )


def test_check_new_public_key() -> None:
    step = ApplyStep(
        "vars", ("vars", "prv.key"), "set prv.key x", "", expect=PUBLIC_KEY, check="public_key"
    )
    assert check_step(step, f"OK, reboot to apply! New pubkey: {PUBLIC_KEY}", {}) == (True, None)
    assert check_step(step, "OK, reboot to apply! New pubkey: " + "0" * 64, {}) == (
        False,
        "other_public_key",
    )
    assert check_step(step, "Error, bad key", {}) == (False, "unexpected_reply")


def test_check_filter_region_and_mqtt_steps() -> None:
    replies, document = _current(observer_replies())
    document["filter"]["perType"][3]["hops"] = 4
    document["region"]["home"] = "nl-nh"
    document["mqtt"]["slots"][0]["topic"] = "meshcore/other"
    steps = {step.command: step for step in _plan(document, replies).steps}

    hops = steps["filter hops 3 4"]
    readback = {"filter hops": replies["filter hops"].replace("03: 8", "03: 4")}
    assert check_step(hops, "> Filter: OK", readback) == (True, None)
    assert check_step(hops, "> Filter: OK", {"filter hops": replies["filter hops"]}) == (
        False,
        "readback_differs",
    )
    home = steps["region home nl-nh"]
    assert check_step(home, " home is now nl-nh", {"region home": " home is nl-nh"}) == (True, None)
    assert check_step(steps["region save"], "OK", {}) == (True, None)
    topic = steps["set mqtt1.topic meshcore/other"]
    assert check_step(topic, "OK", {"get mqtt1.topic": "> meshcore/other"}) == (True, None)


def test_a_secret_reply_is_never_shown() -> None:
    secret = ApplyStep("vars", ("vars", "guest.password"), "set guest.password x", "", secret=True)
    assert fleet_device_cli.reply_shown(secret, "unknown config: guest.password x") == ""
    assert fleet_device_cli.reply_shown(_var_step(), "OK") == "OK"


def test_check_hardware_steps_from_their_own_reply() -> None:
    """A hardware setting is read back on its own, without the capability replies."""
    replies, document = _current(observer_replies())
    stored, _found = fleet_config.split_secrets(document)
    fleet_config.set_placeholder(stored, ("hardware", "bridgeSecret"), 5)
    stored["hardware"]["bridgeSource"] = "rx"
    stored["hardware"]["bridgeDelay"] = 800
    steps = {
        step.command: step
        for step in _plan(stored, replies, secrets={5: "new-bridge-key"}).steps
        if step.section == "hardware"
    }

    assert set(steps) == {
        "set bridge.delay 800",
        "set bridge.source rx",
        "set bridge.secret new-bridge-key",
    }
    assert check_step(steps["set bridge.source rx"], "OK", {"get bridge.source": "> logRx"}) == (
        True,
        None,
    )
    assert check_step(steps["set bridge.source rx"], "OK", {"get bridge.source": "> logTx"}) == (
        False,
        "readback_differs",
    )
    assert check_step(steps["set bridge.delay 800"], "OK", {"get bridge.delay": "> 800"}) == (
        True,
        None,
    )
    secret = steps["set bridge.secret new-bridge-key"]
    assert check_step(secret, "OK", {"get bridge.secret": "> new-bridge-key"}) == (True, None)


def test_an_observer_read_applied_to_itself_lists_nothing_to_skip() -> None:
    """Fields the build does not have hold their defaults in the file: not worth a line."""
    replies, document = _current(observer_replies())
    plan = _plan(document, replies, allow_private_key=True, allow_radio=True)

    assert plan.steps == []
    assert _skips(plan) == {}


def test_long_hostile_replies_are_parsed_quickly() -> None:
    """Replies come from a device: a long one must not make a parser backtrack for long."""
    import time

    hostile = {
        "region": "* F\n nl" + " " * 4000 + "x\n",
        "region home": "home is " + " " * 4000 + "a",
        "region default": "default scope is " + "  " * 2000 + "a",
        "filter channel list": "#a" + " " * 4000 + "x",
    }
    tree_with_marks = "* F\n nl" + "^" * 4000 + "x\n"
    start = time.perf_counter()
    fleet_device_cli.read_region(hostile)
    fleet_device_cli.parse_region_tree(tree_with_marks)
    fleet_device_cli.read_filter({"filter channel list": hostile["filter channel list"]})
    fleet_device_cli.parse_version("1" * 4000 + "x")
    assert time.perf_counter() - start < 0.5
    assert fleet_device_cli.parse_version("v1.14.1-dmc (Build: 1-Jan)") == (1, 14, 1)


def test_region_home_and_default_replies() -> None:
    region = fleet_device_cli.read_region(
        {
            "region": "* F\n nl F\n",
            "region home": " home is now #nl",
            "region default": " default scope is <null>",
        }
    )
    assert region["home"] == "nl" and region["default"] == ""
    assert (
        fleet_device_cli.read_region(
            {"region": "*", "region home": " home is *", "region default": " default scope is be"}
        )["default"]
        == "be"
    )
