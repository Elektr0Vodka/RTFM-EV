"""Tests for forwarding per-remote-node telemetry/neighbors/regions to the
community observer feed (plan [24]).

The whole id fix: forwarded messages keep ``origin_id`` = the publishing radio
(self) so the broker's publisher==origin rule is satisfied untouched, and carry
the heard node R in a distinct ``subject_id`` field.
"""

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
    # publisher (self) — satisfies the broker's origin_id==publisher rule
    assert out["origin_id"] == _SELF.upper()
    assert out["origin"] == "MyRadio"
    # heard node R — the whole point
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
