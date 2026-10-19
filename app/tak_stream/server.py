"""TAK Stream: a plaintext TCP server that streams CoT events to ATAK / WinTAK.

Started from the lifespan only when ``MESHCORE_TAK_STREAM_ENABLED`` is set. Each
client gets a full snapshot on connect and again every ``snapshot_interval_s``,
plus every new tracker position / object as it is decoded. Unauthenticated and
unencrypted, so for trusted networks only. Read-only: whatever a client sends
is read and thrown away; nothing reaches the mesh.
"""

import asyncio
import contextlib
import logging
import time

from app.models import TrackerObject, TrackerPosition
from app.repository import AppSettingsRepository, ContactRepository
from app.repository.trackers import TrackerRepository
from app.services.bot_lists import bot_lists
from app.services.team_beacons import collect_team_beacons
from app.tak_stream.events import (
    NODE_STALE_S,
    TRACKER_STALE_S,
    contact_event,
    object_event,
    team_beacon_event,
    tracker_event,
)

logger = logging.getLogger(__name__)


class _Client:
    def __init__(self, writer: asyncio.StreamWriter, queue_size: int) -> None:
        self.writer = writer
        self.queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=queue_size)
        self.tasks: list[asyncio.Task] = []


class TakStreamServer:
    def __init__(
        self,
        snapshot_interval_s: float = 30.0,
        max_clients: int = 16,
        queue_size: int = 256,
        write_timeout_s: float = 5.0,
    ) -> None:
        self._snapshot_interval_s = snapshot_interval_s
        self._max_clients = max_clients
        self._queue_size = queue_size
        self._write_timeout_s = write_timeout_s
        self._server: asyncio.Server | None = None
        self._snapshot_task: asyncio.Task | None = None
        self._clients: set[_Client] = set()
        self._host: str | None = None
        self.port: int | None = None

    async def start(self, host: str, port: int) -> None:
        self._server = await asyncio.start_server(self._on_connect, host, port)
        self._host = host
        self.port = self._server.sockets[0].getsockname()[1]
        self._snapshot_task = asyncio.create_task(self._snapshot_loop())
        logger.warning(
            "TAK Stream listening on %s:%d (plaintext CoT, no authentication: trusted networks only)",
            host,
            self.port,
        )

    async def stop(self) -> None:
        if self._snapshot_task is not None:
            self._snapshot_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._snapshot_task
            self._snapshot_task = None
        for client in list(self._clients):
            await self._drop(client)
        if self._server is not None:
            self._server.close()
            # Never let a lingering connection hold up the rest of the shutdown.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._server.wait_closed(), 2)
            self._server = None
        self._host = None
        self.port = None

    def status(self) -> dict:
        running = self._server is not None
        return {
            "enabled": running,
            "host": self._host,
            "port": self.port,
            "clients": len(self._clients),
        }

    def publish_tracker(self, item: TrackerPosition | TrackerObject) -> None:
        """Queue one decoded tracker item for every client; no-op when not running."""
        if self._server is None or not self._clients:
            return
        now = int(time.time())
        event = (
            tracker_event(item, now)
            if isinstance(item, TrackerPosition)
            else object_event(item, now)
        )
        if event is not None:
            self._broadcast([event])

    def _broadcast(self, events: list[bytes]) -> None:
        for client in list(self._clients):
            self._enqueue(client, events)

    def _enqueue(self, client: _Client, events: list[bytes]) -> None:
        for event in events:
            try:
                client.queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.info("TAK Stream client too slow, disconnecting")
                asyncio.create_task(self._drop(client))
                return

    async def _snapshot(self) -> list[bytes]:
        now = int(time.time())
        settings = await AppSettingsRepository.get()
        hidden_keys, _hidden_names = await bot_lists.hidden_senders(settings)
        blocked = {k.lower() for k in hidden_keys or []}
        events: list[bytes] = []
        for contact in await ContactRepository.get_positioned(now - NODE_STALE_S):
            if contact.public_key.lower() in blocked:
                continue
            event = contact_event(contact, now)
            if event is not None:
                events.append(event)
        positions = await TrackerRepository.positions(now - TRACKER_STALE_S, None, True, None, 5000)
        events.extend(e for p in positions if (e := tracker_event(p, now)) is not None)
        objects = await TrackerRepository.objects(None, None, False, now)
        events.extend(e for o in objects if (e := object_event(o, now)) is not None)
        beacons = await collect_team_beacons(
            since=now - TRACKER_STALE_S, until=None, latest_per_sender=True
        )
        events.extend(e for b in beacons.beacons if (e := team_beacon_event(b, now)) is not None)
        return events

    async def _snapshot_loop(self) -> None:
        while True:
            await asyncio.sleep(self._snapshot_interval_s)
            if not self._clients:
                continue
            try:
                snapshot = await self._snapshot()
                if snapshot:
                    self._broadcast([b"".join(snapshot)])
            except Exception:  # noqa: BLE001 - keep streaming after a bad snapshot
                logger.exception("TAK Stream snapshot failed")

    async def _on_connect(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if len(self._clients) >= self._max_clients:
            logger.info("TAK Stream: client limit (%d) reached, refusing", self._max_clients)
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            return
        client = _Client(writer, self._queue_size)
        self._clients.add(client)
        client.tasks = [
            asyncio.create_task(self._write_loop(client)),
            asyncio.create_task(self._discard_loop(client, reader)),
        ]
        try:
            # One queue item: a big picture must not count as a slow client.
            snapshot = await self._snapshot()
            if snapshot:
                self._enqueue(client, [b"".join(snapshot)])
        except Exception:  # noqa: BLE001 - the live push still works
            logger.exception("TAK Stream snapshot for a new client failed")

    async def _write_loop(self, client: _Client) -> None:
        try:
            while True:
                event = await client.queue.get()
                client.writer.write(event)
                await asyncio.wait_for(client.writer.drain(), self._write_timeout_s)
        except (TimeoutError, ConnectionError, OSError):
            logger.info("TAK Stream client stopped reading, disconnecting")
            asyncio.create_task(self._drop(client))

    async def _discard_loop(self, client: _Client, reader: asyncio.StreamReader) -> None:
        try:
            while await reader.read(4096):
                pass
        except (ConnectionError, OSError):
            pass
        asyncio.create_task(self._drop(client))

    async def _drop(self, client: _Client) -> None:
        if client not in self._clients:
            return
        self._clients.discard(client)
        current = asyncio.current_task()
        for task in client.tasks:
            if task is not current:
                task.cancel()
        client.writer.close()
        # close() waits for unsent data to flush, which never happens when the
        # peer stopped reading: abort drops the buffer and frees the socket.
        client.writer.transport.abort()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(client.writer.wait_closed(), 1)


tak_stream = TakStreamServer()
