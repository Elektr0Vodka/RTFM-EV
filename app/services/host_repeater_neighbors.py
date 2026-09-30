"""Host repeater neighbours table (DMC observer ``neighbors`` topic). No I/O.

A repeater keeps a table of the repeaters it hears directly: every zero-hop advert
from a repeater (``MyMesh::onAdvertRecv``) and every reply to its own zero-hop
repeater discover (``onControlDataRecv`` ``CTL_TYPE_NODE_DISCOVER_RESP``) updates the
neighbour's SNR and heard time (``putNeighbour``; the least recently heard entry is
replaced once the table is full). The DMC observer then asks every neighbour for its
flood regions and publishes the table.

This module only holds the table. Passive entries come from frames the host
repeater observes; the periodic poll that transmits lives in
``host_repeater_neighbor_poll`` (the only neighbour module allowed near the radio).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

from app.decoder import verify_advert_signature

MAX_NEIGHBOURS = 50  # MAX_NEIGHBOURS on the DMC observer builds
ADV_TYPE_REPEATER = 2
ADVERT_APP_DATA_OFFSET = 32 + 4 + 64  # pub_key + timestamp + signature

PollStatus = Literal["unsent", "responded", "timeout", "send_failed"]


@dataclass
class Neighbour:
    public_key: str
    snr: float | None
    heard_at: float  # wall clock seconds
    scopes: str = ""
    status: PollStatus = "unsent"


@dataclass
class PollState:
    running: bool = False
    last_started: float | None = None
    last_finished: float | None = None
    next_due: float | None = None
    discovered: int = 0
    queried: int = 0
    responded: int = 0
    last_error: str | None = None


@dataclass
class NeighbourTable:
    entries: dict[str, Neighbour] = field(default_factory=dict)
    poll: PollState = field(default_factory=PollState)
    # Bumped when a poll completes; the MQTT publisher sends one message per version.
    version: int = 0

    def put(self, public_key: str, snr: float | None, heard_at: float | None = None) -> None:
        """``putNeighbour``: update a known neighbour, else replace the least recently heard."""
        key = public_key.lower()
        when = heard_at if heard_at is not None else time.time()
        entry = self.entries.get(key)
        if entry is not None:
            entry.snr = snr
            entry.heard_at = when
            return
        if len(self.entries) >= MAX_NEIGHBOURS:
            oldest = min(self.entries.values(), key=lambda e: e.heard_at)
            del self.entries[oldest.public_key]
        self.entries[key] = Neighbour(key, snr, when)

    def ordered(self) -> list[Neighbour]:
        """Newest first, then stronger SNR, then key (``neighborPublishEntryComesBefore``)."""
        return sorted(
            self.entries.values(),
            key=lambda e: (-e.heard_at, -(e.snr if e.snr is not None else -999.0), e.public_key),
        )

    def clear(self) -> None:
        self.entries.clear()
        self.poll = PollState()

    def snapshot(self, now: float | None = None) -> dict[str, Any]:
        wall = now if now is not None else time.time()
        p = self.poll
        return {
            "count": len(self.entries),
            "version": self.version,
            "poll": {
                "running": p.running,
                "last_started": p.last_started,
                "last_finished": p.last_finished,
                "next_due": p.next_due,
                "discovered": p.discovered,
                "queried": p.queried,
                "responded": p.responded,
                "last_error": p.last_error,
            },
            "neighbors": [
                {
                    "pubkey": e.public_key,
                    "snr": e.snr,
                    "heard_secs_ago": max(0, int(wall - e.heard_at)),
                    "scopes": e.scopes,
                    "status": e.status,
                }
                for e in self.ordered()
            ],
        }


def zero_hop_repeater_advert(payload_type: int, hop_count: int, payload: bytes) -> str | None:
    """Public key of a signed zero-hop repeater advert (``onAdvertRecv`` neighbour rule)."""
    if payload_type != 0x04 or hop_count != 0 or len(payload) <= ADVERT_APP_DATA_OFFSET:
        return None
    if (payload[ADVERT_APP_DATA_OFFSET] & 0x0F) != ADV_TYPE_REPEATER:
        return None
    if not verify_advert_signature(payload):
        return None
    return payload[:32].hex()
