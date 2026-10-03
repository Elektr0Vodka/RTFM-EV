"""Collect MeshCore TEAM beacons and waypoints from stored channel messages.

Read-only and local: the result feeds the operator's own map view and the
contact history only. Nothing here is sent to fanout, MQTT or exports.
"""

from app.models import Message, TeamBeaconPoint, TeamBeaconsResponse, TeamWaypointPin
from app.reaction_payloads import channel_sender, message_body
from app.repository import AppSettingsRepository, ContactRepository, MessageRepository
from app.services.shared_locations import sender_identity
from app.team_payloads import (
    MAP_PREFIXES,
    TeamBeacon,
    TeamRoutePart,
    TeamWaypoint,
    decode_route,
    parse_team_payload,
)

# Newest candidate messages examined per request (rows holding a TEAM prefix).
SCAN_LIMIT = 20000
# A route split into more parts than this is not reassembled.
MAX_ROUTE_PARTS = 64

# (sender identity, channel key, mesh id): one waypoint, and the route parts that belong to it.
_WaypointKey = tuple[str, str, str]


def _is_sender(msg: Message, sender_name: str | None, key: str, contact_name: str | None) -> bool:
    if msg.sender_key:
        return msg.sender_key.lower() == key
    return bool(contact_name) and sender_name == contact_name


def _route(
    waypoint: TeamWaypoint, parts: dict[int, str] | None
) -> tuple[list[tuple[float, float]], bool]:
    """The waypoint's route points, and whether every part of it arrived."""
    total = waypoint.total_parts
    if total is None or total <= 1:
        return decode_route(waypoint.route_chunk), True
    if total > MAX_ROUTE_PARTS or parts is None:
        return [], False
    chunks = [waypoint.route_chunk]
    for part_num in range(2, total + 1):
        chunk = parts.get(part_num)
        if chunk is None:
            return [], False
        chunks.append(chunk)
    return decode_route("".join(chunks)), True


async def collect_team_beacons(
    since: int | None,
    until: int | None,
    latest_per_sender: bool,
    sender_key: str | None = None,
    scan_limit: int = SCAN_LIMIT,
) -> TeamBeaconsResponse:
    """TEAM beacons and waypoints received on channels in (since, until], newest first.

    With ``latest_per_sender`` only the newest beacon per sender is kept. A
    re-sent waypoint (same sender, channel and mesh id) keeps its newest copy.
    ``sender_key`` narrows to one contact: by sender key, or by the contact's
    name for messages stored without a key. Blocked senders are skipped.
    """
    settings = await AppSettingsRepository.get()
    rows = await MessageRepository.get_received_window(
        since=since,
        until=until,
        limit=scan_limit + 1,
        blocked_keys=settings.blocked_keys or None,
        blocked_names=settings.blocked_names or None,
        msg_type="CHAN",
        text_contains_any=MAP_PREFIXES,
    )
    truncated = len(rows) > scan_limit
    rows = rows[:scan_limit]

    wanted_key = sender_key.lower() if sender_key else None
    contact_name: str | None = None
    if wanted_key:
        contact = await ContactRepository.get_by_key(wanted_key)
        contact_name = contact.name if contact else None

    beacons: list[TeamBeaconPoint] = []
    seen_senders: set[str] = set()
    waypoints: list[tuple[_WaypointKey | None, Message, str | None, str | None, TeamWaypoint]] = []
    seen_waypoints: set[_WaypointKey] = set()
    route_parts: dict[_WaypointKey, dict[int, str]] = {}

    for msg, conversation_name in rows:
        payload = parse_team_payload(message_body(msg.text, msg.type))
        if payload is None:
            continue
        sender_name = channel_sender(msg.text) or msg.sender_name
        if wanted_key and not _is_sender(msg, sender_name, wanted_key, contact_name):
            continue
        identity = sender_identity(msg, sender_name)

        if isinstance(payload, TeamBeacon):
            if payload.lat is None or payload.lon is None:
                continue
            if latest_per_sender:
                if identity in seen_senders:
                    continue
                seen_senders.add(identity)
            beacons.append(
                TeamBeaconPoint(
                    message_id=msg.id,
                    conversation_key=msg.conversation_key,
                    conversation_name=conversation_name,
                    sender_key=msg.sender_key,
                    sender_name=sender_name,
                    outgoing=msg.outgoing,
                    received_at=msg.received_at,
                    sender_timestamp=msg.sender_timestamp,
                    kind=payload.kind,
                    source=payload.source,
                    lat=payload.lat,
                    lon=payload.lon,
                    radio_battery_mv=payload.radio_battery_mv,
                    phone_battery_mv=payload.phone_battery_mv,
                    phone_battery_pct=payload.phone_battery_pct,
                    autonomous=payload.autonomous,
                    needs_forwarding=payload.needs_forwarding,
                    max_path_observed=payload.max_path_observed,
                    node_count=payload.node_count,
                    neighbor_count=payload.neighbor_count,
                    paths=msg.paths,
                )
            )
        elif isinstance(payload, TeamWaypoint):
            key = (identity, msg.conversation_key, payload.mesh_id) if payload.mesh_id else None
            if key is not None:
                if key in seen_waypoints:
                    continue
                seen_waypoints.add(key)
            waypoints.append((key, msg, conversation_name, sender_name, payload))
        elif isinstance(payload, TeamRoutePart):
            # Rows are newest first, so the first copy of a part is the newest.
            parts = route_parts.setdefault((identity, msg.conversation_key, payload.mesh_id), {})
            parts.setdefault(payload.part_num, payload.route_chunk)

    pins: list[TeamWaypointPin] = []
    for key, msg, conversation_name, sender_name, waypoint in waypoints:
        route, complete = _route(waypoint, route_parts.get(key) if key else None)
        pins.append(
            TeamWaypointPin(
                message_id=msg.id,
                conversation_key=msg.conversation_key,
                conversation_name=conversation_name,
                sender_key=msg.sender_key,
                sender_name=sender_name,
                outgoing=msg.outgoing,
                received_at=msg.received_at,
                sender_timestamp=msg.sender_timestamp,
                mesh_id=waypoint.mesh_id,
                name=waypoint.name,
                description=waypoint.description,
                waypoint_type=waypoint.waypoint_type,
                color=waypoint.color,
                lat=waypoint.lat,
                lon=waypoint.lon,
                route=route,
                route_complete=complete,
                paths=msg.paths,
            )
        )
    return TeamBeaconsResponse(
        beacons=beacons, waypoints=pins, scanned=len(rows), truncated=truncated
    )
