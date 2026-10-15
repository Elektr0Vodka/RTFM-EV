"""Repeater 1.18 `power` command and FEM replies."""

from app.routers.repeaters import parse_power_reply
from app.services.fleet_device_cli import _is_onoff


def test_parse_power_reply():
    assert parse_power_reply("batt:4012 mV usb:no solar_chg:yes ext:no charger:yes") == {
        "batt_mv": "4012",
        "usb": "no",
        "solar_chg": "yes",
        "ext": "no",
        "charger": "yes",
    }


def test_parse_power_reply_na_fields():
    assert parse_power_reply("batt:3900 mV usb:n/a solar_chg:n/a ext:no charger:no") == {
        "batt_mv": "3900",
        "usb": "n/a",
        "solar_chg": "n/a",
        "ext": "no",
        "charger": "no",
    }


def test_parse_power_reply_old_firmware():
    assert parse_power_reply("Unknown command") is None
    assert parse_power_reply(None) is None


def test_fem_unknown_config_counts_as_unsupported():
    # 1.18 moved radio.fem.* to board level; boards without it now answer this.
    assert _is_onoff("unknown config: radio.fem.rxgain") is False
    assert _is_onoff("> on") is True
