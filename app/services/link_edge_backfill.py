"""One-time backfill of ``link_edge_events`` from packets stored before _107.

Walks raw_packets ids next_id..end_id (set by the migration) in batches,
resolving each stored packet with current node locations. Only the first copy
of each payload was ever stored, so old packets contribute one path each. The
cursor is persisted after every batch, so a restart resumes where it stopped.
"""

import asyncio
import logging

from app.decoder import parse_packet
from app.repository.link_edges import LinkEdgesRepository
from app.services.link_edges import current_self_node, record_packet_edges
from app.services.traffic_links import KnownNode

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000
SELF_WAIT_SECONDS = 30  # retry interval until our own pubkey is known

_task: asyncio.Task | None = None


async def run_backfill_batch(self_node: KnownNode, batch_size: int = BATCH_SIZE) -> bool:
    """Process one batch. Returns True when the backfill is complete."""
    state = await LinkEdgesRepository.backfill_state()
    if state is None:
        return True
    next_id, end_id = state
    if next_id > end_id:
        return True
    rows = await LinkEdgesRepository.raw_packets_batch(
        start_id=next_id, end_id=end_id, limit=batch_size
    )
    if not rows:
        await LinkEdgesRepository.set_backfill_next(end_id + 1)
        return True
    for row in rows:
        await record_packet_edges(
            row.id, row.timestamp, parse_packet(row.data), row.snr, row.rssi, self_node=self_node
        )
    new_next = rows[-1].id + 1
    await LinkEdgesRepository.set_backfill_next(new_next)
    return new_next > end_id


async def _loop() -> None:
    try:
        while True:
            me = current_self_node()
            if me is None:
                await asyncio.sleep(SELF_WAIT_SECONDS)
                continue
            if await run_backfill_batch(me):
                logger.info("Link edge backfill complete")
                return
            await asyncio.sleep(0)  # yield between batches
    except asyncio.CancelledError:
        logger.info("Link edge backfill cancelled")
    except Exception:
        logger.error("Link edge backfill failed", exc_info=True)


def start_link_edge_backfill() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop_link_edge_backfill() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
