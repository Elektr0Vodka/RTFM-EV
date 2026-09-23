"""Typed WebSocket event contracts and serialization helpers."""

import json
import logging
from typing import Any, Literal, NotRequired

from pydantic import TypeAdapter
from typing_extensions import TypedDict

from app.models import Channel, Contact, Message, MessagePath, RawPacketBroadcast
from app.routers.health import HealthResponse

logger = logging.getLogger(__name__)

WsEventType = Literal[
    "health",
    "message",
    "contact",
    "contact_resolved",
    "channel",
    "contact_deleted",
    "channel_deleted",
    "raw_packet",
    "message_acked",
    "message_failed",
    "message_deleted",
    "new_node",
    "error",
    "success",
]


class ContactDeletedPayload(TypedDict):
    public_key: str


class ContactResolvedPayload(TypedDict):
    previous_public_key: str
    contact: Contact


class ChannelDeletedPayload(TypedDict):
    key: str


class MessageAckedPayload(TypedDict):
    message_id: int
    ack_count: int
    paths: NotRequired[list[MessagePath]]
    packet_id: NotRequired[int | None]


class MessageFailedPayload(TypedDict):
    message_id: int
    failed_at: int


class MessageDeletedPayload(TypedDict):
    message_id: int
    type: str
    conversation_key: str


class ToastPayload(TypedDict):
    message: str
    details: NotRequired[str]


class NewNodePayload(TypedDict):
    """A first-ever-seen contact, or a batched summary on a busy mesh.

    ``batched=False`` carries one contact's detail (``public_key``/``name``/
    ``type`` set, ``count`` is always 1). ``batched=True`` is a summary only
    (those three fields are null); ``types`` is always a per-contact-type
    breakdown ({"1": 2, "2": 1, ...}) so the frontend can filter by type
    without needing per-node detail for a batch.
    """

    batched: bool
    count: int
    public_key: str | None
    name: str | None
    type: int | None
    types: dict[str, int]


_PAYLOAD_ADAPTERS: dict[WsEventType, TypeAdapter[Any]] = {
    "health": TypeAdapter(HealthResponse),
    "message": TypeAdapter(Message),
    "contact": TypeAdapter(Contact),
    "contact_resolved": TypeAdapter(ContactResolvedPayload),
    "channel": TypeAdapter(Channel),
    "contact_deleted": TypeAdapter(ContactDeletedPayload),
    "channel_deleted": TypeAdapter(ChannelDeletedPayload),
    "raw_packet": TypeAdapter(RawPacketBroadcast),
    "message_acked": TypeAdapter(MessageAckedPayload),
    "message_failed": TypeAdapter(MessageFailedPayload),
    "message_deleted": TypeAdapter(MessageDeletedPayload),
    "new_node": TypeAdapter(NewNodePayload),
    "error": TypeAdapter(ToastPayload),
    "success": TypeAdapter(ToastPayload),
}


def dump_ws_event(event_type: str, data: Any) -> str:
    """Serialize a WebSocket event envelope with validation for known event types."""
    adapter = _PAYLOAD_ADAPTERS.get(event_type)  # type: ignore[arg-type]
    if adapter is None:
        return json.dumps({"type": event_type, "data": data})

    try:
        validated = adapter.validate_python(data)
        payload = adapter.dump_python(validated, mode="json")
        return json.dumps({"type": event_type, "data": payload})
    except Exception:
        logger.exception(
            "Failed to validate WebSocket payload for event %s; falling back to raw JSON envelope",
            event_type,
        )
        return json.dumps({"type": event_type, "data": data})
