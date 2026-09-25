"""Tests for forwarding per-remote-node telemetry/neighbors/regions to the
community observer feed (plan [24]).

The whole id fix: forwarded messages keep ``origin_id`` = the publishing radio
(self) so the broker's publisher==origin rule is satisfied untouched, and carry
the heard node R in a distinct ``subject_id`` field.
"""

import json

from app.fanout import community_mqtt as cm
from app.fanout.community_mqtt import (
    _format_node_neighbors,
    _format_node_regions,
    _format_node_telemetry,
)

_SELF = "11ff22ee33dd44cc55bb66aa"
_SUBJECT = "aabbccddeeff00112233445566778899"


def _repeater_telemetry_event() -> dict:
    """A broadcast_telemetry payload for a remote repeater R (see radio_sync)."""
    return {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,  # 2023-11-14T…Z
        "battery_volts": 4.1,
        "tx_queue_len": 0,
        "noise_floor_dbm": -110,
        "last_rssi_dbm": -65,
        "last_snr_db": 9.75,
        "packets_received": 128,
        "packets_sent": 42,
        "airtime_seconds": 12,
        "rx_airtime_seconds": 340,
        "uptime_seconds": 3600,
        "recv_errors": 2,
    }


def test_format_node_telemetry_keys_publisher_and_subject_apart():
    out = _format_node_telemetry(_repeater_telemetry_event(), "MyRadio", _SELF)

    assert out is not None
    # publisher (self) - satisfies the broker's origin_id==publisher rule
    assert out["origin_id"] == _SELF.upper()
    assert out["origin"] == "MyRadio"
    # heard node R - the whole point
    assert out["subject_id"] == _SUBJECT.upper()
    assert out["subject_name"] == "RepeaterR"
    assert out["type"] == "TELEMETRY"
    assert out["timestamp"].startswith("2023-11-14")


def test_format_node_telemetry_maps_stats_to_observer_key_names():
    out = _format_node_telemetry(_repeater_telemetry_event(), "MyRadio", _SELF)

    stats = out["stats"]
    assert stats["battery_mv"] == 4100  # volts -> mV
    assert stats["uptime_secs"] == 3600
    assert stats["packets_received"] == 128
    assert stats["packets_sent"] == 42
    assert stats["noise_floor"] == -110
    assert stats["tx_air_secs"] == 12
    assert stats["rx_air_secs"] == 340
    assert stats["recv_errors"] == 2
    assert stats["queue_len"] == 0
    # no LPP sensors in this event
    assert "lpp" not in out


def test_format_node_telemetry_passes_through_lpp_sensors():
    event = _repeater_telemetry_event()
    event["lpp_sensors"] = [
        {"channel": 1, "type_name": "temperature", "value": 21.4},
        {"channel": 2, "type_name": "humidity", "value": 55},
    ]

    out = _format_node_telemetry(event, "MyRadio", _SELF)

    assert out["lpp"] == [
        {"channel": 1, "type_name": "temperature", "value": 21.4},
        {"channel": 2, "type_name": "humidity", "value": 55},
    ]


def test_format_node_telemetry_without_subject_key_returns_none():
    event = _repeater_telemetry_event()
    del event["public_key"]

    assert _format_node_telemetry(event, "MyRadio", _SELF) is None


def _neighbors_event() -> dict:
    """A broadcast_neighbor payload: repeater R's neighbor table."""
    return {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,
        "reported_count": 8,
        "neighbors": [
            {
                "pubkey_prefix": "00112233",
                "name": "NodeA",
                "snr": 9.75,
                "last_heard_seconds": 42,
            },
            {
                "pubkey_prefix": "44556677",
                "name": None,
                "snr": -3.0,
                "last_heard_seconds": 610,
            },
        ],
    }


def test_format_node_neighbors_keys_publisher_and_subject_apart():
    out = _format_node_neighbors(_neighbors_event(), "MyRadio", _SELF)

    assert out is not None
    assert out["origin_id"] == _SELF.upper()  # publisher = self
    assert out["subject_id"] == _SUBJECT.upper()  # R = the repeater whose table this is
    assert out["subject_name"] == "RepeaterR"
    assert out["type"] == "NEIGHBORS"
    assert out["reported_count"] == 8
    assert out["timestamp"].startswith("2023-11-14")


def test_format_node_neighbors_maps_entry_fields_to_observer_names():
    out = _format_node_neighbors(_neighbors_event(), "MyRadio", _SELF)

    assert out["neighbors"] == [
        {"pubkey": "00112233", "name": "NodeA", "snr": 9.75, "heard_secs_ago": 42},
        {"pubkey": "44556677", "name": None, "snr": -3.0, "heard_secs_ago": 610},
    ]


def test_format_node_neighbors_without_subject_key_returns_none():
    event = _neighbors_event()
    del event["public_key"]

    assert _format_node_neighbors(event, "MyRadio", _SELF) is None


def _regions_event() -> dict:
    """A broadcast_region payload: repeater R's region hierarchy."""
    return {
        "public_key": _SUBJECT,
        "name": "RepeaterR",
        "timestamp": 1_700_000_000,
        "truncated": False,
        "source": "cli",
        "regions": [
            {"name": "*", "depth": 0, "flood_allowed": True, "is_home": False},
            {"name": "DEN", "depth": 1, "flood_allowed": True, "is_home": True},
        ],
    }


def test_format_node_regions_keys_publisher_and_subject_apart():
    out = _format_node_regions(_regions_event(), "MyRadio", _SELF)

    assert out is not None
    assert out["origin_id"] == _SELF.upper()
    assert out["subject_id"] == _SUBJECT.upper()
    assert out["subject_name"] == "RepeaterR"
    assert out["type"] == "REGIONS"
    assert out["timestamp"].startswith("2023-11-14")


def test_format_node_regions_passes_through_entries_and_source():
    out = _format_node_regions(_regions_event(), "MyRadio", _SELF)

    assert out["regions"] == [
        {"name": "*", "depth": 0, "flood_allowed": True, "is_home": False},
        {"name": "DEN", "depth": 1, "flood_allowed": True, "is_home": True},
    ]
    assert out["source"] == "cli"
    assert out["truncated"] is False


def test_format_node_regions_without_subject_key_returns_none():
    event = _regions_event()
    del event["public_key"]

    assert _format_node_regions(event, "MyRadio", _SELF) is None


# ---------------------------------------------------------------------------
# config topic (own node config snapshot, DMC ``config`` type 5)
# ---------------------------------------------------------------------------


def _config_inputs(**overrides):
    from app.services.host_repeater_settings import HostRepeaterSettings, RegionConfig

    base = {
        "device_name": "Bridge",
        "public_key_hex": "aabb",
        "self_info": {
            "radio_freq": 869.618,
            "radio_bw": 62.5,
            "radio_sf": 8,
            "radio_cr": 8,
            "tx_power": 22,
            "max_tx_power": 22,
            "multi_acks": 0,
            "name": "Bridge",
            "public_key": "aabb",
        },
        "device_info": {"model": "Heltec V3", "firmware_version": "v1.16"},
        "stats": {"uptime_secs": 1234},
        "host_repeater_settings": HostRepeaterSettings(
            regions=[
                RegionConfig(name="nl", deny_flood=True),
                RegionConfig(name="nl-gr", parent="nl"),
            ],
            home_region="nl-gr",
            dc_gate_enabled=True,
            dc_gate_threshold=80,
            dc_gate_hysteresis=5,
            flood_max=32,
        ),
        "host_repeater_state": "armed",
        "flood_scope": "nl-gr",
        "fanout_config": {"iata": "ams", "publish_regions": True, "status_interval_ms": 60000},
    }
    base.update(overrides)
    return base


def test_format_node_config_mirrors_dmc_sections():
    payload = cm._format_node_config(**_config_inputs())
    assert payload["origin"] == "Bridge"
    assert payload["origin_id"] == "AABB"
    assert payload["node_name"] == "Bridge"
    assert payload["model"] == "Heltec V3"
    assert payload["uptime_secs"] == 1234
    assert payload["radio"] == {
        "freq": 869.618,
        "bw": 62.5,
        "sf": 8,
        "cr": 8,
        "tx_power": 22,
        "max_tx_power": 22,
        "multi_acks": 0,
    }
    assert payload["repeat"]["disable_fwd"] is False  # armed
    assert payload["repeat"]["flood_max"] == 32
    assert payload["repeat"]["loop_detect"] == "minimal"
    assert payload["region_gate"] == {"enabled": True, "threshold": 80, "hysteresis": 5}
    assert payload["region"]["home"] == "nl-gr"
    assert payload["region"]["default"] == "nl-gr"
    assert payload["region"]["wildcard_flood"] is True
    assert payload["region"]["scopes"] == [
        {"name": "nl", "flood": False, "parent": "*"},
        {"name": "nl-gr", "flood": True, "parent": "nl"},
    ]
    assert payload["host_repeater"] == {"state": "armed"}
    assert payload["mqtt"]["regions"] is True
    assert payload["mqtt"]["status_interval"] == 60000
    assert payload["mqtt"]["iata"] == "AMS"
    assert payload["mqtt"]["config"] is True
    # Never leaks secrets or the public key beyond origin_id.
    assert "password" not in json.dumps(payload).lower()
    assert "timestamp" in payload


def test_format_node_config_omits_sections_without_data():
    payload = cm._format_node_config(
        **_config_inputs(
            self_info=None,
            device_info=None,
            stats=None,
            host_repeater_settings=None,
            host_repeater_state=None,
            flood_scope=None,
            fanout_config={},
        )
    )
    assert "radio" not in payload
    assert "repeat" not in payload
    assert "region" not in payload
    assert "region_gate" not in payload
    assert "model" not in payload
    assert "uptime_secs" not in payload
    assert payload["mqtt"]["status"] is True
    assert payload["mqtt"]["packets"] is True
    assert "iata" not in payload["mqtt"]


def test_format_node_config_default_scope_without_host_repeater():
    payload = cm._format_node_config(
        **_config_inputs(host_repeater_settings=None, host_repeater_state=None)
    )
    assert payload["region"] == {"default": "nl-gr"}
