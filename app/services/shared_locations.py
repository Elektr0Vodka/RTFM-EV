"""Collect location shares from stored chat messages for the map layer.

Read-only and local: the result feeds the operator's own map view only. DM
shares are included here but must never be sent to fanout, MQTT or exports.
"""

from app.location_payloads import parse_location_share
from app.models import Message, SharedLocation, SharedLocationsResponse
from app.reaction_payloads import channel_sender, message_body
from app.repository import AppSettingsRepository, MessageRepository

# Newest messages examined per request. Parsing is a few regexes per row, so
# this bounds the cost of an "All time" window on a large database.
SCAN_LIMIT = 20000


def _sender_identity(msg: Message, sender_name: str | None) -> str:
    # One pin per person: our own shares are one sender; a DM partner is its
    # conversation; channel senders by key when known, else by name.
    if msg.outgoing:
        return "self"
    if msg.type == "PRIV":
        return f"key:{msg.conversation_key.lower()}"
    if msg.sender_key:
        return f"key:{msg.sender_key.lower()}"
    if sender_name:
        return f"name:{sender_name.strip().lower()}"
    return f"msg:{msg.id}"


def _to_shared_location(msg: Message, conversation_name: str | None) -> SharedLocation | None:
    share = parse_location_share(message_body(msg.text, msg.type))
    if share is None:
        return None
    sender_name = channel_sender(msg.text) if msg.type == "CHAN" else msg.sender_name
    return SharedLocation(
        message_id=msg.id,
        type=msg.type,
        conversation_key=msg.conversation_key,
        conversation_name=conversation_name,
        sender_key=msg.sender_key,
        sender_name=sender_name or msg.sender_name,
        outgoing=msg.outgoing,
        received_at=msg.received_at,
        sender_timestamp=msg.sender_timestamp,
        lat=share.lat,
        lon=share.lon,
        format=share.format,
        raw=share.raw,
        label=share.label,
        flags=share.flags,
        precision_m=share.precision_m,
        paths=msg.paths,
    )


async def collect_shared_locations(
    since: int | None,
    until: int | None,
    latest_per_sender: bool,
    scan_limit: int = SCAN_LIMIT,
) -> SharedLocationsResponse:
    """Location shares received in (since, until], newest first.

    With ``latest_per_sender`` only the newest share per sender is kept.
    Messages from blocked keys/names are skipped, as in the chat views.
    """
    settings = await AppSettingsRepository.get()
    rows = await MessageRepository.get_received_window(
        since=since,
        until=until,
        limit=scan_limit + 1,
        blocked_keys=settings.blocked_keys or None,
        blocked_names=settings.blocked_names or None,
    )
    truncated = len(rows) > scan_limit
    rows = rows[:scan_limit]

    locations: list[SharedLocation] = []
    seen_senders: set[str] = set()
    for msg, conversation_name in rows:
        location = _to_shared_location(msg, conversation_name)
        if location is None:
            continue
        if latest_per_sender:
            identity = _sender_identity(msg, location.sender_name)
            if identity in seen_senders:
                continue
            seen_senders.add(identity)
        locations.append(location)
    return SharedLocationsResponse(locations=locations, scanned=len(rows), truncated=truncated)
