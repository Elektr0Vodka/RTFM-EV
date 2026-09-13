"""Tests for decoded stat-field derivation from PacketInfo."""

from app.decoder import PacketInfo, PayloadType, RouteType
from app.services.packet_decoded_fields import decoded_stat_fields, route_label


def test_route_label_mapping():
    assert route_label(RouteType.FLOOD) == "Flood"
    assert route_label(RouteType.DIRECT) == "Direct"
    assert route_label(RouteType.TRANSPORT_FLOOD) == "TransportFlood"
    assert route_label(RouteType.TRANSPORT_DIRECT) == "TransportDirect"
    assert route_label(99) == "Unknown"
    assert route_label(None) == "Unknown"


def test_decoded_fields_none_packet():
    assert decoded_stat_fields(None) == {
        "route_type": "Unknown",
        "hop_count": 0,
        "hop_byte_width": 0,
        "path_signature": None,
    }


def test_decoded_fields_pathless():
    info = PacketInfo(
        route_type=RouteType.FLOOD,
        payload_type=PayloadType(0x02),
        payload_version=0,
        path_length=0,
        path=b"",
        payload=b"abc",
        path_hash_size=1,
    )
    fields = decoded_stat_fields(info)
    assert fields["route_type"] == "Flood"
    assert fields["hop_count"] == 0
    assert fields["hop_byte_width"] == 0
    assert fields["path_signature"] is None


def test_decoded_fields_with_path():
    info = PacketInfo(
        route_type=RouteType.DIRECT,
        payload_type=PayloadType(0x02),
        payload_version=0,
        path_length=2,
        path=bytes([0xAB, 0xCD]),
        payload=b"xy",
        path_hash_size=1,
    )
    fields = decoded_stat_fields(info)
    assert fields["route_type"] == "Direct"
    assert fields["hop_count"] == 2
    assert fields["hop_byte_width"] == 1
    assert fields["path_signature"] == "abcd"
