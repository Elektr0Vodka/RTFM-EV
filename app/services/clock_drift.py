"""Node clocks, read from the adverts they already send.

An advert payload is ``pub_key || timestamp || signature || app_data``. The
timestamp is the sender's wall clock and is covered by the signature, so it
cannot be changed on the way. Stored next to our receive time, it gives the
node's clock offset without asking the node anything:

    offset = sender_timestamp - first_seen      (positive: the node runs ahead)

A relayed advert is built a little before it is heard, so an in-sync node reads
a few seconds behind; ``IN_SYNC_SECONDS`` absorbs that.

Two uses:

- ``clock_reading``: the offset shown for a contact.
- ``plan_clock_sync``: whether a tracked repeater's clock should be set in a
  telemetry cycle. The firmware only moves a clock forward
  (``CommonCLI.cpp``: ``time <secs>`` answers ``(ERR: clock cannot go
  backwards)`` otherwise), so pushing a wrong host time is not undoable short of
  a ``clkreboot``. Before anything is sent the host clock is therefore compared
  with the mesh: the median offset of the nodes heard in the last day must be
  small. A host that disagrees with most of the mesh is the likelier one to be
  wrong, and nothing is sent.

The advert-timestamp idea and the opt-in sync come from the
``tristandostaler/Remote-Terminal-for-MeshCore`` fork (``0e9be199``,
``e63abb8d``, ``d929000e``). The mesh check and the "only when behind" rule are
this fork's own.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Literal

# Within this many seconds a clock counts as in sync.
IN_SYNC_SECONDS = 120
# A repeater is only set when it is more than this far behind.
SYNC_MIN_BEHIND_SECONDS = 120
# Mesh check: nodes heard in this window, how many are needed, and how far the
# median offset may be from zero before the host clock is distrusted.
CONSENSUS_WINDOW_SECONDS = 24 * 3600
CONSENSUS_MIN_NODES = 5
CONSENSUS_MAX_MEDIAN_SECONDS = 300

ClockState = Literal["in_sync", "ahead", "behind"]
SyncDecision = Literal[
    "sync",
    "no_reading",
    "already_synced",
    "not_behind",
    "ahead",
    "host_clock_unverified",
    "host_clock_disagrees",
]


@dataclass(frozen=True)
class ClockReading:
    offset_seconds: int
    measured_at: int
    state: ClockState


def clock_reading(sender_timestamp: int, first_seen: int) -> ClockReading:
    """The offset of one advert, classified."""
    offset = sender_timestamp - first_seen
    if abs(offset) <= IN_SYNC_SECONDS:
        state: ClockState = "in_sync"
    elif offset > 0:
        state = "ahead"
    else:
        state = "behind"
    return ClockReading(offset_seconds=offset, measured_at=first_seen, state=state)


def mesh_median_offset(readings: list[tuple[str, int, int]], *, exclude: str) -> float | None:
    """Median offset of the other nodes, or None when too few were heard.

    ``readings`` are ``(public_key, sender_timestamp, first_seen)``, one per
    node. The node about to be set is left out: its own wrong clock must not
    vote on whether the host is right.
    """
    skip = exclude.lower()
    offsets = [sender - seen for key, sender, seen in readings if key.lower() != skip]
    if len(offsets) < CONSENSUS_MIN_NODES:
        return None
    return float(median(offsets))


def plan_clock_sync(
    *,
    reading: tuple[int, int] | None,
    last_sync_at: float | None,
    mesh_readings: list[tuple[str, int, int]],
    public_key: str,
) -> SyncDecision:
    """Decide whether to send ``time <now>`` to one opted-in repeater.

    ``reading`` is the repeater's newest ``(sender_timestamp, first_seen)``.
    ``last_sync_at`` is when this process last set that repeater's clock: a
    reading from before it still shows the old clock, so it is not acted on
    twice.
    """
    if reading is None:
        return "no_reading"
    sender_timestamp, first_seen = reading
    if last_sync_at is not None and first_seen <= last_sync_at:
        return "already_synced"

    offset = sender_timestamp - first_seen
    if offset > IN_SYNC_SECONDS:
        return "ahead"
    if offset >= -SYNC_MIN_BEHIND_SECONDS:
        return "not_behind"

    mesh_offset = mesh_median_offset(mesh_readings, exclude=public_key)
    if mesh_offset is None:
        return "host_clock_unverified"
    if abs(mesh_offset) > CONSENSUS_MAX_MEDIAN_SECONDS:
        return "host_clock_disagrees"
    return "sync"


def clock_set_confirmed(reply: str | None) -> bool:
    """Whether a ``time <secs>`` reply says the clock was set.

    Firmware answers ``OK - clock set: HH:MM - D/M/YYYY UTC`` on success and
    ``(ERR: clock cannot go backwards)`` when its clock is already later.
    """
    if not reply:
        return False
    return reply.strip().lstrip("> ").upper().startswith("OK")
