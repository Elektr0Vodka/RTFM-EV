"""Join multi-part ATAK payloads and drop repeated frames.

TAK-MESHCORE splits a frame over several ``UVAX1`` datagrams and a large CoT
event over several fragments; floods and the plugin's own resend deliver the
same frame more than once. In memory only: a restart loses partial parts.
"""

import hashlib
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from app.atak_payloads import CotFragment, EnvelopeChunk


@dataclass
class _Pending:
    created: float
    total: int
    parts: dict[int, bytes] = field(default_factory=dict)


class AtakReassembler:
    def __init__(
        self,
        ttl_s: float = 60.0,
        max_pending: int = 256,
        dedup_ttl_s: float = 120.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_s = ttl_s
        self._max_pending = max_pending
        self._dedup_ttl_s = dedup_ttl_s
        self._clock = clock
        self._pending: dict[tuple, _Pending] = {}
        self._seen: dict[tuple[str, bytes], float] = {}

    def _expire(self, now: float) -> None:
        stale = [k for k, p in self._pending.items() if now - p.created > self._ttl_s]
        for key in stale:
            del self._pending[key]
        old = [k for k, t in self._seen.items() if now - t > self._dedup_ttl_s]
        for key in old:
            del self._seen[key]

    def _add(self, key: tuple, seq: int, total: int, data: bytes) -> bytes | None:
        now = self._clock()
        self._expire(now)
        if total == 1:
            return data
        pending = self._pending.get(key)
        if pending is None:
            while len(self._pending) >= self._max_pending:
                oldest = min(self._pending, key=lambda k: self._pending[k].created)
                del self._pending[oldest]
            pending = self._pending[key] = _Pending(created=now, total=total)
        pending.parts[seq] = data
        if len(pending.parts) < total:
            return None
        del self._pending[key]
        return b"".join(pending.parts[i] for i in range(1, total + 1))

    def add_chunk(self, channel_key: str, chunk: EnvelopeChunk) -> bytes | None:
        """The whole frame once every part of ``chunk.msg_id`` on this channel is in."""
        key = ("env", channel_key, chunk.msg_id, chunk.total)
        return self._add(key, chunk.seq, chunk.total, chunk.data)

    def add_cot_fragment(self, sender: str, frag: CotFragment) -> bytes | None:
        """The whole gzip CoT once every fragment from ``sender`` is in."""
        key = ("cot", sender, frag.frag_id, frag.total)
        return self._add(key, frag.seq, frag.total, frag.data)

    def seen_frame(self, channel_key: str, frame: bytes) -> bool:
        """True when this exact frame was already handled recently; records it otherwise."""
        now = self._clock()
        self._expire(now)
        key = (channel_key, hashlib.sha256(frame).digest())
        if key in self._seen:
            return True
        self._seen[key] = now
        return False

    def forget_frame(self, channel_key: str, frame: bytes) -> None:
        """Undo ``seen_frame`` (the frame could not be stored, so a repeat may try again)."""
        self._seen.pop((channel_key, hashlib.sha256(frame).digest()), None)


atak_reassembler = AtakReassembler()
