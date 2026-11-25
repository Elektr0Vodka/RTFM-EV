"""Companion bridge: the extended commands and forwarded pushes (issue #388).

Each test sends a client frame over TCP, checks what RTFM-EV did with it (the
frame it sent to the radio, or the RTFM-EV function it called) and the frame
the client got back. The radio is a fake: it records every frame RTFM-EV sends
and answers through the bridge's radio hook (``on_radio_frame``), the way the
real reader hook does.
"""

import asyncio
import contextlib
import struct
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.companion_bridge import commands, frames
from app.companion_bridge.server import (
    FORWARDED_PUSHES,
    MAX_BRIDGE_CHANNELS,
    PUBLIC_CHANNEL_KEY,
    CompanionBridge,
)
from app.repository import ChannelRepository, ContactRepository

RADIO_KEY = "11" * 32
ALICE_KEY = "a1" * 32
BOB_KEY = "b2" * 32
OPS_KEY = "0F" * 16
ALICE = bytes.fromhex(ALICE_KEY)

SELF_INFO = {
    "adv_type": 1,
    "public_key": RADIO_KEY,
    "name": "Base Node",
    "manual_add_contacts": False,
}


def sent_reply(tag: bytes = b"\x01\x02\x03\x04", est_ms: int = 200) -> bytes:
    return bytes([frames.RESP_CODE_SENT, 1]) + tag + struct.pack("<I", est_ms)


class FakeRadio:
    """Records what RTFM-EV sends; answers with ``replies[code]`` (a list of frames)."""

    def __init__(self) -> None:
        self.bridge: CompanionBridge | None = None
        self.sent: list[bytes] = []
        self.replies: dict[int, list[bytes]] = {}
        self.push_after: dict[int, list[bytes]] = {}
        self.events: list[str] = []
        self.is_connected = True
        self.firmware_ver_code: int | None = 10
        self.firmware_build = "20 Oct 2026"
        self.device_model = "Heltec V3"
        self.firmware_version = "v1.17.0"
        self.path_hash_mode = 0
        self.client_repeat = False
        self.meshcore = MagicMock()
        self.meshcore.self_info = SELF_INFO
        self.meshcore.commands.send = AsyncMock(side_effect=self._send)
        self.meshcore.commands.add_contact = AsyncMock(return_value=MagicMock(type=EventType.OK))
        self.meshcore.commands.set_manual_add_contacts = AsyncMock(
            return_value=MagicMock(type=EventType.OK)
        )
        self.meshcore.get_contact_by_key_prefix = MagicMock(return_value=None)

    async def _send(self, frame, *args, **kwargs):
        frame = bytes(frame)
        self.sent.append(frame)
        self.events.append(f"send {frame[0]}")
        loop = asyncio.get_running_loop()
        for reply in self.replies.get(frame[0], []):
            loop.call_soon(self.bridge.on_radio_frame, reply)
        for push in self.push_after.get(frame[0], []):
            loop.call_later(0.05, self._push, push)
        return MagicMock(type=EventType.OK)

    def _push(self, push: bytes) -> None:
        self.events.append(f"push {push[0]}")
        self.bridge.on_radio_frame(push)

    @contextlib.asynccontextmanager
    async def radio_operation(self, name, **kwargs):
        self.events.append(f"lock {name}")
        try:
            yield self.meshcore
        finally:
            self.events.append("unlock")

    def require_connected(self):
        return self.meshcore


class Client:
    def __init__(self, reader, writer) -> None:
        self.reader = reader
        self.writer = writer

    async def send(self, body: bytes) -> None:
        self.writer.write(b"<" + struct.pack("<H", len(body)) + body)
        await self.writer.drain()

    async def read(self, timeout: float = 5.0) -> bytes:
        head = await asyncio.wait_for(self.reader.readexactly(3), timeout)
        assert head[0] == frames.RADIO_TO_APP
        (length,) = struct.unpack_from("<H", head, 1)
        return await asyncio.wait_for(self.reader.readexactly(length), timeout)

    async def call(self, body: bytes) -> bytes:
        await self.send(body)
        return await self.read()

    async def nothing(self, wait: float = 0.3) -> bool:
        try:
            await asyncio.wait_for(self.reader.readexactly(1), wait)
        except TimeoutError:
            return True
        return False


@contextlib.asynccontextmanager
async def running(radio: FakeRadio, *, allow_send: bool = True):
    server = CompanionBridge()
    radio.bridge = server
    with (
        patch("app.services.radio_runtime.radio_runtime", radio),
        patch("app.routers.contacts.radio_manager", radio),
        patch("app.routers.radio.radio_manager", radio),
    ):
        await server.start("127.0.0.1", 0, allow_send=allow_send)
        clients: list[Client] = []

        async def connect() -> Client:
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
            client = Client(reader, writer)
            clients.append(client)
            # Fix this session's channel slots, as an app does on connect.
            assert (await client.call(b"\x16\x03"))[0] == frames.RESP_CODE_DEVICE_INFO
            return client

        try:
            yield server, connect
        finally:
            for client in clients:
                client.writer.close()
            await server.stop()


@pytest.fixture
async def db(test_db):
    await ContactRepository.upsert(
        {
            "public_key": ALICE_KEY,
            "name": "Alice",
            "type": 2,
            "flags": 0,
            "direct_path": "aabb",
            "direct_path_len": 2,
            "direct_path_hash_mode": 0,
            "last_advert": 1_700_000_000,
            "last_seen": 1_700_000_100,
        }
    )
    await ChannelRepository.upsert(key=PUBLIC_CHANNEL_KEY, name="Public")
    await ChannelRepository.upsert(key=OPS_KEY, name="Ops")
    return test_db


# ── commands only the radio answers ─────────────────────────────────────────

RELAYED = [
    # (name, client frame, frame RTFM-EV sends to the radio, radio reply)
    ("has_connection", b"\x1c" + ALICE, b"\x1c" + ALICE, b"\x00"),
    ("get_custom_vars", b"\x28", b"\x28", b"\x15gps:1"),
    (
        "get_advert_path",
        b"\x2a\x00" + ALICE,
        b"\x2a\x00" + ALICE,
        b"\x16" + struct.pack("<I", 5) + b"\x01\xaa",
    ),
    ("get_tuning", b"\x2b", b"\x2b", b"\x17" + struct.pack("<II", 500, 1000)),
    ("get_stats", b"\x38\x01", b"\x38\x01", b"\x18\x01" + b"\x9c\xff\xb0\x10" + b"\x00" * 8),
    ("get_autoadd", b"\x3b", b"\x3b", b"\x19\x01\x03"),
    ("get_repeat_freq", b"\x3c", b"\x3c", b"\x1a" + struct.pack("<II", 433000, 434000)),
    ("get_default_scope", b"\x40", b"\x40", b"\x1c"),
    ("export_self", b"\x11", b"\x11", b"\x0b" + b"\x11" * 100),
    ("battery", b"\x14", b"\x14", b"\x0c" + struct.pack("<HII", 4012, 10, 100)),
    ("device_time", b"\x05", b"\x05", b"\x09" + struct.pack("<I", 1_800_000_000)),
    ("logout", b"\x1d" + ALICE, b"\x1d" + ALICE, b"\x00"),
    (
        "trace",
        b"\x24" + b"\x01\x00\x00\x00" + b"\x00" * 4 + b"\x00" + b"\xaa\xbb",
        b"\x24" + b"\x01\x00\x00\x00" + b"\x00" * 4 + b"\x00" + b"\xaa\xbb",
        sent_reply(),
    ),
    ("control_data", b"\x37\x80\x01\x02", b"\x37\x80\x01\x02", b"\x00"),
    (
        "raw_data",
        b"\x19\x01\xaa" + b"\x01\x02\x03\x04",
        b"\x19\x01\xaa" + b"\x01\x02\x03\x04",
        b"\x00",
    ),
    ("raw_packet", b"\x41\x00\x12\x00\x01\x02", b"\x41\x00\x12\x00\x01\x02", b"\x00"),
    ("set_tuning", b"\x15" + struct.pack("<II", 1, 2), b"\x15" + struct.pack("<II", 1, 2), b"\x00"),
    ("set_custom_var", b"\x29gps:1", b"\x29gps:1", b"\x00"),
    ("set_default_scope", b"\x3f", b"\x3f", b"\x00"),
    ("factory_reset", b"\x33reset", b"\x33reset", b"\x00"),
    ("radio_error_passed_on", b"\x2b", b"\x2b", b"\x01\x02"),
    ("radio_disabled_passed_on", b"\x28", b"\x28", b"\x0f"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,client_frame,radio_frame,reply", RELAYED, ids=[r[0] for r in RELAYED]
)
async def test_relayed_command(db, name, client_frame, radio_frame, reply):
    radio = FakeRadio()
    radio.replies[radio_frame[0]] = [reply]
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(client_frame) == reply
    assert radio.sent == [radio_frame]
    # Carried out under RTFM-EV's radio lock.
    assert radio.events[0].startswith("lock companion_bridge_")
    assert radio.events[-1] == "unlock"


@pytest.mark.asyncio
async def test_no_reply_from_the_radio_is_bad_state(db):
    radio = FakeRadio()
    with patch("app.companion_bridge.server.REPLY_TIMEOUT_S", 0.1):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x2b") == frames.err(frames.ERR_CODE_BAD_STATE)


@pytest.mark.asyncio
async def test_radio_not_connected_is_bad_state(db):
    radio = FakeRadio()
    async with running(radio) as (_server, connect):
        client = await connect()
        radio.is_connected = False
        assert await client.call(b"\x2b") == frames.err(frames.ERR_CODE_BAD_STATE)
    assert radio.sent == []


@pytest.mark.asyncio
async def test_contact_is_loaded_onto_the_radio_first(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_EXPORT_CONTACT] = [b"\x0b" + b"\x22" * 100]
    radio.replies[frames.CMD_SHARE_CONTACT] = [b"\x00"]
    async with running(radio) as (_server, connect):
        client = await connect()
        assert (await client.call(b"\x11" + ALICE))[0] == frames.RESP_CODE_EXPORT_CONTACT
        assert await client.call(b"\x10" + ALICE) == b"\x00"
        # A contact RTFM-EV does not know is not sent to the radio.
        assert await client.call(b"\x10" + bytes.fromhex(BOB_KEY)) == frames.err(
            frames.ERR_CODE_NOT_FOUND
        )
    loaded = [c.args[0]["public_key"] for c in radio.meshcore.commands.add_contact.await_args_list]
    assert loaded == [ALICE_KEY, ALICE_KEY]
    assert radio.sent == [b"\x11" + ALICE, b"\x10" + ALICE]


# ── requests to other nodes: the answer is a push ───────────────────────────

REQUESTS = [
    # (name, client frame, answer push)
    ("login", b"\x1a" + ALICE + b"secret", bytes([0x85, 0x00]) + ALICE[:6]),
    ("login_fail", b"\x1a" + ALICE + b"wrong", bytes([0x86, 0x00]) + ALICE[:6]),
    ("status", b"\x1b" + ALICE, bytes([0x87, 0x00]) + ALICE[:6] + b"\x00" * 52),
    ("telemetry", b"\x27\x00\x00\x00" + ALICE, bytes([0x8B, 0x00]) + ALICE[:6] + b"\x01\x74"),
    ("binary", b"\x32" + ALICE + b"\x06", bytes([0x8C, 0x00]) + b"\x01\x02\x03\x04" + b"\x05"),
    ("anon", b"\x39" + ALICE + b"\x07", bytes([0x8C, 0x00]) + b"\x01\x02\x03\x04"),
    (
        "path_discovery",
        b"\x34\x00" + ALICE,
        bytes([0x8D, 0x00]) + ALICE[:6] + b"\x00\x00",
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("name,client_frame,push", REQUESTS, ids=[r[0] for r in REQUESTS])
async def test_request_answers_sent_then_push_and_keeps_the_lock(db, name, client_frame, push):
    radio = FakeRadio()
    radio.replies[client_frame[0]] = [sent_reply()]
    radio.push_after[client_frame[0]] = [push]
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(client_frame) == sent_reply()
        assert await client.read() == push
    assert radio.sent == [client_frame]
    assert radio.meshcore.commands.add_contact.await_count == 1
    # The firmware keeps one pending request: RTFM-EV holds the lock until the answer.
    assert radio.events.index(f"push {push[0]}") < radio.events.index("unlock")


@pytest.mark.asyncio
async def test_unknown_contact_request_is_not_found(db):
    radio = FakeRadio()
    async with running(radio) as (_server, connect):
        client = await connect()
        reply = await client.call(b"\x1b" + bytes.fromhex(BOB_KEY))
    assert reply == frames.err(frames.ERR_CODE_NOT_FOUND)
    assert radio.sent == []


@pytest.mark.asyncio
async def test_own_telemetry_reaches_the_app_once(db):
    radio = FakeRadio()
    own = bytes([0x8B, 0x00]) + bytes.fromhex(RADIO_KEY)[:6] + b"\x01\x74\x01\x90"
    radio.replies[frames.CMD_SEND_TELEMETRY_REQ] = [own]
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(b"\x27\x00\x00\x00") == own
        assert await client.nothing()
    assert radio.sent == [b"\x27\x00\x00\x00"]


@pytest.mark.asyncio
async def test_app_flood_scope_applies_to_its_requests_only(db):
    radio = FakeRadio()
    scope_key = bytes(range(16))
    radio.replies[frames.CMD_SET_FLOOD_SCOPE_KEY] = [b"\x00"]
    radio.replies[frames.CMD_SEND_STATUS_REQ] = [sent_reply()]
    radio.push_after[frames.CMD_SEND_STATUS_REQ] = [bytes([0x87, 0]) + ALICE[:6]]
    restore = AsyncMock()
    with patch("app.services.flood_scope.set_radio_flood_scope", restore):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x36\x00" + scope_key) == b"\x00"
            assert radio.sent == []  # kept for this app, the radio is not touched yet
            assert await client.call(b"\x1b" + ALICE) == sent_reply()
            await client.read()
    assert radio.sent == [b"\x36\x00" + scope_key, b"\x1b" + ALICE]
    restore.assert_awaited_once()  # RTFM-EV's own scope is put back


@pytest.mark.asyncio
async def test_remote_cli_reply_is_queued_as_cli_data(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_SEND_TXT_MSG] = [sent_reply()]
    event = SimpleNamespace(
        type=EventType.CONTACT_MSG_RECV,
        payload={"text": "v1.17.0", "sender_timestamp": 1_800_000_000, "path_len": 2},
    )
    fetch = AsyncMock(return_value=event)
    frame = b"\x02\x01\x00" + struct.pack("<I", 1) + ALICE[:6] + b"ver"
    with patch("app.routers.server_control.fetch_contact_cli_response", fetch):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(frame) == sent_reply()
            assert await client.read() == bytes([frames.PUSH_CODE_MSG_WAITING])
            msg = await client.call(bytes([frames.CMD_SYNC_NEXT_MESSAGE]))
    assert radio.sent == [frame]
    assert fetch.await_args.args[1] == ALICE_KEY[:12]
    assert msg[0] == frames.RESP_CODE_CONTACT_MSG_RECV_V3
    assert msg[4:10] == ALICE[:6]
    assert msg[11] == frames.TXT_TYPE_CLI_DATA
    assert msg[16:] == b"v1.17.0"


# ── signing and keys ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_signing_runs_on_the_radio_in_one_go(db):
    radio = FakeRadio()
    signature = b"\x14" + b"\x5a" * 64
    radio.replies[frames.CMD_SIGN_START] = [b"\x13\x00" + struct.pack("<I", 8192)]
    radio.replies[frames.CMD_SIGN_DATA] = [b"\x00"]
    radio.replies[frames.CMD_SIGN_FINISH] = [signature]
    data = bytes(range(200)) + bytes(range(100))
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(b"\x21") == frames.sign_start()
        assert await client.call(b"\x22" + data[:150]) == b"\x00"
        assert await client.call(b"\x22" + data[150:]) == b"\x00"
        assert radio.sent == []  # collected by the bridge until FINISH
        assert await client.call(b"\x23") == signature
        assert await client.call(b"\x23") == frames.err(frames.ERR_CODE_BAD_STATE)
    assert radio.sent[0] == b"\x21"
    assert b"".join(f[1:] for f in radio.sent[1:-1]) == data
    assert radio.sent[-1] == b"\x23"
    assert radio.events.count("unlock") == 1


@pytest.mark.asyncio
async def test_private_key_export_follows_the_local_export_switch(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_EXPORT_PRIVATE_KEY] = [b"\x0e" + b"\x33" * 64]
    async with running(radio) as (_server, connect):
        client = await connect()
        with patch("app.config.settings.enable_local_private_key_export", False):
            assert await client.call(b"\x17") == frames.disabled()
        assert radio.sent == []
        with patch("app.config.settings.enable_local_private_key_export", True):
            assert await client.call(b"\x17") == b"\x0e" + b"\x33" * 64
    assert radio.sent == [b"\x17"]


@pytest.mark.asyncio
async def test_private_key_import_goes_through_rtfm_ev(db):
    radio = FakeRadio()
    set_key = AsyncMock(return_value={"status": "ok"})
    key = bytes(range(64))
    with patch("app.routers.radio.set_private_key", set_key):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x18" + key) == b"\x00"
    assert set_key.await_args.args[0].private_key == key.hex()


# ── own settings: through RTFM-EV's radio config ────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "frame,expected",
    [
        (b"\x08New Name", {"name": "New Name"}),
        (b"\x0e" + struct.pack("<ii", 52_100_000, 5_200_000), {"lat": 52.1, "lon": 5.2}),
        (b"\x0c\xfe", {"tx_power": -2}),
        (b"\x3d\x00\x01", {"path_hash_mode": 1}),
        (
            b"\x26\x00" + bytes([0b100110]) + b"\x01\x01",
            {
                "telemetry_mode_base": 2,
                "telemetry_mode_loc": 1,
                "telemetry_mode_env": 2,
                "advert_location_source": "current",
                "multi_acks_enabled": True,
            },
        ),
    ],
    ids=["name", "latlon", "tx_power", "path_hash_mode", "other_params"],
)
async def test_own_settings_use_rtfm_ev_radio_config(db, frame, expected):
    radio = FakeRadio()
    update = AsyncMock()
    with patch("app.routers.radio.update_radio_config", update):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(frame) == b"\x00"
    sent = update.await_args.args[0].model_dump(exclude_unset=True)
    for field, value in expected.items():
        assert sent[field] == (pytest.approx(value) if isinstance(value, float) else value)
    assert radio.meshcore.commands.set_manual_add_contacts.await_count == 0


@pytest.mark.asyncio
async def test_radio_params(db):
    radio = FakeRadio()
    update = AsyncMock()
    body = struct.pack("<II", 869_618, 62_500) + b"\x08\x08"
    with patch("app.routers.radio.update_radio_config", update):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x0b" + body) == b"\x00"
            # RTFM-EV never switches client repeat on for an app.
            assert await client.call(b"\x0b" + body + b"\x01") == frames.err(
                frames.ERR_CODE_ILLEGAL_ARG
            )
    settings = update.await_args.args[0].radio
    assert (settings.freq, settings.bw, settings.sf, settings.cr) == (869.618, 62.5, 8, 8)
    assert update.await_count == 1


@pytest.mark.asyncio
async def test_bad_values_are_illegal_arg(db):
    radio = FakeRadio()
    update = AsyncMock()
    with patch("app.routers.radio.update_radio_config", update):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x3d\x00\x05") == frames.err(frames.ERR_CODE_ILLEGAL_ARG)
            assert await client.call(b"\x0e" + struct.pack("<ii", 95_000_000, 0)) == frames.err(
                frames.ERR_CODE_ILLEGAL_ARG
            )
    assert update.await_count == 0


@pytest.mark.asyncio
async def test_manual_add_contacts_is_set_on_the_radio(db):
    radio = FakeRadio()
    with patch("app.routers.radio.update_radio_config", AsyncMock()):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x26\x01") == b"\x00"
    radio.meshcore.commands.set_manual_add_contacts.assert_awaited_once_with(True)


@pytest.mark.asyncio
async def test_autoadd_keeps_overwrite_oldest_when_rtfm_ev_needs_it(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_SET_AUTOADD_CONFIG] = [b"\x00"]
    async with running(radio) as (_server, connect):
        client = await connect()
        with patch("app.config.settings.load_with_autoevict", True):
            assert await client.call(b"\x3a\x00\x03") == b"\x00"
        with patch("app.config.settings.load_with_autoevict", False):
            assert await client.call(b"\x3a\x00\x03") == b"\x00"
    assert radio.sent == [b"\x3a\x01\x03", b"\x3a\x00\x03"]


@pytest.mark.asyncio
async def test_advert_own_cli_and_reboot_use_rtfm_ev(db):
    radio = FakeRadio()
    advert = AsyncMock(return_value={"status": "ok"})
    cli = AsyncMock(return_value=SimpleNamespace(reply="> name: Base Node"))
    reboot = AsyncMock(return_value={"status": "ok"})
    with (
        patch("app.routers.radio.send_advertisement", advert),
        patch("app.routers.radio.run_radio_cli", cli),
        patch("app.routers.radio.reboot_radio", reboot),
    ):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x07\x01") == b"\x00"
            assert await client.call(b"\x07") == b"\x00"
            assert await client.call(b"\x42get name") == b"\x1d> name: Base Node"
            await client.send(b"\x13reboot")
            assert await client.nothing()  # like the firmware: no answer
            assert await client.call(b"\x13nope") == frames.err(frames.ERR_CODE_UNSUPPORTED_CMD)
    assert [c.args[0].mode for c in advert.await_args_list] == ["flood", "zero_hop"]
    assert cli.await_args.args[0].command == "get name"
    reboot.assert_awaited_once()


# ── contacts and channels: RTFM-EV's lists ──────────────────────────────────


def contact_frame(key: str, name: str, path: bytes | None) -> bytes:
    path_len = 0xFF if path is None else len(path)
    return (
        b"\x09"
        + bytes.fromhex(key)
        + bytes([1, 0x01, path_len])
        + (path or b"").ljust(64, b"\0")
        + name.encode().ljust(32, b"\0")
        + struct.pack("<Iii", 1_800_000_000, 51_500_000, 4_500_000)
    )


@pytest.mark.asyncio
async def test_add_update_contact_changes_rtfm_ev_contacts(db):
    radio = FakeRadio()
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(contact_frame(BOB_KEY, "Bob", b"\xcc\xdd\xee")) == b"\x00"
        assert await client.call(contact_frame(ALICE_KEY, "Alice 2", None)) == b"\x00"
        by_key = await client.call(b"\x1e" + bytes.fromhex(BOB_KEY))
    bob = await ContactRepository.get_by_key(BOB_KEY)
    assert bob.name == "Bob"
    assert bob.flags == 1
    assert (bob.direct_path, bob.direct_path_len) == ("ccddee", 3)
    assert bob.lat == pytest.approx(51.5)
    alice = await ContactRepository.get_by_key(ALICE_KEY)
    assert alice.name == "Alice 2"
    assert alice.direct_path_len == -1
    assert by_key[0] == frames.RESP_CODE_CONTACT and by_key[1:33] == bytes.fromhex(BOB_KEY)
    # Pushed to the radio as RTFM-EV does for its own contact edits.
    pushed = [c.args[0]["public_key"] for c in radio.meshcore.commands.add_contact.await_args_list]
    assert pushed == [BOB_KEY, ALICE_KEY]


@pytest.mark.asyncio
async def test_remove_contact_and_reset_path(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_RESET_PATH] = [b"\x00"]
    async with running(radio) as (_server, connect):
        client = await connect()
        assert await client.call(b"\x0d" + ALICE) == b"\x00"
        assert (await ContactRepository.get_by_key(ALICE_KEY)).direct_path_len == -1
        assert await client.call(b"\x0f" + ALICE) == b"\x00"
        assert await client.call(b"\x0f" + ALICE) == frames.err(frames.ERR_CODE_NOT_FOUND)
        assert await client.call(b"\x1e" + ALICE) == frames.err(frames.ERR_CODE_NOT_FOUND)
    assert await ContactRepository.get_by_key(ALICE_KEY) is None
    assert radio.sent == [b"\x0d" + ALICE]


@pytest.mark.asyncio
async def test_import_contact_goes_through_rtfm_ev(db):
    radio = FakeRadio()
    imported = AsyncMock()
    card = b"\x11" * 110
    with patch("app.routers.contacts.import_contact_uri", imported):
        async with running(radio) as (_server, connect):
            client = await connect()
            assert await client.call(b"\x12" + card) == b"\x00"
            assert await client.call(b"\x12" + b"\x11" * 20) == frames.err(
                frames.ERR_CODE_ILLEGAL_ARG
            )
    assert imported.await_args.args[0].uri == "meshcore://" + card.hex()


def set_channel_frame(slot: int, name: str, secret: bytes) -> bytes:
    return bytes([frames.CMD_SET_CHANNEL, slot]) + name.encode().ljust(32, b"\0") + secret


@pytest.mark.asyncio
async def test_set_channel_changes_rtfm_ev_channels(db):
    from app.routers.channels import _derive_channel_identity

    radio = FakeRadio()
    test_key = bytes.fromhex(_derive_channel_identity("#test", None)[0])
    own_key = bytes(range(16))
    async with running(radio) as (_server, connect):
        client = await connect()
        free = await client.call(b"\x1f\x05")
        assert free == frames.channel_info(5, "", b"")
        assert await client.call(set_channel_frame(5, "#test", test_key)) == b"\x00"
        assert await client.call(b"\x1f\x05") == frames.channel_info(5, "#test", test_key)
        # A #channel with another key than its name gives cannot be kept by RTFM-EV.
        assert await client.call(set_channel_frame(6, "#test2", own_key)) == frames.err(
            frames.ERR_CODE_ILLEGAL_ARG
        )
        # Overwriting a slot replaces the channel; clearing it deletes it.
        assert await client.call(set_channel_frame(5, "Mine", own_key)) == b"\x00"
        assert await client.call(set_channel_frame(5, "", b"\0" * 16)) == b"\x00"
        assert await client.call(b"\x1f\x05") == frames.channel_info(5, "", b"")
        # The canonical Public channel cannot be deleted.
        assert await client.call(set_channel_frame(0, "", b"\0" * 16)) == frames.err(
            frames.ERR_CODE_ILLEGAL_ARG
        )
        assert await client.call(bytes([frames.CMD_GET_CHANNEL, MAX_BRIDGE_CHANNELS])) == (
            frames.err(frames.ERR_CODE_NOT_FOUND)
        )
    keys = {c.key.upper() for c in await ChannelRepository.get_all()}
    assert test_key.hex().upper() not in keys
    assert own_key.hex().upper() not in keys
    assert PUBLIC_CHANNEL_KEY in keys
    assert radio.sent == []  # channels live in RTFM-EV; it loads them at send time


@pytest.mark.asyncio
async def test_channel_data_goes_through_rtfm_ev(db):
    radio = FakeRadio()
    send = AsyncMock()
    with patch("app.services.message_send.send_channel_data_to_channel", send):
        async with running(radio) as (server, connect):
            client = await connect()
            slot = next(iter(server._sessions)).slot_by_key[OPS_KEY]
            head = bytes([frames.CMD_SEND_CHANNEL_DATA, slot])
            assert await client.call(head + b"\xff\x00\xff" + b"payload") == b"\x00"
            # Direct-path channel data: RTFM-EV floods only.
            assert await client.call(head + b"\x00\x00\xff" + b"payload") == frames.err(
                frames.ERR_CODE_UNSUPPORTED_CMD
            )
    kwargs = send.await_args.kwargs
    assert kwargs["channel_key_upper"] == OPS_KEY
    assert kwargs["data_type"] == 0xFF00
    assert kwargs["payload"] == b"payload"


# ── DEVICE_INFO ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_device_info_reports_the_radios_real_version(db):
    radio = FakeRadio()
    async with running(radio) as (_server, connect):
        client = await connect()
        info = await client.call(b"\x16\x03")
        assert info[1] == 10
        assert info[3] == MAX_BRIDGE_CHANNELS
        radio.firmware_ver_code = None
        assert (await client.call(b"\x16\x03"))[1] == 14  # not known yet


# ── pushes ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_radio_pushes_reach_every_app(db):
    radio = FakeRadio()
    async with running(radio) as (server, connect):
        first, second = await connect(), await connect()
        for code in sorted(FORWARDED_PUSHES):
            push = bytes([code]) + b"\x01\x02\x03"
            server.on_radio_frame(push)
            assert await first.read() == push
            assert await second.read() == push
        # Radio cache events and the radio's own message signals are not copied.
        for code in (0x82, 0x83, 0x8F, 0x90):
            server.on_radio_frame(bytes([code]) + b"\x00" * 4)
        # Replies to RTFM-EV's own commands are not copied either.
        server.on_radio_frame(b"\x00")
        assert await first.nothing()


@pytest.mark.asyncio
async def test_rtfm_ev_contact_delete_is_pushed(db):
    radio = FakeRadio()
    async with running(radio) as (server, connect):
        client = await connect()
        server.on_event("contact_deleted", {"public_key": BOB_KEY})
        assert await client.read() == frames.contact_deleted(BOB_KEY)


def test_hook_passes_frames_on_and_is_installed_once():
    bridge = CompanionBridge()
    seen: list[bytes] = []

    async def original(data):
        seen.append(bytes(data))

    reader = SimpleNamespace(handle_rx=original)
    mc = SimpleNamespace(_reader=reader)
    bridge.attach_radio(mc)
    hooked = reader.handle_rx
    bridge.attach_radio(mc)
    assert reader.handle_rx is hooked
    asyncio.run(reader.handle_rx(bytearray(b"\x88\x01")))
    assert seen == [b"\x88\x01"]


# ── read only ───────────────────────────────────────────────────────────────

CHANGING = sorted(code for code, (_fn, kind) in commands._HANDLERS.items() if kind == "change")


@pytest.mark.asyncio
async def test_read_only_refuses_everything_that_changes_or_transmits(db):
    radio = FakeRadio()
    radio.replies[frames.CMD_GET_STATS] = [b"\x18\x00" + b"\x00" * 9]
    async with running(radio, allow_send=False) as (_server, connect):
        client = await connect()
        refused = frames.err(frames.ERR_CODE_UNSUPPORTED_CMD)
        for code in CHANGING:
            assert await client.call(bytes([code]) + ALICE + b"\x00" * 40) == refused, code
        # Remote telemetry and remote CLI transmit too.
        assert await client.call(b"\x27\x00\x00\x00" + ALICE) == refused
        cli = b"\x02\x01\x00" + struct.pack("<I", 1) + ALICE[:6] + b"ver"
        assert await client.call(cli) == refused
        # Reads still work.
        assert (await client.call(b"\x38\x00"))[0] == frames.RESP_CODE_STATS
        assert (await client.call(b"\x1e" + ALICE))[0] == frames.RESP_CODE_CONTACT
    assert radio.sent == [b"\x38\x00"]


def test_every_listed_command_is_handled():
    from app.companion_bridge.server import CompanionBridge as _Bridge  # noqa: F401

    issue_388 = {
        frames.CMD_SEND_SELF_ADVERT,
        frames.CMD_SET_ADVERT_NAME,
        frames.CMD_ADD_UPDATE_CONTACT,
        frames.CMD_SET_RADIO_PARAMS,
        frames.CMD_SET_RADIO_TX_POWER,
        frames.CMD_RESET_PATH,
        frames.CMD_SET_ADVERT_LATLON,
        frames.CMD_REMOVE_CONTACT,
        frames.CMD_SHARE_CONTACT,
        frames.CMD_EXPORT_CONTACT,
        frames.CMD_IMPORT_CONTACT,
        frames.CMD_REBOOT,
        frames.CMD_SET_TUNING_PARAMS,
        frames.CMD_EXPORT_PRIVATE_KEY,
        frames.CMD_IMPORT_PRIVATE_KEY,
        frames.CMD_SEND_RAW_DATA,
        frames.CMD_SEND_LOGIN,
        frames.CMD_SEND_STATUS_REQ,
        frames.CMD_HAS_CONNECTION,
        frames.CMD_LOGOUT,
        frames.CMD_GET_CONTACT_BY_KEY,
        frames.CMD_SET_CHANNEL,
        frames.CMD_SIGN_START,
        frames.CMD_SIGN_DATA,
        frames.CMD_SIGN_FINISH,
        frames.CMD_SEND_TRACE_PATH,
        frames.CMD_SET_OTHER_PARAMS,
        frames.CMD_SEND_TELEMETRY_REQ,
        frames.CMD_GET_CUSTOM_VARS,
        frames.CMD_SET_CUSTOM_VAR,
        frames.CMD_GET_ADVERT_PATH,
        frames.CMD_GET_TUNING_PARAMS,
        frames.CMD_SEND_BINARY_REQ,
        frames.CMD_FACTORY_RESET,
        frames.CMD_SEND_PATH_DISCOVERY_REQ,
        frames.CMD_SET_FLOOD_SCOPE_KEY,
        frames.CMD_SEND_CONTROL_DATA,
        frames.CMD_GET_STATS,
        frames.CMD_SEND_ANON_REQ,
        frames.CMD_SET_AUTOADD_CONFIG,
        frames.CMD_GET_AUTOADD_CONFIG,
        frames.CMD_GET_ALLOWED_REPEAT_FREQ,
        frames.CMD_SET_PATH_HASH_MODE,
        frames.CMD_SEND_CHANNEL_DATA,
        frames.CMD_SET_DEFAULT_FLOOD_SCOPE,
        frames.CMD_GET_DEFAULT_FLOOD_SCOPE,
        frames.CMD_SEND_RAW_PACKET,
        frames.CMD_RUN_CLI_COMMAND,
    }
    assert issue_388 <= set(commands._HANDLERS)
    # Not in the issue (a BLE pin): still refused.
    assert frames.CMD_SET_DEVICE_PIN not in commands._HANDLERS
