"""Derive persistable "decoded stat" fields from a parsed packet header.

These fields (route label, hop count, hop byte width, path signature) are
computed once at ingest from the already-parsed ``PacketInfo`` and stored on
``raw_packets`` so historical Raw-Packet-Feed breakdowns can be computed in the
DB without re-decoding bytes. The route labels match the frontend vocabulary
(``frontend/src/utils/rawPacketStats.ts``) so query results render directly.
"""

from app.decoder import PacketInfo, RouteType

_ROUTE_LABELS: dict[RouteType, str] = {
    RouteType.FLOOD: "Flood",
    RouteType.DIRECT: "Direct",
    RouteType.TRANSPORT_FLOOD: "TransportFlood",
    RouteType.TRANSPORT_DIRECT: "TransportDirect",
}


def route_label(route_type: object) -> str:
    """Map a RouteType (or raw int) to the frontend route label."""
    try:
        return _ROUTE_LABELS.get(RouteType(route_type), "Unknown")  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return "Unknown"


def decoded_stat_fields(packet_info: PacketInfo | None) -> dict:
    """Return the persistable decoded stat fields for a packet.

    ``hop_byte_width`` is 0 for path-less packets ("No path"). ``path_signature``
    is the hex of the routing path bytes (a stable per-path identifier), or None
    when there is no path.
    """
    if packet_info is None:
        return {
            "route_type": "Unknown",
            "hop_count": 0,
            "hop_byte_width": 0,
            "path_signature": None,
        }
    hops = packet_info.path_length or 0
    width = packet_info.path_hash_size if hops > 0 else 0
    signature = packet_info.path.hex() if (hops > 0 and packet_info.path) else None
    return {
        "route_type": route_label(packet_info.route_type),
        "hop_count": hops,
        "hop_byte_width": width,
        "path_signature": signature,
    }
