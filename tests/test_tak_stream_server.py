"""TAK Stream TCP server: snapshot, live push, client limits."""

import asyncio
import socket
import time

import pytest

from app.models import CONTACT_TYPE_CLIENT, TrackerObject, TrackerPosition
from app.repository import ContactRepository
from app.repository.trackers import TrackerRepository
from app.tak_stream.server import TakStreamServer

KEY = "ab12cd34ef56" + "00" * 26


def _position(identity: str = "JESTER_25", remarks_size: int = 0) -> TrackerPosition:
    return TrackerPosition(
        source="atak",
        identity=identity + "x" * remarks_size,
        cot_uid=f"ANDROID-{identity}",
        lat=52.0,
        lon=5.0,
        received_at=int(time.time()),
    )


async def _read_event(reader: asyncio.StreamReader, timeout: float = 3.0) -> bytes:
    return await asyncio.wait_for(reader.readuntil(b"\n"), timeout)


@pytest.fixture
async def server(test_db):
    srv = TakStreamServer(snapshot_interval_s=3600)
    await srv.start("127.0.0.1", 0)
    try:
        yield srv
    finally:
        await srv.stop()


async def _connect(srv: TakStreamServer):
    return await asyncio.open_connection("127.0.0.1", srv.port)


@pytest.mark.asyncio
async def test_snapshot_on_connect(test_db):
    now = int(time.time())
    await ContactRepository.upsert(
        {
            "public_key": KEY,
            "name": "Node A",
            "type": CONTACT_TYPE_CLIENT,
            "lat": 52.0,
            "lon": 5.0,
            "last_seen": now,
        }
    )
    await TrackerRepository.add_position(_position())
    await TrackerRepository.upsert_object(
        TrackerObject(
            uid="u-1", cot_type="a-h-G", lat=52.0, lon=5.0, received_at=now, stale_at=now + 600
        )
    )
    srv = TakStreamServer(snapshot_interval_s=3600)
    await srv.start("127.0.0.1", 0)
    try:
        reader, writer = await _connect(srv)
        events = [await _read_event(reader) for _ in range(3)]
        joined = b"".join(events)
        assert b'uid="RTFM-EV-ab12cd34ef56"' in joined
        assert b'uid="ANDROID-JESTER_25"' in joined
        assert b'uid="u-1"' in joined
        writer.close()
    finally:
        await srv.stop()


@pytest.mark.asyncio
async def test_publish_pushes_to_clients(server):
    reader, writer = await _connect(server)
    await asyncio.sleep(0.1)
    assert server.status()["clients"] == 1
    server.publish_tracker(_position("LIVE_1"))
    assert b'uid="ANDROID-LIVE_1"' in await _read_event(reader)
    writer.close()


@pytest.mark.asyncio
async def test_max_clients(test_db):
    srv = TakStreamServer(snapshot_interval_s=3600, max_clients=2)
    await srv.start("127.0.0.1", 0)
    try:
        conns = [await _connect(srv) for _ in range(2)]
        await asyncio.sleep(0.1)
        reader, writer = await _connect(srv)
        assert await asyncio.wait_for(reader.read(), 3) == b""  # closed at once
        assert srv.status()["clients"] == 2
        for _, w in conns:
            w.close()
        writer.close()
    finally:
        await srv.stop()


@pytest.mark.asyncio
async def test_client_leaving_is_removed(server):
    _, writer = await _connect(server)
    await asyncio.sleep(0.1)
    writer.close()
    for _ in range(30):
        if server.status()["clients"] == 0:
            break
        await asyncio.sleep(0.05)
    assert server.status()["clients"] == 0


@pytest.mark.asyncio
async def test_inbound_discarded(server):
    reader, writer = await _connect(server)
    writer.write(b"<event uid='from-atak'/>\n" * 50)
    await writer.drain()
    server.publish_tracker(_position("AFTER"))
    assert b'uid="ANDROID-AFTER"' in await _read_event(reader)
    writer.close()


@pytest.mark.asyncio
async def test_slow_client_dropped(test_db):
    srv = TakStreamServer(snapshot_interval_s=3600, queue_size=4, write_timeout_s=0.3)
    await srv.start("127.0.0.1", 0)
    try:
        slow = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        slow.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        slow.connect(("127.0.0.1", srv.port))
        reader, writer = await _connect(srv)
        await asyncio.sleep(0.1)
        assert srv.status()["clients"] == 2

        received = 0

        async def drain_fast() -> None:
            nonlocal received
            while True:
                await _read_event(reader, timeout=5)
                received += 1

        task = asyncio.create_task(drain_fast())
        for i in range(400):
            srv.publish_tracker(_position(f"P{i}_", remarks_size=4000))
            await asyncio.sleep(0.005)
        for _ in range(60):
            if srv.status()["clients"] == 1:
                break
            await asyncio.sleep(0.05)
        assert srv.status()["clients"] == 1  # the slow one is gone
        srv.publish_tracker(_position("STILL_HERE"))
        await asyncio.sleep(0.3)
        assert received > 0
        task.cancel()
        slow.close()
        writer.close()
    finally:
        await srv.stop()


@pytest.mark.asyncio
async def test_large_snapshot_reaches_a_reading_client(test_db, monkeypatch):
    srv = TakStreamServer(snapshot_interval_s=3600)
    events = [b'<event uid="e%d"/>\n' % i for i in range(300)]

    async def big_snapshot() -> list[bytes]:
        return events

    monkeypatch.setattr(srv, "_snapshot", big_snapshot)
    await srv.start("127.0.0.1", 0)
    try:
        reader, writer = await _connect(srv)
        got = [await _read_event(reader) for _ in range(300)]
        assert got[-1] == b'<event uid="e299"/>\n'
        assert srv.status()["clients"] == 1
        writer.close()
    finally:
        await srv.stop()


@pytest.mark.asyncio
async def test_stop_returns_with_a_stalled_client(test_db):
    srv = TakStreamServer(snapshot_interval_s=3600, queue_size=4, write_timeout_s=0.3)
    await srv.start("127.0.0.1", 0)
    slow = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    slow.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
    slow.connect(("127.0.0.1", srv.port))
    try:
        await asyncio.sleep(0.1)
        for i in range(400):
            srv.publish_tracker(_position(f"S{i}_", remarks_size=4000))
            await asyncio.sleep(0.005)
        for _ in range(60):
            if srv.status()["clients"] == 0:
                break
            await asyncio.sleep(0.05)
        assert srv.status()["clients"] == 0
        await asyncio.wait_for(srv.stop(), 5)
    finally:
        slow.close()


@pytest.mark.asyncio
async def test_status_off_when_not_started():
    srv = TakStreamServer()
    assert srv.status() == {"enabled": False, "host": None, "port": None, "clients": 0}
    srv.publish_tracker(_position())  # no-op, no error
