"""Full capture service: routing, storage, the 0xC0 hook and the connect step."""

import pytest
from meshcore import EventType

from app.full_capture import STATUS_CRC, STATUS_DROPS, STATUS_OK, CapturedFrame
from app.radio import radio_manager
from app.repository.rx_bad_frames import RxBadFrameRepository
from app.services import full_capture as service


@pytest.fixture
def broadcasts(monkeypatch):
    seen: list[tuple[str, dict]] = []

    def fake(event_type: str, data: dict, **_kwargs) -> None:
        seen.append((event_type, data))

    import app.packet_processor as packet_processor

    monkeypatch.setattr(service, "broadcast_event", fake)
    monkeypatch.setattr(packet_processor, "broadcast_event", fake)
    radio_manager.rx_ring_drops = 0
    return seen


def advert_frame(length: int) -> bytes:
    """A flood ADVERT-shaped frame of ``length`` bytes (header, path byte 0, payload)."""
    return bytes([0x11, 0x00]) + bytes(range(256))[: length - 2]


async def _count(test_db, table: str) -> int:
    row = await (await test_db.conn.execute(f"SELECT COUNT(*) FROM {table}")).fetchone()
    return row[0]


@pytest.mark.asyncio
async def test_status_0_goes_through_packet_pipeline(test_db, broadcasts):
    frame = CapturedFrame(status=STATUS_OK, snr=5.0, rssi=-70, data=advert_frame(200), dropped=None)
    await service.route_captured(frame)
    assert await _count(test_db, "raw_packets") == 1
    assert [e for e, _ in broadcasts].count("raw_packet") == 1


@pytest.mark.asyncio
async def test_damaged_frame_is_stored_apart(test_db, broadcasts):
    data = bytes(range(40))
    await service.route_captured(
        CapturedFrame(status=STATUS_CRC, snr=-2.5, rssi=-90, data=data, dropped=None)
    )
    rows = await (
        await test_db.conn.execute("SELECT status, length, rssi, snr, data FROM rx_bad_frames")
    ).fetchall()
    assert [tuple(r) for r in rows] == [(STATUS_CRC, 40, -90, -2.5, data)]
    assert await _count(test_db, "raw_packets") == 0
    assert [e for e, _ in broadcasts] == ["rx_bad_frame"]
    event = broadcasts[0][1]
    assert event["data"] == data.hex() and event["status"] == STATUS_CRC
    assert isinstance(event["observation_id"], int)


@pytest.mark.asyncio
async def test_drop_notice_counts(test_db, broadcasts):
    for n in (3, 4):
        await service.route_captured(
            CapturedFrame(status=STATUS_DROPS, snr=0.0, rssi=0, data=b"", dropped=n)
        )
    assert radio_manager.rx_ring_drops == 7
    assert broadcasts == []


class FakeReader:
    def __init__(self) -> None:
        self.forwarded: list[bytes] = []

        async def original(data):
            self.forwarded.append(bytes(data))

        self.handle_rx = original


class FakeCommands:
    def __init__(self, reader: FakeReader, reply: bytes | None) -> None:
        self.reader = reader
        self.reply = reply
        self.sent: list[bytes] = []

    async def send(self, data, expected_events=None, timeout=None):
        self.sent.append(bytes(data))
        if self.reply is None:
            return type("Ev", (), {"type": EventType.ERROR, "payload": {"reason": "timeout"}})()
        await self.reader.handle_rx(bytearray(self.reply))
        kind = EventType.OK if self.reply[0] == 0x00 else EventType.ERROR
        return type("Ev", (), {"type": kind, "payload": {}})()


class FakeMc:
    def __init__(self, reply: bytes | None) -> None:
        self._reader = FakeReader()
        self.commands = FakeCommands(self._reader, reply)


@pytest.mark.asyncio
async def test_hook_swallows_0xc0_and_passes_others(monkeypatch):
    routed: list[CapturedFrame] = []

    async def fake_route(frame):
        routed.append(frame)

    monkeypatch.setattr(service, "route_captured", fake_route)
    mc = FakeMc(reply=None)
    service.install_full_capture_hook(mc)
    service.install_full_capture_hook(mc)  # a second install does not wrap twice

    await mc._reader.handle_rx(bytearray(bytes([0xC0, 1, 0x01, STATUS_CRC, 0, 0xC4, 2]) + b"ab"))
    await mc._reader.handle_rx(bytearray(b"\x88\x10\xc4\x01\x02"))
    await mc._reader.handle_rx(bytearray(b"\xc0\x01"))  # malformed: dropped, no exception
    await service.drain_pending()

    assert mc._reader.forwarded == [b"\x88\x10\xc4\x01\x02"]
    assert [f.data for f in routed] == [b"ab"]


@pytest.mark.asyncio
async def test_enable_returns_none_on_error():
    mc = FakeMc(reply=b"\x01\x02")
    assert await service.enable_full_capture(mc, 3) is None
    assert mc.commands.sent == [b"\xe0\x03"]


@pytest.mark.asyncio
async def test_enable_returns_supported_mask():
    mc = FakeMc(reply=b"\x00\x07")
    assert await service.enable_full_capture(mc, 1) == 7
    # The temporary sniffing hook is gone again.
    await mc._reader.handle_rx(bytearray(b"\x88\x00"))
    assert mc._reader.forwarded[-1] == b"\x88\x00"


@pytest.mark.asyncio
async def test_connect_on_stock_firmware_leaves_everything_off(test_db):
    mc = FakeMc(reply=b"\x01\x02")
    original = mc._reader.handle_rx
    await RxBadFrameRepository.set_flags(3)
    await service.apply_on_connect(mc)
    assert radio_manager.full_capture_supported_flags == 0
    assert mc.commands.sent == [b"\xe0\x03"]
    assert mc._reader.handle_rx is original


@pytest.mark.asyncio
async def test_connect_sends_saved_flags_and_installs_hook(test_db):
    mc = FakeMc(reply=b"\x00\x07")
    await RxBadFrameRepository.set_flags(3)
    await service.apply_on_connect(mc)
    assert mc.commands.sent == [b"\xe0\x03"]
    assert radio_manager.full_capture_supported_flags == 7
    assert getattr(mc._reader, service.HOOK_ATTR, False)


@pytest.mark.asyncio
async def test_connect_with_flags_off_still_learns_support(test_db):
    # 0 turns nothing on (and the radio forgets it on reboot); the reply tells
    # the settings card whether to offer the switches.
    mc = FakeMc(reply=b"\x00\x07")
    await service.apply_on_connect(mc)
    assert mc.commands.sent == [b"\xe0\x00"]
    assert radio_manager.full_capture_supported_flags == 7


@pytest.mark.asyncio
async def test_flags_round_trip(test_db):
    assert await RxBadFrameRepository.get_flags() == 0
    await RxBadFrameRepository.set_flags(5)
    assert await RxBadFrameRepository.get_flags() == 5
