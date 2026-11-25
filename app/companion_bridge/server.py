"""Companion bridge: a TCP server that speaks the MeshCore companion protocol.

A companion app (the MeshCore app, or any client of the companion protocol)
connects to RTFM-EV as if it were a WiFi companion radio. It sees the radio's
identity, the contacts and channels RTFM-EV knows, receives the messages
RTFM-EV receives, and can send direct and channel messages, which go out
through RTFM-EV's normal send path (so the radio has one owner).

All other companion commands (issue #388) are carried out by RTFM-EV itself,
see ``commands.py``. The radio's pushes (adverts, path updates, login results,
status, telemetry and binary responses, trace data, RX log, ...) are copied to
every connected app as the radio wrote them (``on_radio_frame``).

Started from the lifespan only when ``MESHCORE_COMPANION_BRIDGE_ENABLED`` is set.
Unauthenticated, like the firmware's TCP interface: trusted networks only.
With ``allow_send`` off, every command that changes or transmits anything is
answered with ERR_CODE_UNSUPPORTED_CMD.
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

from app.companion_bridge import commands, frames

logger = logging.getLogger(__name__)

PUBLIC_CHANNEL_KEY = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
# Protocol version reported while the radio's own is not known (companion
# v1.18 = 14). Otherwise DEVICE_INFO carries the radio's real version code.
# Message frames switch to the V3 layout when the app understands version 3+.
BRIDGE_FIRMWARE_VER_CODE = 14
MAX_BRIDGE_CHANNELS = 40
# Messages kept for an app until it fetches them, like the radio's own queue.
SESSION_QUEUE_SIZE = 256
# How long an ACK token is matched to a sent DM.
ACK_TOKEN_TTL_S = 3600.0
# How long the radio gets to answer one command.
REPLY_TIMEOUT_S = 10.0
# The firmware keeps one pending request (``clearPendingReqs``): after an app's
# login, status, telemetry, binary or path request the radio lock is kept until
# the answer push arrives, so RTFM-EV's own requests cannot wipe it.
PUSH_WAIT_MIN_S = 5.0
PUSH_WAIT_MAX_S = 60.0
# Radio pushes copied to every app. Not copied: SEND_CONFIRMED and MSG_WAITING
# (the bridge makes its own for its message queue), and CONTACT_DELETED /
# CONTACTS_FULL, which describe the radio's contact cache, not RTFM-EV's
# contact list the apps see (CONTACT_DELETED is sent when RTFM-EV deletes one).
FORWARDED_PUSHES = frozenset(
    {
        frames.PUSH_CODE_ADVERT,
        frames.PUSH_CODE_PATH_UPDATED,
        frames.PUSH_CODE_RAW_DATA,
        frames.PUSH_CODE_LOGIN_SUCCESS,
        frames.PUSH_CODE_LOGIN_FAIL,
        frames.PUSH_CODE_STATUS_RESPONSE,
        frames.PUSH_CODE_LOG_RX_DATA,
        frames.PUSH_CODE_TRACE_DATA,
        frames.PUSH_CODE_NEW_ADVERT,
        frames.PUSH_CODE_TELEMETRY_RESPONSE,
        frames.PUSH_CODE_BINARY_RESPONSE,
        frames.PUSH_CODE_PATH_DISCOVERY_RESPONSE,
        frames.PUSH_CODE_CONTROL_DATA,
    }
)
HOOK_ATTR = "_rtfm_companion_bridge_hooked"


class _Waiter:
    """The first radio frame whose code is in ``codes``."""

    def __init__(self, codes: set[int]) -> None:
        self.codes = codes
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()

    def offer(self, data: bytes) -> None:
        if data[0] in self.codes and not self.future.done():
            self.future.set_result(data)


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
    # CMD_SET_FLOOD_SCOPE_KEY frame for this app's own requests (None = RTFM-EV's)
    scope_frame: bytes | None = None
    # data collected by CMD_SIGN_DATA until CMD_SIGN_FINISH
    sign_buf: bytearray | None = None


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
        # The reply an app's command waits for, and the push a request waits for.
        self._capture: _Waiter | None = None
        self._push_waiter: _Waiter | None = None

    @property
    def allow_send(self) -> bool:
        return self._allow_send

    @property
    def max_channels(self) -> int:
        return MAX_BRIDGE_CHANNELS

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
        elif event_type == "contact_deleted":
            key = str(data.get("public_key") or "")
            if len(key) == 64:
                for session in list(self._sessions):
                    self._spawn(self._write(session, frames.contact_deleted(key)))

    # ── frames from the radio ────────────────────────────────────────────

    def attach_radio(self, mc) -> None:
        """Let the bridge see every frame the radio sends to RTFM-EV (once per connection)."""
        reader = getattr(mc, "_reader", None)
        if reader is None or getattr(reader, HOOK_ATTR, False):
            return
        original = reader.handle_rx

        async def hooked(data):
            try:
                self.on_radio_frame(bytes(data))
            except Exception:  # noqa: BLE001 - the bridge must never break the reader
                logger.debug("Companion bridge: radio frame not handled", exc_info=True)
            return await original(data)

        reader.handle_rx = hooked
        setattr(reader, HOOK_ATTR, True)

    def on_radio_frame(self, data: bytes) -> None:
        """A frame from the radio: an app command's reply, a push to copy, or neither."""
        if not data or self._server is None:
            return
        if self._capture is not None:
            self._capture.offer(data)
        if data[0] < 0x80:
            return
        if self._push_waiter is not None:
            self._push_waiter.offer(data)
        if data[0] in FORWARDED_PUSHES:
            for session in list(self._sessions):
                self._spawn(self._write(session, data))

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

    async def write(self, session: _Session, payload: bytes) -> None:
        await self._write(session, payload)

    def queue_message(self, session: _Session, payload: bytes) -> None:
        session.queue.append(payload)
        self._spawn(self._write(session, frames.msg_waiting()))

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
            if channel is None and frame[1] < MAX_BRIDGE_CHANNELS:
                # A free slot, like the firmware: blank name and secret.
                await self._write(session, frames.channel_info(frame[1], "", b""))
            elif channel is None:
                await self._write(session, frames.err(frames.ERR_CODE_NOT_FOUND))
            else:
                name = getattr(channel, "name", "")
                key = bytes.fromhex(getattr(channel, "key", ""))
                await self._write(session, frames.channel_info(frame[1], name, key))
        elif cmd == frames.CMD_SYNC_NEXT_MESSAGE:
            payload = session.queue.popleft() if session.queue else frames.no_more_messages()
            await self._write(session, payload)
        elif cmd == frames.CMD_GET_DEVICE_TIME:
            if self._radio_connected():
                await self.radio_call(session, "get_time", frame[:1], {frames.RESP_CODE_CURR_TIME})
            else:
                await self._write(session, frames.curr_time(int(time.time())))
        elif cmd == frames.CMD_SET_DEVICE_TIME:
            # RTFM-EV keeps the radio clock itself; accepted and ignored.
            await self._write(session, frames.ok())
        elif cmd == frames.CMD_GET_BATT_AND_STORAGE:
            if self._radio_connected():
                await self.radio_call(
                    session, "battery", frame[:1], {frames.RESP_CODE_BATT_AND_STORAGE}
                )
            else:
                await self._write(session, frames.batt_and_storage(self._battery_mv()))
        elif cmd == frames.CMD_SEND_TXT_MSG and len(frame) >= 14:
            await self._send_direct(session, frame)
        elif cmd == frames.CMD_SEND_CHANNEL_TXT_MSG and len(frame) >= 7:
            await self._send_channel(session, frame)
        elif not await commands.handle(self, session, frame):
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))

    def self_info(self) -> dict | None:
        return self._self_info()

    def _self_info(self) -> dict | None:
        from app.services.radio_runtime import radio_runtime as radio_manager

        mc = radio_manager.meshcore
        info = mc.self_info if mc is not None else None
        return dict(info) if info else None

    def _device_info(self, session: _Session) -> bytes:
        from app.services.radio_runtime import radio_runtime as radio_manager

        ver_code = getattr(radio_manager, "firmware_ver_code", None)
        return frames.device_info(
            firmware_ver_code=ver_code if isinstance(ver_code, int) else BRIDGE_FIRMWARE_VER_CODE,
            max_contacts=self._max_contacts,
            max_channels=MAX_BRIDGE_CHANNELS,
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
                await self._write(session, self.contact_frame(c))
            await self._write(session, frames.end_of_contacts(newest))
        finally:
            session.sending_contacts = False

    @staticmethod
    def contact_frame(c) -> bytes:
        return frames.contact(
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
            lastmod=int(c.last_seen or c.last_advert or 0),
        )

    def set_slot(self, session: _Session, slot: int, channel) -> None:
        self.clear_slot(session, slot)
        key = str(getattr(channel, "key", "")).upper()
        old_slot = session.slot_by_key.pop(key, None)
        if old_slot is not None:
            session.channel_by_slot.pop(old_slot, None)
        session.slot_by_key[key] = slot
        session.channel_by_slot[slot] = channel

    def clear_slot(self, session: _Session, slot: int) -> None:
        channel = session.channel_by_slot.pop(slot, None)
        if channel is not None:
            session.slot_by_key.pop(str(getattr(channel, "key", "")).upper(), None)

    # ── carrying out commands on the radio ───────────────────────────────

    @staticmethod
    def _radio_connected() -> bool:
        from app.services.radio_runtime import radio_runtime as radio_manager

        return bool(radio_manager.is_connected)

    @contextlib.asynccontextmanager
    async def radio_session(self, name: str, *, pause_polling: bool = False):
        """RTFM-EV's radio lock, held for one app command."""
        from app.services.radio_runtime import radio_runtime as radio_manager

        async with radio_manager.radio_operation(
            f"companion_bridge_{name}",
            pause_polling=pause_polling,
            suspend_auto_fetch=True,
        ) as mc:
            self.attach_radio(mc)
            yield mc

    async def exchange(self, mc, frame: bytes, expect: set[int]) -> bytes | None:
        """Send one command frame to the radio and return its reply frame (None on timeout).

        Call with the radio lock held. ERR and DISABLED replies are returned too.
        """
        waiter = _Waiter(set(expect) | {frames.RESP_CODE_ERR, frames.RESP_CODE_DISABLED})
        self._capture = waiter
        try:
            await mc.commands.send(frame)
            return await asyncio.wait_for(waiter.future, REPLY_TIMEOUT_S)
        except TimeoutError:
            logger.warning("Companion bridge: no reply from the radio to 0x%02X", frame[0])
            return None
        finally:
            if self._capture is waiter:
                self._capture = None

    @staticmethod
    def push_wait_seconds(sent_reply: bytes) -> float:
        """How long to wait for the answer to a request, from RESP_CODE_SENT's timeout."""
        est_ms = struct.unpack_from("<I", sent_reply, 6)[0] if len(sent_reply) >= 10 else 0
        return max(PUSH_WAIT_MIN_S, min(PUSH_WAIT_MAX_S, est_ms / 1000.0 + 3.0))

    async def apply_session_scope(self, mc, session: _Session) -> bool:
        """Put the app's own flood scope on the radio; True when it must be put back."""
        if session.scope_frame is None:
            return False
        await self.exchange(mc, session.scope_frame, {frames.RESP_CODE_OK})
        return True

    async def restore_scope(self, mc) -> None:
        """Put RTFM-EV's standing flood scope back (as radio_lifecycle applies it)."""
        from app.region_scope import normalize_region_scope
        from app.repository import AppSettingsRepository
        from app.services.flood_scope import set_radio_flood_scope
        from app.services.radio_runtime import radio_runtime as radio_manager
        from app.services.temp_radio import temp_radio

        try:
            app_settings = await AppSettingsRepository.get()
            scope = temp_radio.effective_flood_scope(
                normalize_region_scope(app_settings.flood_scope)
            )
            await set_radio_flood_scope(
                mc, scope, fw_ver=getattr(radio_manager, "firmware_ver_code", None)
            )
        except Exception:
            logger.warning("Companion bridge: could not restore the flood scope", exc_info=True)

    async def radio_call(
        self,
        session: _Session,
        name: str,
        frame: bytes,
        expect: set[int],
        *,
        hold: set[int] | None = None,
        scoped: bool = False,
        contact=None,
        write: bool = True,
    ) -> bytes | None:
        """Carry out one command on the radio for an app and hand it the radio's reply.

        ``contact`` is loaded onto the radio first (RTFM-EV keeps its contacts in
        its database and loads them on demand). ``hold``: push codes that answer
        the request; the lock is kept until one arrives. ``scoped``: the app's own
        flood scope applies to this command.
        """
        from app.routers.contacts import _ensure_on_radio

        if not self._radio_connected():
            if write:
                await self._write(session, frames.err(frames.ERR_CODE_BAD_STATE))
            return None
        async with self.radio_session(name, pause_polling=hold is not None) as mc:
            if contact is not None:
                await _ensure_on_radio(mc, contact)
            restore = await self.apply_session_scope(mc, session) if scoped else False
            waiter = _Waiter(hold) if hold else None
            self._push_waiter = waiter
            try:
                try:
                    reply = await self.exchange(mc, frame, expect)
                finally:
                    # The scope only shapes the packet just sent: put RTFM-EV's back now.
                    if restore:
                        await self.restore_scope(mc)
                if write:
                    await self._write(session, reply or frames.err(frames.ERR_CODE_BAD_STATE))
                if waiter is not None and reply is not None and reply[0] == frames.RESP_CODE_SENT:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(waiter.future, self.push_wait_seconds(reply))
                return reply
            finally:
                if self._push_waiter is waiter:
                    self._push_waiter = None

    async def _send_direct(self, session: _Session, frame: bytes) -> None:
        if not self._allow_send:
            await self._write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
            return
        txt_type = frame[1]
        prefix = frame[7:13].hex()
        text = frame[13:].decode("utf-8", "replace").rstrip("\0")
        if txt_type == frames.TXT_TYPE_CLI_DATA:
            try:
                await commands.remote_cli(self, session, frame)
            except HTTPException as exc:
                await self._write(session, frames.err(commands.error_code(exc)))
            return
        if txt_type != frames.TXT_TYPE_PLAIN:
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
