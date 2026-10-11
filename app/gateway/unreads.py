"""Unread totals of every radio, for the switcher badges and sounds (plan 30, D3).

A workspace only knows its own radio. The gateway keeps a chat-event
connection to every running worker; when an event can change what is unread it
asks that worker for its own unread counts and publishes a small summary per
radio on ``/gateway/ws``. The counts are the worker's: blocked senders and the
hide filters are already applied there, so nothing is decided twice.

An *alert* is what may deserve a sound: more unread direct messages from a
contact, or a channel getting its first unread mention. A further mention in a
channel that already has one raises no second alert, because the worker only
reports a flag per channel.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Callable

import httpx
import websockets

from app.gateway.registry import RadioRegistry
from app.gateway.supervisor import Worker
from app.security import WORKER_TOKEN_HEADER

logger = logging.getLogger(__name__)

# Worker events after which unread counts can differ. Adverts ("contact") and
# health are frequent and never change them.
REFRESH_EVENTS = frozenset(
    {
        "message",
        "message_deleted",
        "message_spam",
        "channel",
        "channel_deleted",
        "contact_deleted",
    }
)
# Marking read has no event, so every radio is also asked on a timer.
REFRESH_INTERVAL_SECONDS = 20.0
TICK_SECONDS = 0.5
_RECONNECT_SECONDS = 2.0
_REQUEST_TIMEOUT_SECONDS = 10.0
_CLIENT_QUEUE_SIZE = 50
_READ_ONLY = frozenset({"GET", "HEAD", "OPTIONS"})


def changes_unreads(method: str, path: str) -> bool:
    """Whether a worker request can change unread counts without a worker event."""
    if method in _READ_ONLY:
        return False
    return (
        path == "api/settings"
        or path.startswith("api/read-state/")
        or path.endswith(("/mark-read", "/mark-unread"))
    )


def summarize(
    unreads: dict, channels: list[dict], sound: bool
) -> tuple[dict, dict[str, int], frozenset[str]]:
    """A worker's unread reply as (summary, unread DMs per contact, channels with a mention).

    Muted channels are left out, as in the app's own unread total.
    """
    muted = {f"channel-{c.get('key')}" for c in channels if c.get("muted")}
    counts = {
        key: int(count)
        for key, count in (unreads.get("counts") or {}).items()
        if count and key not in muted
    }
    dm_counts = {key: count for key, count in counts.items() if key.startswith("contact-")}
    mention_keys = frozenset(
        key
        for key, flagged in (unreads.get("mentions") or {}).items()
        if flagged and key.startswith("channel-") and key not in muted
    )
    summary = {
        "unread": sum(counts.values()),
        "dms": sum(dm_counts.values()),
        "mentions": len(mention_keys),
        "sound": bool(sound),
    }
    return summary, dm_counts, mention_keys


def new_alerts(
    old_dms: dict[str, int],
    old_mentions: frozenset[str],
    new_dms: dict[str, int],
    new_mentions: frozenset[str],
) -> list[str]:
    """State keys that became alert-worthy between two snapshots of one radio."""
    keys = [key for key, count in new_dms.items() if count > old_dms.get(key, 0)]
    return keys + sorted(new_mentions - old_mentions)


class UnreadsHub:
    def __init__(
        self,
        registry: RadioRegistry,
        supervisor,
        client: httpx.AsyncClient,
        *,
        connect: Callable = websockets.connect,
        clock: Callable[[], float] = time.monotonic,
        refresh_interval: float = REFRESH_INTERVAL_SECONDS,
        tick: float = TICK_SECONDS,
    ) -> None:
        self._registry = registry
        self._supervisor = supervisor
        self._client = client
        self._connect = connect
        self._clock = clock
        self._refresh_interval = refresh_interval
        self._tick = tick
        self._summaries: dict[int, dict] = {}
        self._details: dict[int, tuple[dict[str, int], frozenset[str]]] = {}
        self._dirty: set[int] = set()
        # radio id -> (worker token, event stream task)
        self._listeners: dict[int, tuple[str, asyncio.Task]] = {}
        self._clients: set[asyncio.Queue] = set()
        self._wake = asyncio.Event()
        self._last_full_refresh: float | None = None

    def snapshot(self) -> dict:
        return {"radios": {str(i): self._summaries[i] for i in sorted(self._summaries)}}

    def mark_dirty(self, radio_id: int) -> None:
        self._dirty.add(radio_id)
        self._wake.set()

    def add_client(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=_CLIENT_QUEUE_SIZE)
        self._clients.add(queue)
        return queue

    def remove_client(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)

    async def run(self) -> None:
        """Keep listeners and totals current. Cancel to stop."""
        try:
            while True:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), self._tick)
                self._wake.clear()
                try:
                    await self.step()
                except Exception:
                    logger.exception("Unread totals refresh failed")
        finally:
            await self.close()

    async def close(self) -> None:
        listeners, self._listeners = self._listeners, {}
        for _, task in listeners.values():
            task.cancel()
        for _, task in listeners.values():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    async def step(self) -> None:
        """One pass: follow worker starts and stops, refresh what is due, publish changes."""
        running: dict[int, Worker] = {}
        for radio in self._registry.radios:
            worker = self._supervisor.worker(radio.id)
            if worker.state == "running":
                running[radio.id] = worker

        for radio_id, (token, task) in list(self._listeners.items()):
            worker = running.get(radio_id)
            if worker is None or worker.token != token or task.done():
                task.cancel()
                del self._listeners[radio_id]
        for radio_id, worker in running.items():
            if radio_id not in self._listeners:
                task = asyncio.create_task(self._listen(radio_id, worker))
                self._listeners[radio_id] = (worker.token, task)
                self._dirty.add(radio_id)

        changed = False
        for radio_id in [i for i in self._summaries if i not in running]:
            del self._summaries[radio_id]
            self._details.pop(radio_id, None)
            changed = True

        now = self._clock()
        if (
            self._last_full_refresh is None
            or now - self._last_full_refresh >= self._refresh_interval
        ):
            self._last_full_refresh = now
            self._dirty.update(running)

        due, self._dirty = self._dirty & set(running), set()
        alerts: list[tuple[int, list[str]]] = []
        for radio_id in sorted(due):
            radio_changed, keys = await self._refresh(radio_id, running[radio_id])
            changed = changed or radio_changed
            if keys:
                alerts.append((radio_id, keys))

        if changed:
            self._broadcast({"type": "unreads", **self.snapshot()})
        for radio_id, keys in alerts:
            self._broadcast({"type": "alert", "radio": radio_id, "keys": keys})

    async def _refresh(self, radio_id: int, worker: Worker) -> tuple[bool, list[str]]:
        unreads = await self._get(worker, "/api/read-state/unreads")
        channels = await self._get(worker, "/api/channels")
        if not isinstance(unreads, dict) or not isinstance(channels, list):
            return False, []
        settings = await self._get(worker, "/api/settings")
        previous = self._summaries.get(radio_id)
        if isinstance(settings, dict):
            sound = bool(settings.get("mention_sound_enabled"))
        else:
            sound = bool(previous and previous["sound"])

        summary, dm_counts, mention_keys = summarize(unreads, channels, sound)
        keys: list[str] = []
        if radio_id in self._details:  # the first snapshot of a radio alerts nothing
            old_dms, old_mentions = self._details[radio_id]
            keys = new_alerts(old_dms, old_mentions, dm_counts, mention_keys)
        self._summaries[radio_id] = summary
        self._details[radio_id] = (dm_counts, mention_keys)
        return summary != previous, keys

    async def _get(self, worker: Worker, path: str):
        try:
            response = await self._client.get(
                f"http://127.0.0.1:{worker.port}{path}",
                headers={WORKER_TOKEN_HEADER: worker.token},
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError:
            return None
        if response.status_code != 200:
            return None
        try:
            return response.json()
        except ValueError:
            return None

    async def _listen(self, radio_id: int, worker: Worker) -> None:
        """Follow one worker's chat events; reconnect until cancelled."""
        url = f"ws://127.0.0.1:{worker.port}/api/ws?events=chat"
        while True:
            try:
                async with self._connect(
                    url,
                    additional_headers={WORKER_TOKEN_HEADER: worker.token},
                    max_size=None,
                    open_timeout=5,
                ) as stream:
                    self.mark_dirty(radio_id)  # anything may have happened while away
                    async for raw in stream:
                        try:
                            event_type = json.loads(raw).get("type")
                        except (ValueError, AttributeError):
                            continue
                        if event_type in REFRESH_EVENTS:
                            self.mark_dirty(radio_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.debug("Radio %d event stream lost, reconnecting", radio_id, exc_info=True)
            await asyncio.sleep(_RECONNECT_SECONDS)

    def _broadcast(self, message: dict) -> None:
        for queue in self._clients:
            if queue.full():
                # A client that stopped reading only loses its oldest update.
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(message)
