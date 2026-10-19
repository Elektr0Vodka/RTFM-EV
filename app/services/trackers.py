"""Turn decoded ATAK (TAK-MESHCORE), MeshCore SAR and MeshCoreNG traffic into trackers.

Positions and ATAK map objects go to ``tracker_positions`` / ``tracker_objects``
and out as a ``tracker`` WebSocket event, which ``broadcast_event`` never hands
to fanout, MQTT or push. ATAK chat becomes an ordinary channel message. Pings,
acks and encrypted frames are only counted. Nothing here transmits.
"""

import logging
from collections import Counter
from dataclasses import dataclass

from app.atak_payloads import (
    ATAK_DEST_CALLSIGN,
    DATA_TYPE_ATAK_AX25,
    DATA_TYPE_ATAK_RAW,
    DATA_TYPE_DEV,
    TLV_CHAT,
    TLV_CHAT_ACK,
    TLV_COT,
    TLV_COT_ACK,
    TLV_COT_FRAGMENT,
    TLV_GPS,
    TLV_NET_CONFIG,
    TLV_PING,
    Ax25Frame,
    CotEvent,
    decode_ax25,
    decode_chat,
    decode_cot,
    decode_cot_fragment,
    decode_gps,
    decode_sar_fast_gps,
    decode_tlv,
    looks_encrypted,
    parse_envelope,
)
from app.decoder import DecryptedGroupData
from app.meshcoreng import DATA_TYPE_MESHCORENG_TRACKER, Mcl1Report, decode_mcl1
from app.models import TrackerObject, TrackerPosition
from app.repository import ContactRepository
from app.repository.trackers import TrackerRepository
from app.services.atak_reassembly import atak_reassembler
from app.tak_stream.server import tak_stream
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

_COUNTED_KINDS = {
    TLV_PING: "ping",
    TLV_CHAT_ACK: "chat_ack",
    TLV_NET_CONFIG: "net_config",
    TLV_COT_ACK: "cot_ack",
}

# (channel key, kind) -> frames seen that are not stored (pings, acks, encrypted, ...).
tracker_counters: Counter[tuple[str, str]] = Counter()


@dataclass
class DatagramContext:
    packet_id: int | None
    channel_key: str
    channel_name: str | None
    received_at: int
    path: str | None
    path_len: int | None
    rssi: int | None
    snr: float | None
    packet_hash: str | None
    transport_code: int | None
    region: str | None
    # False for historical decryption: no fanout, push or TAK Stream for old traffic.
    realtime: bool = True


def _count(ctx: DatagramContext, kind: str) -> None:
    """Count a frame that is recognised but not stored (encrypted, ping, ack, ...)."""
    tracker_counters[(ctx.channel_key, kind)] += 1
    logger.debug("ATAK %s frame on channel %s (not stored)", kind, ctx.channel_name or "?")


def tracker_counts() -> dict[str, int]:
    """Frames per kind that were recognised but not stored, since the server started."""
    totals: Counter[str] = Counter()
    for (_channel, kind), n in tracker_counters.items():
        totals[kind] += n
    return dict(totals)


def _publish(kind: str, item: TrackerPosition | TrackerObject, realtime: bool) -> None:
    """Announce a stored item. Never raises: the row is already written by then."""
    try:
        broadcast_event("tracker", {"kind": kind, "data": item.model_dump()}, realtime=realtime)
    except Exception:  # noqa: BLE001 - a failed broadcast must not undo the stored row
        logger.exception("Tracker broadcast failed")
    if not realtime:
        return
    try:
        tak_stream.publish_tracker(item)  # no-op unless MESHCORE_TAK_STREAM_ENABLED
    except Exception:  # noqa: BLE001 - the stream must not break ingest
        logger.exception("TAK Stream publish failed")


async def _store_position(ctx: DatagramContext, position: TrackerPosition) -> None:
    await _save_position(position, ctx.realtime)


async def _save_position(position: TrackerPosition, realtime: bool) -> None:
    # A raw packet decoded again (historical decryption, restart) adds no second fix.
    if position.packet_id is not None and await TrackerRepository.has_position_for_packet(
        position.packet_id
    ):
        return
    stored = position.model_copy(update={"id": await TrackerRepository.add_position(position)})
    _publish("position", stored, realtime)


async def _store_chat(ctx: DatagramContext, sender: str, text: str) -> None:
    from app.services.messages import (
        create_fallback_channel_message,
        create_message_from_decrypted,
    )

    if ctx.packet_id is None:
        await create_fallback_channel_message(
            conversation_key=ctx.channel_key,
            message_text=text,
            sender_timestamp=ctx.received_at,
            received_at=ctx.received_at,
            path=ctx.path,
            path_len=ctx.path_len,
            txt_type=0,
            sender_name=sender,
            channel_name=ctx.channel_name,
            broadcast_fn=broadcast_event,
        )
        return
    await create_message_from_decrypted(
        packet_id=ctx.packet_id,
        channel_key=ctx.channel_key,
        sender=sender,
        message_text=text,
        timestamp=ctx.received_at,
        received_at=ctx.received_at,
        path=ctx.path,
        path_len=ctx.path_len,
        rssi=ctx.rssi,
        snr=ctx.snr,
        channel_name=ctx.channel_name,
        realtime=ctx.realtime,
        broadcast_fn=broadcast_event,
        packet_hash=ctx.packet_hash,
        transport_code=ctx.transport_code,
        region=ctx.region,
    )


async def _mcl1_fields(report: Mcl1Report) -> dict:
    """TrackerPosition fields of a MeshCoreNG report; a nameless one uses the contact's name."""
    name = report.name
    if not name:
        contact = await ContactRepository.get_by_key_prefix(report.node_id)
        name = contact.name if contact and contact.name else report.node_id
    return {
        "source": "meshcoreng",
        "identity": report.node_id,
        "display_name": name,
        "lat": report.lat,
        "lon": report.lon,
        "alt_m": report.alt_m,
        "speed_mps": report.speed_cms / 100,
        "course_deg": report.heading_cdeg / 100,
    }


async def handle_meshcoreng_location(
    payload: bytes, *, packet_id: int, path_len: int, received_at: int
) -> bool:
    """Store a plaintext MeshCoreNG 0x0D report; repeats share the raw packet id."""
    report = decode_mcl1(payload)
    if report is None:
        return False
    position = TrackerPosition(
        channel_key=None,
        packet_id=packet_id,
        path_len=path_len,
        received_at=received_at,
        **await _mcl1_fields(report),
    )
    await _save_position(position, realtime=True)
    return True


def _position(ctx: DatagramContext, **fields) -> TrackerPosition:
    return TrackerPosition(
        channel_key=ctx.channel_key,
        packet_id=ctx.packet_id,
        path_len=ctx.path_len,
        received_at=ctx.received_at,
        **fields,
    )


async def _handle_cot(ctx: DatagramContext, sender: str, event: CotEvent) -> None:
    if event.type.startswith("b-t-f"):
        if event.remarks:
            await _store_chat(ctx, event.callsign or sender, event.remarks)
        return
    if event.lat is None or event.lon is None:
        return
    if event.type.startswith("a-") and event.uid.startswith("ANDROID-"):
        identity = event.callsign or event.uid.removeprefix("ANDROID-")
        await _store_position(
            ctx,
            _position(
                ctx,
                source="atak",
                identity=identity,
                cot_uid=event.uid,
                display_name=identity,
                team=event.team,
                lat=event.lat,
                lon=event.lon,
                speed_mps=event.speed_mps,
                course_deg=event.course_deg,
            ),
        )
        return
    obj = TrackerObject(
        uid=event.uid,
        cot_type=event.type,
        callsign=event.callsign,
        lat=event.lat,
        lon=event.lon,
        remarks=event.remarks,
        stale_at=event.stale_at,
        sender=sender,
        channel_key=ctx.channel_key,
        received_at=ctx.received_at,
    )
    await TrackerRepository.upsert_object(obj)
    _publish("object", obj, ctx.realtime)


async def _handle_frame(ctx: DatagramContext, raw: bytes) -> bool:
    frame = decode_ax25(raw)
    if frame is None or frame.dest != ATAK_DEST_CALLSIGN:
        return False
    if atak_reassembler.seen_frame(ctx.channel_key, raw):
        return True
    try:
        await _process_frame(ctx, frame)
    except Exception:
        # Not stored: let a repeat of this frame try again.
        atak_reassembler.forget_frame(ctx.channel_key, raw)
        raise
    return True


async def _process_frame(ctx: DatagramContext, frame: Ax25Frame) -> None:
    if looks_encrypted(frame.info):
        _count(ctx, "encrypted")
        return
    tlv = decode_tlv(frame.info)
    if tlv is None:
        _count(ctx, "unknown")
        return

    if tlv.type == TLV_GPS:
        gps = decode_gps(tlv.value)
        if gps is not None:
            name = gps.full_callsign or gps.callsign
            await _store_position(
                ctx,
                _position(
                    ctx,
                    source="atak",
                    identity=name,
                    # The plugin names a peer ANDROID-<FULL CALLSIGN>; the radio form is not a uid.
                    cot_uid=f"ANDROID-{gps.full_callsign.upper()}" if gps.full_callsign else None,
                    display_name=name,
                    team=gps.team,
                    lat=gps.lat,
                    lon=gps.lon,
                    alt_m=gps.alt_m,
                    speed_mps=gps.speed_mps,
                    course_deg=gps.course_deg,
                    battery_pct=gps.battery_pct,
                ),
            )
    elif tlv.type == TLV_CHAT:
        chat = decode_chat(tlv.value)
        if chat is not None:
            await _store_chat(ctx, chat.sender or frame.src, chat.text)
    elif tlv.type in (TLV_COT, TLV_COT_FRAGMENT):
        gz: bytes | None = tlv.value
        if tlv.type == TLV_COT_FRAGMENT:
            fragment = decode_cot_fragment(tlv.value)
            gz = atak_reassembler.add_cot_fragment(frame.src, fragment) if fragment else None
        event = decode_cot(gz) if gz else None
        if event is not None:
            await _handle_cot(ctx, frame.src, event)
    else:
        _count(ctx, _COUNTED_KINDS.get(tlv.type, "unknown"))


async def _handle_envelope_text(text: str, ctx: DatagramContext) -> bool:
    chunk = parse_envelope(text)
    if chunk is None:
        return False
    raw = atak_reassembler.add_chunk(ctx.channel_key, chunk)
    if raw is None:
        return True  # more parts to come
    return await _handle_frame(ctx, raw)


async def handle_tracker_datagram(decrypted: DecryptedGroupData, ctx: DatagramContext) -> bool:
    """Handle a decrypted GRP_DATA datagram; True means it was tracker traffic."""
    if decrypted.data_type == DATA_TYPE_DEV:
        fix = decode_sar_fast_gps(decrypted.data)
        if fix is None:
            return False
        # No timestamp in the beacon: a flood repeat is byte-identical.
        sar_key = b"sar:" + decrypted.data
        if atak_reassembler.seen_frame(ctx.channel_key, sar_key):
            return True
        try:
            contact = await ContactRepository.get_by_key_prefix(fix.sender_prefix)
            await _store_position(
                ctx,
                _position(
                    ctx,
                    source="sar_fast_gps",
                    identity=fix.sender_prefix,
                    display_name=contact.name if contact and contact.name else fix.sender_prefix,
                    lat=fix.lat,
                    lon=fix.lon,
                    speed_mps=round(fix.speed_kmh / 3.6, 2),
                ),
            )
        except Exception:
            atak_reassembler.forget_frame(ctx.channel_key, sar_key)
            raise
        return True
    if decrypted.data_type == DATA_TYPE_MESHCORENG_TRACKER:
        report = decode_mcl1(decrypted.data)
        if report is None:
            return False
        # The report carries the node's timestamp: a flood repeat is byte-identical.
        ng_key = b"mcl1:" + decrypted.data
        if atak_reassembler.seen_frame(ctx.channel_key, ng_key):
            return True
        try:
            await _store_position(ctx, _position(ctx, **await _mcl1_fields(report)))
        except Exception:
            atak_reassembler.forget_frame(ctx.channel_key, ng_key)
            raise
        return True
    if decrypted.data_type == DATA_TYPE_ATAK_RAW:
        _count(ctx, "raw")
        return True
    if decrypted.data_type == DATA_TYPE_ATAK_AX25:
        return await _handle_envelope_text(decrypted.data.decode("utf-8", errors="replace"), ctx)
    return False


async def handle_tracker_text(body: str, ctx: DatagramContext) -> bool:
    """Handle channel text that is a ``UVAX1|`` envelope (older plugin builds).

    True for every well-formed envelope, also when the joined frame is not
    ATAK data: a base64 chunk is never useful as a chat line.
    """
    if parse_envelope(body) is None:
        return False
    await _handle_envelope_text(body, ctx)
    return True
