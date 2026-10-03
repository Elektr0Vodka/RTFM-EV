"""MeshCore TEAM payload parsing (#TEL:, #T:, #WAY:, #WRC:, #CAP:)."""

import base64
import struct

from app.team_payloads import (
    TeamBeacon,
    TeamCapability,
    TeamCapabilityRequest,
    TeamRoutePart,
    TeamWaypoint,
    encode_telemetry,
    parse_team_payload,
)


def _b64(raw: bytes, *, padded: bool = False) -> str:
    text = base64.b64encode(raw).decode()
    return text if padded else text.rstrip("=")


def _tel(lat, lon, radio, phone, fwd, *, padded=False) -> str:
    raw = struct.pack(">ii", round(lat * 1e7), round(lon * 1e7)) + bytes([radio, phone, fwd])
    return "#TEL:" + _b64(raw, padded=padded)


def _topology(lat, lon, radio, phone, node_count, bitmap: bytes) -> str:
    raw = struct.pack(">ii", round(lat * 1e7), round(lon * 1e7))
    return "#T:" + _b64(raw + bytes([radio, phone, node_count]) + bitmap)


class TestTelemetry:
    def test_team_beacon(self):
        # Radio 3998 mV -> byte 210; phone 3800 mV -> byte 177; fwd: path 2, needs
        # forwarding -> ((2 << 1) | 1) + 1 = 6.
        beacon = parse_team_payload(_tel(52.0907, 5.1214, 210, 177, 6))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.kind == "tel"
        assert beacon.source == "team"
        assert (beacon.lat, beacon.lon) == (52.0907, 5.1214)
        assert beacon.radio_battery_mv == 3998
        assert beacon.phone_battery_mv == 3800
        assert beacon.phone_battery_pct is None
        assert beacon.autonomous is False
        assert beacon.needs_forwarding is True
        assert beacon.max_path_observed == 2

    def test_literal_wire_string(self):
        # 52.0907, 5.1214, radio byte 210, phone byte 177, fwd byte 6, unpadded.
        beacon = parse_team_payload("#TEL:Hwxo+AMNdrDSsQY")

        assert isinstance(beacon, TeamBeacon)
        assert (beacon.lat, beacon.lon) == (52.0907, 5.1214)
        assert beacon.radio_battery_mv == 3998

    def test_negative_coordinates(self):
        beacon = parse_team_payload(_tel(-33.865143, -151.2099, 2, 2, 1))

        assert isinstance(beacon, TeamBeacon)
        assert (beacon.lat, beacon.lon) == (-33.865143, -151.2099)
        assert beacon.radio_battery_mv == 2750
        assert beacon.needs_forwarding is False
        assert beacon.max_path_observed == 0

    def test_unknown_batteries(self):
        beacon = parse_team_payload(_tel(52.0, 5.0, 1, 0, 1))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.radio_battery_mv is None
        assert beacon.phone_battery_mv is None

    def test_autonomous_sentinel(self):
        beacon = parse_team_payload(_tel(52.0, 5.0, 100, 0xFF, 1))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.autonomous is True
        assert beacon.phone_battery_mv is None

    def test_signalk_sender(self):
        # signalk-meshcore: padded Base64, phone byte 0xFE (unknown), fwd byte 0.
        # TEAM never sends fwd byte 0, so that marks the sender.
        beacon = parse_team_payload(_tel(52.0, 5.0, 210, 0xFE, 0, padded=True))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.source == "signalk"
        assert beacon.radio_battery_mv == 3998
        assert beacon.phone_battery_mv is None
        assert beacon.phone_battery_pct is None
        assert beacon.needs_forwarding is None
        assert beacon.max_path_observed is None

    def test_signalk_phone_percentage(self):
        beacon = parse_team_payload(_tel(52.0, 5.0, 0, 87, 0, padded=True))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.radio_battery_mv is None
        assert beacon.phone_battery_pct == 87

    def test_saturated_radio_battery_is_unknown(self):
        # 0xFF is outside TEAM's range; signalk clamps a 12 V house battery to it.
        beacon = parse_team_payload(_tel(52.0, 5.0, 0xFF, 0xFE, 0))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.radio_battery_mv is None

    def test_unset_position_keeps_batteries(self):
        beacon = parse_team_payload(_tel(0.0, 0.0, 210, 177, 1))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.lat is None and beacon.lon is None
        assert beacon.radio_battery_mv == 3998

    def test_out_of_range_position(self):
        beacon = parse_team_payload(_tel(95.0, 5.0, 210, 177, 1))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.lat is None and beacon.lon is None

    def test_wrong_length_is_rejected(self):
        assert parse_team_payload("#TEL:" + _b64(b"\x01" * 10)) is None
        assert parse_team_payload("#TEL:" + _b64(b"\x01" * 12)) is None

    def test_invalid_base64_is_rejected(self):
        assert parse_team_payload("#TEL:not base64!") is None
        assert parse_team_payload("#TEL:") is None

    def test_surrounding_whitespace(self):
        assert isinstance(parse_team_payload("  #TEL:Hwxo+AMNdrDSsQY \n"), TeamBeacon)


class TestTopology:
    def test_topology_beacon(self):
        # 10 known nodes -> 2 bitmap bytes; bits 0, 3 and 9 set -> 3 neighbours.
        beacon = parse_team_payload(_topology(52.0907, 5.1214, 210, 177, 10, bytes([0x09, 0x02])))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.kind == "topology"
        assert beacon.source == "team"
        assert (beacon.lat, beacon.lon) == (52.0907, 5.1214)
        assert beacon.radio_battery_mv == 3998
        assert beacon.phone_battery_mv == 3800
        assert beacon.node_count == 10
        assert beacon.neighbor_count == 3
        assert beacon.needs_forwarding is None

    def test_no_known_nodes(self):
        beacon = parse_team_payload(_topology(52.0, 5.0, 2, 0xFF, 0, b""))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.node_count == 0
        assert beacon.neighbor_count == 0
        assert beacon.autonomous is True

    def test_bits_beyond_node_count_are_ignored(self):
        beacon = parse_team_payload(_topology(52.0, 5.0, 2, 2, 3, bytes([0xFF])))

        assert isinstance(beacon, TeamBeacon)
        assert beacon.neighbor_count == 3

    def test_short_bitmap_is_rejected(self):
        assert parse_team_payload(_topology(52.0, 5.0, 2, 2, 20, bytes([0x01]))) is None

    def test_too_short_is_rejected(self):
        assert parse_team_payload("#T:" + _b64(b"\x01" * 10)) is None


class TestWaypoint:
    def test_waypoint_with_mesh_id(self):
        waypoint = parse_team_payload("#WAY:ab12|Camp|52.0907|5.1214|Base camp|camp|")

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.mesh_id == "ab12"
        assert waypoint.name == "Camp"
        assert (waypoint.lat, waypoint.lon) == (52.0907, 5.1214)
        assert waypoint.description == "Base camp"
        assert waypoint.waypoint_type == "camp"
        assert waypoint.color is None
        assert waypoint.route_chunk == ""
        assert waypoint.part_num is None and waypoint.total_parts is None

    def test_legacy_five_fields(self):
        waypoint = parse_team_payload("#WAY:Camp|52.0907|5.1214|Base camp|camp")

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.mesh_id is None
        assert waypoint.name == "Camp"
        assert (waypoint.lat, waypoint.lon) == (52.0907, 5.1214)
        assert waypoint.waypoint_type == "camp"

    def test_color_prefix_is_stripped(self):
        waypoint = parse_team_payload("#WAY:ab12|Trail|52.0|5.0|@C:FFF44336North loop|route|")

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.description == "North loop"
        assert waypoint.color == "#f44336"

    def test_route_in_one_message(self):
        waypoint = parse_team_payload(
            "#WAY:ab12|Trail|52.000000|5.000000||route|52.000000,5.000000~52.100000,5.100000"
        )

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.route_chunk == "52.000000,5.000000~52.100000,5.100000"
        assert waypoint.part_num is None

    def test_multi_part_first_message(self):
        waypoint = parse_team_payload("#WAY:ab12|Trail|52.0|5.0||route|52.0,5.0~52.1,5.1~|1/3")

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.route_chunk == "52.0,5.0~52.1,5.1~"
        assert (waypoint.part_num, waypoint.total_parts) == (1, 3)

    def test_empty_mesh_id_is_none(self):
        waypoint = parse_team_payload("#WAY:|Camp|52.0|5.0||camp|")

        assert isinstance(waypoint, TeamWaypoint)
        assert waypoint.mesh_id is None

    def test_bad_coordinates_are_rejected(self):
        assert parse_team_payload("#WAY:ab12|Camp|north|5.0||camp|") is None
        assert parse_team_payload("#WAY:ab12|Camp|0|0||camp|") is None
        assert parse_team_payload("#WAY:ab12|Camp|nan|5.0||camp|") is None
        assert parse_team_payload("#WAY:ab12|Camp|200|5.0||camp|") is None

    def test_too_few_fields(self):
        assert parse_team_payload("#WAY:Camp|52.0|5.0|desc") is None


class TestRoutePart:
    def test_continuation(self):
        part = parse_team_payload("#WRC:ab12|52.2,5.2~52.3,5.3~|2/3")

        assert isinstance(part, TeamRoutePart)
        assert part.mesh_id == "ab12"
        assert part.route_chunk == "52.2,5.2~52.3,5.3~"
        assert (part.part_num, part.total_parts) == (2, 3)

    def test_malformed(self):
        assert parse_team_payload("#WRC:ab12|52.2,5.2") is None
        assert parse_team_payload("#WRC:ab12|52.2,5.2|two/3") is None


class TestCapability:
    def test_v1(self):
        cap = parse_team_payload("#CAP:1:0b")

        assert isinstance(cap, TeamCapability)
        assert cap.version == 1
        assert cap.flags == 0x0B
        assert cap.custom_firmware is True
        assert cap.forwarding_capable is True
        assert cap.autonomous_capable is False
        assert cap.autonomous_enabled is True
        assert cap.smart_forwarding_active is False
        assert cap.radio_key_prefix is None
        assert cap.app_id is None
        assert cap.alias is None

    def test_v2(self):
        cap = parse_team_payload("#CAP:2:1f:a1b2c3d4e5f6:0123456789abcdef:Team: Alpha")

        assert isinstance(cap, TeamCapability)
        assert cap.version == 2
        assert cap.flags == 0x1F
        assert cap.smart_forwarding_active is True
        assert cap.radio_key_prefix == "a1b2c3d4e5f6"
        assert cap.app_id == "0123456789abcdef"
        assert cap.alias == "Team: Alpha"

    def test_v2_without_radio_or_app_id(self):
        cap = parse_team_payload("#CAP:2:01:-:-:")

        assert isinstance(cap, TeamCapability)
        assert cap.radio_key_prefix is None
        assert cap.app_id is None
        assert cap.alias == ""

    def test_early_v2_alias_after_key_prefix(self):
        cap = parse_team_payload("#CAP:2:01:a1b2c3d4e5f6:Scout")

        assert isinstance(cap, TeamCapability)
        assert cap.app_id is None
        assert cap.alias == "Scout"

    def test_request(self):
        request = parse_team_payload("#CAP:R:a1b2c3d4e5f6:Radio: One")

        assert isinstance(request, TeamCapabilityRequest)
        assert request.target_key_prefix == "a1b2c3d4e5f6"
        assert request.target_radio_name == "Radio: One"

    def test_request_without_key(self):
        request = parse_team_payload("#CAP:R:-:Radio One")

        assert isinstance(request, TeamCapabilityRequest)
        assert request.target_key_prefix is None

    def test_malformed(self):
        assert parse_team_payload("#CAP:1") is None
        assert parse_team_payload("#CAP:x:0b") is None
        assert parse_team_payload("#CAP:1:zz") is None
        assert parse_team_payload("#CAP:R:-:") is None


def test_ordinary_text_is_not_a_payload():
    assert parse_team_payload("hello world") is None
    assert parse_team_payload("see #TEL: later") is None
    assert parse_team_payload("") is None


class TestEncodeTelemetry:
    def test_round_trips_through_the_parser(self):
        text = encode_telemetry(52.0907, 5.1214, radio_battery_mv=3998)

        assert text == "#TEL:Hwxo+AMNdrDSAQE"
        beacon = parse_team_payload(text)
        assert isinstance(beacon, TeamBeacon)
        assert beacon.source == "team"
        assert (beacon.lat, beacon.lon) == (52.0907, 5.1214)
        assert beacon.radio_battery_mv == 3998
        # No phone is attached: phone battery unknown, not the autonomous sentinel.
        assert beacon.phone_battery_mv is None
        assert beacon.autonomous is False
        assert (beacon.needs_forwarding, beacon.max_path_observed) == (False, 0)

    def test_unknown_or_out_of_range_battery(self):
        unknown = parse_team_payload(encode_telemetry(52.0, 5.0))
        assert isinstance(unknown, TeamBeacon)
        assert unknown.radio_battery_mv is None

        # A 12 V supply is clamped to TEAM's top value (254), never the 0xFF sentinel.
        high = parse_team_payload(encode_telemetry(52.0, 5.0, radio_battery_mv=12600))
        assert isinstance(high, TeamBeacon)
        assert high.radio_battery_mv == 2750 + 252 * 6

        low = parse_team_payload(encode_telemetry(52.0, 5.0, radio_battery_mv=2000))
        assert isinstance(low, TeamBeacon)
        assert low.radio_battery_mv == 2750

    def test_negative_coordinates(self):
        beacon = parse_team_payload(encode_telemetry(-33.865143, -151.2099))
        assert isinstance(beacon, TeamBeacon)
        assert (beacon.lat, beacon.lon) == (-33.865143, -151.2099)
