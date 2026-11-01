"""Who a stored wardrive reception was heard from, by the wardrive page's own
rules (``frontend/src/wardrive/decode/reception.ts``, which follows
rx.mesh-hunter.eu). The coverage map filters and names receptions with it on
the server, so the map and the page agree.

Pinned to the page by ``tests/fixtures/wardrive_sender_vectors.json``, which
the page's decoder writes (``src/test/wardrive/senderVectors.test.ts``).
Where the page's decoder (meshcore-decoder 0.3.0) rejects a payload as
invalid, the whole reception reads as ``Unknown`` with 0 hops, as it does on
the page."""

import hashlib
from typing import Any, TypedDict

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.decoder import PayloadType, RouteType, decrypt_group_text, verify_advert_signature
from app.path_utils import parse_packet_envelope
from app.wardrive.config import hashtag_key, resolved_hashtag_channels

UNKNOWN = "Unknown"

# meshcore-decoder's getPayloadTypeName.
TYPE_NAMES: dict[int, str] = {
    PayloadType.REQUEST: "Request",
    PayloadType.RESPONSE: "Response",
    PayloadType.TEXT_MESSAGE: "TextMessage",
    PayloadType.ACK: "Ack",
    PayloadType.ADVERT: "Advert",
    PayloadType.GROUP_TEXT: "GroupText",
    PayloadType.GROUP_DATA: "GroupData",
    PayloadType.ANON_REQUEST: "AnonRequest",
    PayloadType.PATH: "Path",
    PayloadType.TRACE: "Trace",
    PayloadType.MULTIPART: "Multipart",
    PayloadType.CONTROL: "Control",
    PayloadType.RAW_CUSTOM: "RawCustom",
}
TYPE_VALUES: dict[str, int] = {name: value for value, name in TYPE_NAMES.items()}

# meshcore-decoder's getDeviceRoleName.
ROLE_NAMES = {0: "Unknown", 1: "Chat Node", 2: "Repeater", 3: "Room Server", 4: "Sensor"}

ID_CLASSES = ("unnamed", "1b", "2b", "3b", "pubkey", "channel")

DISCOVER_REQ = 0x80
DISCOVER_RESP = 0x90


class Sender(TypedDict):
    kind: str | None
    id: str | None
    label: str | None
    role: str | None


ChannelKey = tuple[str, bytes]


def no_sender() -> Sender:
    return {"kind": None, "id": None, "label": None, "role": None}


def _unknown() -> dict[str, Any]:
    return {"packet_type_name": UNKNOWN, "hops": 0, "sender": no_sender(), "channel": None}


def _role_name(role: int) -> str:
    return ROLE_NAMES.get(role, f"Unknown ({role})")


async def channel_keys() -> list[ChannelKey]:
    """Public plus the hashtag channels drivers decode (the owner's list, else
    the home radio's hashtag channels)."""
    keys: list[ChannelKey] = [("Public", bytes.fromhex(PUBLIC_CHANNEL_KEY))]
    for name in await resolved_hashtag_channels():
        keys.append((name, bytes.fromhex(hashtag_key(name))))
    return keys


def _payload_valid(payload_type: int, payload: bytes) -> bool:
    """The payload checks that make meshcore-decoder mark a payload invalid."""
    n = len(payload)
    if payload_type in (PayloadType.REQUEST, PayloadType.RESPONSE, PayloadType.TEXT_MESSAGE):
        return n >= 4
    if payload_type == PayloadType.ACK:
        return n >= 4
    if payload_type == PayloadType.ADVERT:
        return n >= 101
    if payload_type == PayloadType.GROUP_TEXT:
        return n >= 3
    if payload_type == PayloadType.ANON_REQUEST:
        return n >= 35
    if payload_type == PayloadType.PATH:
        if n < 2:
            return False
        size = (payload[0] >> 6) + 1
        return size != 4 and n >= 1 + (payload[0] & 63) * size + 1
    if payload_type == PayloadType.TRACE:
        if n < 9:
            return False
        hash_size = 1 << (payload[8] & 0x03)
        return (n - 9) % hash_size == 0
    if payload_type == PayloadType.CONTROL:
        if n < 1:
            return False
        sub = payload[0] & 0xF0
        if sub == DISCOVER_REQ:
            return n >= 6
        if sub == DISCOVER_RESP:
            return n >= 14
        return False
    return True


def _channel(payload: bytes, keys: list[ChannelKey]) -> tuple[str | None, str | None]:
    """(channel name, sender name) of a channel message, or (None, None)
    when no known key opens it. Several channels can share the hash byte; the
    one whose key decrypts it names it."""
    if not payload:
        return None, None
    for name, key in keys:
        if hashlib.sha256(key).digest()[0] != payload[0]:
            continue
        opened = decrypt_group_text(payload, key)
        if opened is not None:
            return name, opened.sender
    return None, None


def _sender(
    payload_type: int, route_type: int, hops: int, path: bytes, hash_size: int, payload: bytes
) -> Sender:
    if payload_type == PayloadType.TRACE:
        return no_sender()
    if hops > 0:
        if route_type not in (RouteType.FLOOD, RouteType.TRANSPORT_FLOOD) or not path:
            return no_sender()
        ident = path[-hash_size:].hex()
        if len(ident) >= 4:
            return {"kind": "relay", "id": ident, "label": None, "role": None}
        return {"kind": "path_hash", "id": ident, "label": ident, "role": None}
    if payload_type == PayloadType.ADVERT:
        if not verify_advert_signature(payload):
            return no_sender()
        app_data = payload[100:]
        name = None
        if len(app_data) > 1:
            flags = app_data[0]
            offset = 1
            if flags & 0x10:
                offset += 8
            if flags & 0x20:
                offset += 2
            if flags & 0x40:
                offset += 2
            if flags & 0x80:
                raw_name = app_data[offset:]
                name = raw_name.split(b"\x00", 1)[0].decode("utf-8", "replace") or None
        role = _role_name(app_data[0] & 0x0F) if app_data else None
        return {"kind": "advert_pubkey", "id": payload[:32].hex(), "label": name, "role": role}
    if payload_type == PayloadType.CONTROL and payload[0] & 0xF0 == DISCOVER_RESP:
        key = payload[6:].hex()
        if key:
            return {
                "kind": "discover_pubkey",
                "id": key,
                "label": None,
                "role": _role_name(payload[0] & 0x0F),
            }
        return no_sender()
    if payload_type in (PayloadType.REQUEST, PayloadType.RESPONSE, PayloadType.TEXT_MESSAGE):
        ident = payload[1:2].hex()
        return {"kind": "direct_hash", "id": ident, "label": ident, "role": None}
    return no_sender()


def decode_sender(raw_hex: str, keys: list[ChannelKey]) -> dict[str, Any]:
    """``{packet_type_name, hops, sender, channel}`` for one stored frame.
    Never raises: a frame that cannot be read is ``Unknown`` without a sender."""
    try:
        raw = bytes.fromhex(raw_hex)
    except ValueError:
        return _unknown()
    envelope = parse_packet_envelope(raw)
    if envelope is None:
        return _unknown()
    payload_type = envelope.payload_type
    payload = envelope.payload
    if not _payload_valid(payload_type, payload):
        return _unknown()
    hops = envelope.hop_count
    sender = _sender(
        payload_type, envelope.route_type, hops, envelope.path, envelope.hash_size, payload
    )
    channel = None
    if payload_type == PayloadType.GROUP_TEXT:
        channel, sender_name = _channel(payload, keys)
        if hops == 0:
            sender = (
                {"kind": "channel_name", "id": sender_name, "label": sender_name, "role": None}
                if sender_name
                else no_sender()
            )
    return {
        "packet_type_name": TYPE_NAMES.get(payload_type, UNKNOWN),
        "hops": hops,
        "sender": sender,
        "channel": channel,
    }


def id_class(sender: Sender) -> str:
    """The page's ``idClass``: a channel name, a 1, 2 or 3 byte hash, a key
    (or key prefix), or no id."""
    if sender["kind"] == "channel_name":
        return "channel"
    ident = sender["id"] or ""
    if not sender["kind"] or not ident:
        return "unnamed"
    return {2: "1b", 4: "2b", 6: "3b"}.get(len(ident), "pubkey")
