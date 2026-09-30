"""Host repeater neighbour poll: the DMC observer's periodic neighbours table.

TRANSMITS. Every ``neighbor_poll_interval_hours`` (12-336 h, default 24 h) this does
what a DMC observer repeater does before it publishes its ``neighbors`` topic
(``MyMesh::loop`` WITH_MQTT_NEIGHBORS, ``sendNodeDiscoverReq``,
``startNeighborDiscover``, ``sendAnonRegionsReq``):

1. One zero-hop node-discover request for repeaters (``prefix_only`` off, ``since``
   0); replies in the next 60 s update the neighbours table.
2. Per neighbour, newest first and one at a time: an anon regions request sent
   zero-hop direct (empty path, zero-hop reply path), recording the flood-allowed
   region names and ``responded`` / ``timeout`` / ``send_failed``.

Opt-in (``neighbor_poll_enabled``) and only while the host repeater is shadow or
armed, the radio is connected and it is not an OpenHop radio. The first poll waits
``FIRST_POLL_DELAY_SECONDS`` after it becomes eligible. The radio lock is taken for
the discover send and per region request, not during the 60 s listen window.

To send the region request zero-hop, the neighbour is pushed to the radio with an
empty direct path; afterwards its stored route is restored, or it is removed again
when it was not on the radio before, so the radio's contact table is left as found.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time

from meshcore.events import EventType

from app.repository import ContactRepository
from app.services.host_repeater import HostRepeaterRuntime, host_repeater
from app.services.host_repeater_link import radio_snapshot
from app.services.host_repeater_neighbors import NeighbourTable
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)

TICK_SECONDS = 30.0
FIRST_POLL_DELAY_SECONDS = 120.0
DISCOVER_WINDOW_SECONDS = 60.0  # sendNodeDiscoverReq pending_discover_until
REPEATER_FILTER_BITS = 1 << 2  # 1 << ADV_TYPE_REPEATER
REGION_SETTLE_SECONDS = 1.0
REGION_TIMEOUT_SECONDS = 10
REGION_MIN_TIMEOUT_SECONDS = 5


def _zero_hop_radio_dict(public_key: str, base: dict | None) -> dict:
    """The neighbour's radio contact with an empty direct path (``sendDirect(pkt, NULL, 0)``)."""
    out = (
        dict(base)
        if base
        else {
            "public_key": public_key,
            "adv_name": "",
            "type": 2,
            "flags": 0,
            "adv_lat": 0.0,
            "adv_lon": 0.0,
            "last_advert": 0,
        }
    )
    out.update({"out_path": "", "out_path_len": 0, "out_path_hash_mode": 0})
    return out


def _region_names(reply: str) -> str:
    """The anon regions reply (``exportNamesTo``) as a clean comma list, ``*`` kept."""
    names = [n.strip().strip("\x00") for n in reply.split(",")]
    return ",".join(n for n in names if n)


class NeighbourPoller:
    def __init__(self, runtime: HostRepeaterRuntime) -> None:
        self._runtime = runtime
        self._task: asyncio.Task[None] | None = None
        self._eligible_since: float | None = None

    @property
    def table(self) -> NeighbourTable:
        return self._runtime.neighbors

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(
                self._loop(), name="host_repeater_neighbor_poll"
            )

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Host repeater neighbour poll tick failed")

    def _eligible(self) -> bool:
        rt = self._runtime
        if not rt.settings.neighbor_poll_enabled or rt.state == "off":
            return False
        snap = radio_snapshot()
        return snap.connected and not snap.is_openhop and snap.public_key is not None

    def due_at(self) -> float | None:
        """Wall-clock time the next poll is due, or None while not eligible."""
        if self._eligible_since is None:
            return None
        poll = self.table.poll
        if poll.last_finished is not None:
            interval = self._runtime.settings.neighbor_poll_interval_hours * 3600.0
            return poll.last_finished + interval
        return self._eligible_since + FIRST_POLL_DELAY_SECONDS

    async def tick(self, now: float | None = None) -> bool:
        """Run a poll when one is due. Returns True when a poll ran."""
        wall = now if now is not None else time.time()
        if not self._eligible():
            self._eligible_since = None
            self.table.poll.next_due = None
            return False
        if self._eligible_since is None:
            self._eligible_since = wall
        due = self.due_at()
        self.table.poll.next_due = due
        if due is None or wall < due or self.table.poll.running:
            return False
        await self.poll_once()
        self.table.poll.next_due = self.due_at()
        return True

    async def poll_once(self) -> None:
        poll = self.table.poll
        poll.running = True
        poll.last_started = time.time()
        poll.last_error = None
        poll.discovered = poll.queried = poll.responded = 0
        try:
            poll.discovered = await self._discover()
            await self._query_regions()
        except Exception as exc:
            poll.last_error = str(exc) or type(exc).__name__
            logger.warning("Host repeater neighbour poll failed: %s", poll.last_error)
        finally:
            poll.running = False
            poll.last_finished = time.time()
            self.table.version += 1

    async def _discover(self) -> int:
        """Stage 1: zero-hop repeater discover; replies for 60 s update the table."""
        own_key = (radio_snapshot().public_key or b"").hex()
        tag = random.randint(1, 0xFFFFFFFF)
        events: asyncio.Queue = asyncio.Queue()
        async with radio_manager.radio_operation(
            "host_repeater_neighbor_discover", suspend_auto_fetch=True
        ) as mc:
            subscription = mc.subscribe(
                EventType.DISCOVER_RESPONSE,
                lambda event: events.put_nowait(event),
                {"tag": tag.to_bytes(4, "little").hex()},
            )
            try:
                result = await mc.commands.send_node_discover_req(
                    REPEATER_FILTER_BITS, prefix_only=False, tag=tag, since=0
                )
            except Exception:
                subscription.unsubscribe()
                raise
            if result is None or result.type == EventType.ERROR:
                subscription.unsubscribe()
                raise RuntimeError("node discover request failed")
        heard: set[str] = set()
        deadline = time.monotonic() + DISCOVER_WINDOW_SECONDS
        try:
            while (remaining := deadline - time.monotonic()) > 0:
                try:
                    event = await asyncio.wait_for(events.get(), timeout=remaining)
                except TimeoutError:
                    break
                payload = event.payload or {}
                key = payload.get("pubkey")
                if payload.get("node_type") != 2 or not isinstance(key, str) or len(key) != 64:
                    continue
                if key.lower() == own_key:
                    continue
                snr = payload.get("SNR")
                self.table.put(key, float(snr) if isinstance(snr, (int, float)) else None)
                heard.add(key.lower())
        finally:
            subscription.unsubscribe()
        return len(heard)

    async def _query_regions(self) -> None:
        """Stage 2: one zero-hop anon regions request per neighbour, newest first."""
        poll = self.table.poll
        for entry in self.table.ordered():
            if not self._eligible():
                break
            entry.scopes = ""
            try:
                reply = await self._request_regions(entry.public_key)
            except Exception as exc:
                logger.debug(
                    "Neighbour region request to %s failed: %s", entry.public_key[:12], exc
                )
                entry.status = "send_failed"
            else:
                if reply is None:
                    entry.status = "timeout"
                else:
                    entry.status = "responded"
                    entry.scopes = _region_names(reply)
                    poll.responded += 1
            poll.queried += 1

    async def _request_regions(self, public_key: str) -> str | None:
        contact = await ContactRepository.get_by_key(public_key)
        base = contact.to_radio_dict() if contact is not None else None
        was_on_radio = bool(contact is not None and contact.on_radio)
        async with radio_manager.radio_operation(
            "host_repeater_neighbor_regions", suspend_auto_fetch=True
        ) as mc:
            added = await mc.commands.add_contact(_zero_hop_radio_dict(public_key, base))
            if added is not None and added.type == EventType.ERROR:
                raise RuntimeError(f"add_contact failed: {added.payload}")
            try:
                await asyncio.sleep(REGION_SETTLE_SECONDS)
                reply = await mc.commands.req_regions_sync(
                    public_key,
                    timeout=REGION_TIMEOUT_SECONDS,
                    min_timeout=REGION_MIN_TIMEOUT_SECONDS,
                )
            finally:
                try:
                    if was_on_radio and base is not None:
                        await mc.commands.add_contact(base)
                    else:
                        await mc.commands.remove_contact(public_key)
                except Exception:
                    logger.debug(
                        "Restoring radio contact %s failed", public_key[:12], exc_info=True
                    )
        return reply if isinstance(reply, str) and reply else None


neighbor_poller = NeighbourPoller(host_repeater)
