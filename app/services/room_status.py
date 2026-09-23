"""Room-server status frame layout.

Room firmware (``simple_room_server`` ``ServerStats``) sends a 52-byte status
frame that matches the repeater frame up to ``n_flood_dups``, then ends with
``uint16 n_posted, uint16 n_post_push`` where the repeater frame has
``uint32 total_rx_air_time_secs`` (and, since v1.12, ``uint32 n_recv_errors``).
meshcore_py always decodes with the repeater layout, so for a room those four
bytes arrive as ``rx_airtime``.

OpenHop answers status requests with the 56-byte repeater layout for every
node, so the room layout is only applied to the short frame (no
``recv_errors``) from a room-server contact.
"""

from app.models import CONTACT_TYPE_ROOM


def room_status_fields(contact_type: int | None, status: dict) -> dict:
    """Return RX airtime / room post counters for a parsed status dict.

    Keys: ``rx_airtime_seconds``, ``room_posted``, ``room_post_pushes``.
    """
    raw = status.get("rx_airtime", 0) or 0
    if contact_type == CONTACT_TYPE_ROOM and status.get("recv_errors") is None:
        return {
            "rx_airtime_seconds": None,
            "room_posted": raw & 0xFFFF,
            "room_post_pushes": (raw >> 16) & 0xFFFF,
        }
    return {"rx_airtime_seconds": raw, "room_posted": None, "room_post_pushes": None}
