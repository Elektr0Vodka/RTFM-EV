"""Companion bridge: a TCP server that speaks the MeshCore companion protocol.

A companion app (the MeshCore app, or any client of the companion protocol)
connects to RTFM-EV as if it were a WiFi companion radio. It sees the radio's
identity, the contacts and channels RTFM-EV knows, receives the messages
RTFM-EV receives, and can send direct and channel messages, which go out
through RTFM-EV's normal send path (so the radio has one owner).

Started from the lifespan only when ``MESHCORE_COMPANION_BRIDGE_ENABLED`` is set.
Unauthenticated, like the firmware's TCP interface: trusted networks only.
Every command that is not listed in ``_handle`` is answered with
ERR_CODE_UNSUPPORTED_CMD: an app cannot change radio settings, export keys,
reboot or reset the radio, or run CLI commands through the bridge.
"""

import asyncio
import contextlib
import logging
import os
import struct
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException

from app.companion_bridge import frames

logger = logging.getLogger(__name__)

PUBLIC_CHANNEL_KEY = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
# Firmware protocol version the bridge reports (companion v1.18 = 14). Message
# frames switch to the V3 layout when the app says it understands version 3+.
BRIDGE_FIRMWARE_VER_CODE = 14
MAX_BRIDGE_CHANNELS = 40
# Messages kept for an app until it fetches them, like the radio's own queue.
SESSION_QUEUE_SIZE = 256
# How long an ACK token is matched to a sent DM.
ACK_TOKEN_TTL_S = 3600.0


@dataclass(eq=False)
class _Session:
    writer: asyncio.StreamWriter
    address: str
    connected_at: float = field(default_factory=time.time)
    app_name: str = ""
    app_ver: int = 0
    queue: deque = field(default_factory=lambda: deque(maxlen=SESSION_QUEUE_SIZE))
    # channel key (upper hex) -> slot, and slot -> channel row, fixed per session
    slot_by_key: dict[str, int] = field(default_factory=dict)
    channel_by_slot: dict[int, object] = field(default_factory=dict)
    sending_contacts: bool = False
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class CompanionBridge:
    def __init__(self, max_clients: int = 4, max_contacts: int = 500) -> None:
        self._max_clients = max_clients
        self._max_contacts = max_contacts
        self._allow_send = True
        self._server: asyncio.Server | None = None
        self._sessions: set[_Session] = set()
        self._host: str | None = None
        self.port: int | None = None
        # message id -> (session, ack token, sent at)
        self._acks: dict[int, tuple[_Session, bytes, float]] = {}
        self._tasks: set[asyncio.Task] = set()

    # ── lifecycle ────────────────────────────────────────────────────────

    async def start(
        self, host: str, port: int, *, allow_send: bool = True, max_contacts: int = 500
    ) -> None:
        self._allow_send = allow_send
        self._max_contacts = max_contacts
        self._server = await asyncio.start_server(self._on_connect, host, port)
        self._host = host
        self.port = self._server.sockets[0].getsockname()[1]
        logger.warning(
            "Companion bridge listening on %s:%d (no authentication: trusted networks only%s)",
            host,
            self.port,
            "" if allow_send else ", sending off",
        )

    async def stop(self) -> None:
        for session in list(self._sessions):
            self._close(session)
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await self._server.wait_closed()
            self._server = None
        self._acks.clear()

    def status(self) -> dict:
        return {
            "enabled": self._server is not None,
            "host": self._host,
            "port": self.port,
            "allow_send": self._allow_send,
            "clients": [
                {
                    "address": s.address,
                    "app_name": s.app_name,
                    "connected_at": int(s.connected_at),
                }
                for s in self._sessions
            ],
        }

    # ── events from RTFM-EV ──────────────────────────────────────────────

    def on_event(self, event_type: str, data: dict) -> None:
        """Hand a realtime broadcast to the connected apps (no-op when not running)."""
        if self._server is None or not self._sessions:
            return
        if event_type == "message":
            for session in list(self._sessions):
                frame = self._message_frame(session, data)
                if frame is not None:
                    session.queue.append(frame)
                    self._spawn(self._write(session, frames.msg_waiting()))
        elif event_type == "message_acked":
            self._on_acked(data)

    def _on_acked(self, data: dict) -> None:
        message_id = data.get("message_id")
        entry = self._acks.pop(message_id, None) if isinstance(message_id, int) else None
        if entry is None:
            return
        session, token, sent_at = entry
        if session in self._sessions:
            rtt = round((time.monotonic() - sent_at) * 1000)
            self._spawn(self._write(session, frames.send_confirmed(token, rtt)))

    def _message_frame(self, session: _Session, data: dict) -> bytes | None:
        if data.get("outgoing"):
            return None
        text = str(data.get("text") or "")
        ts = data.get("sender_timestamp") or data.get("received_at") or int(time.time())
        paths = data.get("paths") or []
        last = paths[-1] if paths and isinstance(paths[-1], dict) else {}
        snr = last.get("snr") if isinstance(last.get("snr"), int | float) else None
        path_len = _path_len_byte(last)
        v3 = session.app_ver >= 3
        if data.get("type") == "PRIV":
            key = str(data.get("conversation_key") or "")
            if len(key) < 12:
                return None
            try:
                prefix = bytes.fromhex(key[:12])
            except ValueError:
                return None
            txt_type = int(data.get("txt_type") or 0)
            if txt_type not in (frames.TXT_TYPE_PLAIN, 2):
                return None
            return frames.contact_message(
                v3=v3,
                snr=snr,
                pubkey_prefix=prefix,
                path_len=path_len,
                txt_type=frames.TXT_TYPE_PLAIN,
                sender_timestamp=int(ts),
                text=text,
            )
        if data.get("type") == "CHAN":
            slot = session.slot_by_key.get(str(data.get("conversation_key") or "").upper())
            if slot is None:
                return None
            return frames.channel_message(
                v3=v3,
                snr=snr,
                channel_index=slot,
                path_len=path_len,
                sender_timestamp=int(ts),
                text=text,
            )
        return None

    # ── connections ──────────────────────────────────────────────────────

    async def _on_connect(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        peer = writer.get_extra_info("peername")
        address = f"{peer[0]}:{peer[1]}" if isinstance(peer, tuple) else str(peer)
        if len(self._sessions) >= self._max_clients:
            logger.warning("Companion bridge: refusing %s, client limit reached", address)
            writer.close()
            return
        session = _Session(writer=writer, address=address)
        self._sessions.add(session)
        logger.info("Companion bridge: %s connected", address)
        parser = frames.FrameReader()
        try:
            while True:
                data = await reader.read(1024)
                if not data:
                    break
                for frame in parser.feed(data):
                    try:
                        await self._handle(session, frame)
                    except Exception:
                        logger.warning(
                            "Companion bridge: command 0x%02X failed", frame[0], exc_info=True
                        )
                        await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            self._close(session)
            logger.info("Companion bridge: %s disconnected", address)

    def _close(self, session: _Session) -> None:
        self._sessions.discard(session)
        for message_id in [m for m, (s, _t, _a) in self._acks.items() if s is session]:
            self._acks.pop(message_id, None)
        with contextlib.suppress(Exception):
            session.writer.close()

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _write(self, session: _Session, payload: bytes) -> None:
        if session not in self._sessions:
            return
        async with session.write_lock:
            try:
                session.writer.write(frames.wrap(payload))
                await session.writer.drain()
            except (ConnectionError, RuntimeError):
                self._close(session)

    # ── commands ─────────────────────────────────────────────────────────

    async def _handle(self, session: _Session, frame: bytes) -> None:
        if not frame:
            return
        cmd = frame[0]
        if cmd == frames.CMD_DEVICE_QUERY and len(frame) >= 2:
            session.app_ver = frame[1]
            await self._load_channels(session)
            await self._write(session, self._device_info(session))
        elif cmd == frames.CMD_APP_START and len(frame) >= 8:
            session.app_name = frame[8:].decode("utf-8", "replace").strip("\0")[:40]
            if not session.channel_by_slot:
                await self._load_channels(session)
            info = self._self_info()
            if info is None:
                await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
            else:
                await self._write(session, frames.self_info(info))
        elif cmd == frames.CMD_GET_CONTACTS:
            since = struct.unpack_from("<I", frame, 1)[0] if len(frame) >= 5 else 0
            await self._send_contacts(session, since)
        elif cmd == frames.CMD_GET_CHANNEL and len(frame) >= 2:
            channel = session.channel_by_slot.get(frame[1])
            if channel is None:
                await self._write(session, frames.err(frames.ERR_CODE_NOT_FOUND))
            else:
                name = getattr(channel, "name", "")
                key = bytes.fromhex(getattr(channel, "key", ""))
                await self._write(session, frames.channel_info(frame[1], name, key))
        elif cmd == frames.CMD_SYNC_NEXT_MESSAGE:
            payload = session.queue.popleft() if session.queue else frames.no_more_messages()
            await self._write(session, payload)
        elif cmd == frames.CMD_GET_DEVICE_TIME:
            await self._write(session, frames.curr_time(int(time.time())))
        elif cmd == frames.CMD_SET_DEVICE_TIME:
            # RTFM-EV keeps the radio clock itself; accepted and ignored.
            await self._write(session, frames.ok())
        elif cmd == frames.CMD_GET_BATT_AND_STORAGE:
            await self._write(session, frames.batt_and_storage(self._battery_mv()))
        elif cmd == frames.CMD_SEND_TXT_MSG and len(frame) >= 14:
            await self._send_direct(session, frame)
        elif cmd == frames.CMD_SEND_CHANNEL_TXT_MSG and len(frame) >= 7:
            await self._send_channel(session, frame)
        else:
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))

    def _self_info(self) -> dict | None:
        from app.services.radio_runtime import radio_runtime as radio_manager

        mc = radio_manager.meshcore
        info = mc.self_info if mc is not None else None
        return dict(info) if info else None

    def _device_info(self, session: _Session) -> bytes:
        from app.services.radio_runtime import radio_runtime as radio_manager

        return frames.device_info(
            firmware_ver_code=BRIDGE_FIRMWARE_VER_CODE,
            max_contacts=self._max_contacts,
            max_channels=max(1, len(session.channel_by_slot)),
            build=str(getattr(radio_manager, "firmware_build", None) or ""),
            model=f"RTFM-EV bridge ({getattr(radio_manager, 'device_model', None) or 'radio'})",
            version=str(getattr(radio_manager, "firmware_version", None) or ""),
            repeat=False,
            path_hash_mode=int(getattr(radio_manager, "path_hash_mode", 0) or 0),
        )

    def _battery_mv(self) -> int:
        from app.services.radio_stats import get_latest_radio_stats

        value = get_latest_radio_stats().get("battery_mv")
        return int(value) if isinstance(value, int | float) else 0

    async def _load_channels(self, session: _Session) -> None:
        """Fix the channel slots for this session: Public, then favorites, then by name."""
        from app.repository import ChannelRepository

        channels = await ChannelRepository.get_all()
        channels.sort(
            key=lambda c: (
                c.key.upper() != PUBLIC_CHANNEL_KEY,
                not getattr(c, "favorite", False),
                (c.name or "").lower(),
            )
        )
        session.slot_by_key.clear()
        session.channel_by_slot.clear()
        for slot, channel in enumerate(channels[:MAX_BRIDGE_CHANNELS]):
            session.slot_by_key[channel.key.upper()] = slot
            session.channel_by_slot[slot] = channel

    async def _send_contacts(self, session: _Session, since: int) -> None:
        if session.sending_contacts:
            await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
            return
        from app.repository import ContactRepository

        session.sending_contacts = True
        try:
            contacts = [
                c for c in await ContactRepository.get_all(limit=100_000) if len(c.public_key) == 64
            ]
            contacts.sort(key=lambda c: (not getattr(c, "favorite", False), -(c.last_seen or 0)))
            contacts = contacts[: self._max_contacts]
            await self._write(session, frames.contacts_start(len(contacts)))
            newest = 0
            for c in contacts:
                lastmod = int(c.last_seen or c.last_advert or 0)
                if since and lastmod <= since:
                    continue
                newest = max(newest, lastmod)
                await self._write(
                    session,
                    frames.contact(
                        public_key=c.public_key,
                        name=c.name or "",
                        contact_type=int(c.type or 0),
                        flags=int(c.flags or 0),
                        path_hex=c.direct_path,
                        path_hops=c.direct_path_len,
                        path_hash_mode=c.direct_path_hash_mode,
                        last_advert=int(c.last_advert or 0),
                        lat=c.lat,
                        lon=c.lon,
                        lastmod=lastmod,
                    ),
                )
            await self._write(session, frames.end_of_contacts(newest))
        finally:
            session.sending_contacts = False

    async def _send_direct(self, session: _Session, frame: bytes) -> None:
        if not self._allow_send:
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
            return
        txt_type = frame[1]
        prefix = frame[7:13].hex()
        text = frame[13:].decode("utf-8", "replace").rstrip("\0")
        if txt_type != frames.TXT_TYPE_PLAIN:
            # CLI commands to other nodes are not passed on.
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
            return
        from app.event_handlers import track_pending_ack
        from app.repository import ContactRepository, MessageRepository
        from app.services.message_send import send_direct_message_to_contact
        from app.services.radio_runtime import radio_runtime as radio_manager
        from app.websocket import broadcast_error, broadcast_event

        contact = await ContactRepository.get_by_key_prefix(prefix)
        if contact is None or len(contact.public_key) < 64:
            await self._write(session, frames.err(frames.ERR_CODE_NOT_FOUND))
            return
        if not radio_manager.is_connected:
            await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
            return
        try:
            message = await send_direct_message_to_contact(
                contact=contact,
                text=text,
                radio_manager=radio_manager,
                broadcast_fn=broadcast_event,
                track_pending_ack_fn=track_pending_ack,
                now_fn=time.time,
                error_broadcast_fn=broadcast_error,
                message_repository=MessageRepository,
                contact_repository=ContactRepository,
            )
        except HTTPException as exc:
            await self._write(session, frames.err(_error_code(exc)))
            return
        token = os.urandom(4)
        self._acks[message.id] = (session, token, time.monotonic())
        self._prune_acks()
        flood = contact.direct_path_len is None or contact.direct_path_len < 0
        await self._write(session, frames.sent(flood=flood, ack=token, est_timeout_ms=10_000))
        if message.acked:
            self._on_acked({"message_id": message.id})

    async def _send_channel(self, session: _Session, frame: bytes) -> None:
        if not self._allow_send:
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
            return
        txt_type, slot = frame[1], frame[2]
        text = frame[7:].decode("utf-8", "replace").rstrip("\0")
        if txt_type != frames.TXT_TYPE_PLAIN:
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
            return
        channel = session.channel_by_slot.get(slot)
        if channel is None:
            await self._write(session, frames.err(frames.ERR_CODE_NOT_FOUND))
            return
        from app.repository import MessageRepository
        from app.services.message_send import send_channel_message_to_channel
        from app.services.radio_runtime import radio_runtime as radio_manager
        from app.websocket import broadcast_error, broadcast_event

        if not radio_manager.is_connected:
            await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
            return
        key = str(getattr(channel, "key", ""))
        try:
            await send_channel_message_to_channel(
                channel=channel,
                channel_key_upper=key.upper(),
                key_bytes=bytes.fromhex(key),
                text=text,
                radio_manager=radio_manager,
                broadcast_fn=broadcast_event,
                error_broadcast_fn=broadcast_error,
                now_fn=time.time,
                temp_radio_slot=0,
                message_repository=MessageRepository,
            )
        except HTTPException as exc:
            await self._write(session, frames.err(_error_code(exc)))
            return
        await self._write(session, frames.ok())

    def _prune_acks(self) -> None:
        cutoff = time.monotonic() - ACK_TOKEN_TTL_S
        for message_id in [m for m, (_s, _t, at) in self._acks.items() if at < cutoff]:
            self._acks.pop(message_id, None)


def _path_len_byte(path: dict) -> int:
    """Path length byte for a received message: 0xFF when it came direct or unknown."""
    hops = path.get("path_len")
    if not isinstance(hops, int):
        return frames.PATH_LEN_NONE
    hex_path = str(path.get("path") or "")
    width = len(hex_path) // 2 // hops if hops > 0 and hex_path else 1
    return frames.encode_path_len(hops, max(0, min(2, width - 1)))


def _error_code(exc: HTTPException) -> int:
    if exc.status_code == 422:
        return frames.ERR_CODE_ILLEGAL_ARG
    if exc.status_code == 404:
        return frames.ERR_CODE_NOT_FOUND
    return frames.ERR_CODE_TABLE_FULL


companion_bridge = CompanionBridge()
