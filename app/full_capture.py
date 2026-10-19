"""Full capture: frames a meshcomod companion normally drops, pushed as 0xC0.

Stock companions hand the app every valid frame of up to 173 bytes as push
``0x88``. The meshcomod fork (Elektr0Vodka/meshcomod, opt-in command ``0xE0``)
also pushes what it would drop: over-long frames (174-255 bytes), frames with a
CRC or header error, and counts of frames lost to a full receive queue. A
frame that does not fit one push is split in two parts.

Push layout: ``[0xC0][tag][index << 4 | count][status][snr_x4 i8][rssi i8]
[total_len][chunk]``; header 7 bytes, chunk at most 169 bytes, count 1 or 2.
For a drop notice (status 4) ``total_len`` is the number of frames lost since
the previous notice and there is no chunk.

Pure: no I/O. ``app/services/full_capture.py`` wires it to the radio.
"""

from dataclasses import dataclass

FULL_CAPTURE_CMD = 0xE0
FULL_CAPTURE_PUSH = 0xC0

FLAG_LONG = 0x01
FLAG_BAD = 0x02
FLAG_DROPS = 0x04
FLAGS_SUPPORTED = FLAG_LONG | FLAG_BAD | FLAG_DROPS

STATUS_OK = 0  # valid but over-long
STATUS_CRC = 1  # CRC mismatch (RadioLib -7)
STATUS_HEADER = 2  # header damaged (RadioLib -24)
STATUS_READ_ERR = 3  # any other read error
STATUS_DROPS = 4  # drop notice

REASSEMBLY_TIMEOUT_S = 2.0

_HEADER_LEN = 7
_CHUNK_MAX = 169


def build_set_full_capture_frame(flags: int) -> bytes:
    """The ``0xE0`` command; flags the firmware does not know are left out."""
    return bytes([FULL_CAPTURE_CMD, flags & FLAGS_SUPPORTED])


@dataclass(frozen=True)
class CapturePart:
    tag: int
    index: int
    count: int
    status: int
    snr: float
    rssi: int
    total_len: int
    chunk: bytes


@dataclass(frozen=True)
class CapturedFrame:
    status: int
    snr: float
    rssi: int
    data: bytes
    dropped: int | None  # drop notices only


def _int8(b: int) -> int:
    return b - 256 if b >= 128 else b


def parse_part(frame: bytes) -> CapturePart | None:
    """One ``0xC0`` push, or None when it is not a well-formed one."""
    if len(frame) < _HEADER_LEN or frame[0] != FULL_CAPTURE_PUSH:
        return None
    index, count = frame[2] >> 4, frame[2] & 0x0F
    status = frame[3]
    chunk = frame[_HEADER_LEN:]
    if not 1 <= count <= 2 or index >= count or status > STATUS_DROPS:
        return None
    if len(chunk) > _CHUNK_MAX:
        return None
    return CapturePart(
        tag=frame[1],
        index=index,
        count=count,
        status=status,
        snr=_int8(frame[4]) / 4,
        rssi=_int8(frame[5]),
        total_len=frame[6],
        chunk=bytes(chunk),
    )


class Reassembler:
    """Joins two-part frames by tag; parts of one frame may arrive in any order."""

    def __init__(self) -> None:
        # tag -> (first seen, {index: part})
        self._pending: dict[int, tuple[float, dict[int, CapturePart]]] = {}
        self.incomplete_dropped = 0

    def feed(self, part: CapturePart, now: float) -> CapturedFrame | None:
        if part.status == STATUS_DROPS:
            return CapturedFrame(
                status=part.status,
                snr=part.snr,
                rssi=part.rssi,
                data=b"",
                dropped=part.total_len,
            )
        if part.count == 1:
            parts = {0: part}
        else:
            first_seen, parts = self._pending.get(part.tag, (now, {}))
            parts[part.index] = part
            if len(parts) < part.count:
                self._pending[part.tag] = (first_seen, parts)
                return None
            del self._pending[part.tag]
        data = b"".join(parts[i].chunk for i in range(part.count))
        head = parts[0]
        if len(data) != head.total_len or any(
            p.status != head.status or p.total_len != head.total_len for p in parts.values()
        ):
            self.incomplete_dropped += 1
            return None
        return CapturedFrame(
            status=head.status, snr=head.snr, rssi=head.rssi, data=data, dropped=None
        )

    def expire(self, now: float) -> int:
        """Drop frames whose second part did not arrive in time; returns how many."""
        stale = [
            tag
            for tag, (first_seen, _) in self._pending.items()
            if now - first_seen > REASSEMBLY_TIMEOUT_S
        ]
        for tag in stale:
            del self._pending[tag]
        self.incomplete_dropped += len(stale)
        return len(stale)
