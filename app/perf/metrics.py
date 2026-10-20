"""Bounded metric primitives for the Performance page.

- ``Histogram``: latency histogram in milliseconds with fixed log buckets.
- ``Windowed``: a histogram for the current sampler interval (10 s), swapped
  out by the sampler, plus a rolling last hour.
- ``Rolling``: the last hour as six 10-minute histograms.
- ``RateCounter``: events in the last 60 seconds.
- ``safe``: keeps measuring code from ever breaking the code it measures.
"""

import bisect
import functools
import logging
import math
import time
from collections.abc import Callable
from typing import Any, ParamSpec, TypeVar

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

# Bucket upper edges in milliseconds: 0.05 ms to 60 s, 20% apart (74 buckets).
# A percentile read from a bucket is its upper edge, at most 20% too high,
# which is plenty for a dashboard and keeps per-key memory small.
_GROWTH = 1.2
_EDGES: list[float] = []
_edge = 0.05
while _edge < 60_000:
    _EDGES.append(round(_edge, 4))
    _edge *= _GROWTH
_EDGES.append(60_000.0)
_BUCKETS = len(_EDGES) + 1


class Histogram:
    """Latency histogram in milliseconds with fixed log-scale buckets."""

    __slots__ = ("_counts", "count", "total", "max")

    def __init__(self) -> None:
        self._counts = [0] * _BUCKETS
        self.count = 0
        self.total = 0.0
        self.max: float | None = None

    def record(self, ms: float) -> None:
        if ms < 0 or math.isnan(ms):
            return
        self._counts[bisect.bisect_left(_EDGES, ms)] += 1
        self.count += 1
        self.total += ms
        if self.max is None or ms > self.max:
            self.max = ms

    def percentile(self, p: float) -> float | None:
        """Upper edge of the bucket holding the p-th percentile, capped at the max."""
        if self.count == 0 or self.max is None:
            return None
        rank = max(1, math.ceil(self.count * p / 100))
        seen = 0
        for index, n in enumerate(self._counts):
            seen += n
            if seen >= rank:
                edge = _EDGES[index] if index < len(_EDGES) else self.max
                return min(edge, self.max)
        return self.max

    def merge(self, other: "Histogram") -> None:
        for index, n in enumerate(other._counts):
            if n:
                self._counts[index] += n
        self.count += other.count
        self.total += other.total
        if other.max is not None and (self.max is None or other.max > self.max):
            self.max = other.max

    def summary(self) -> dict[str, float | int | None]:
        return {
            "count": self.count,
            "p50": round_ms(self.percentile(50)),
            "p95": round_ms(self.percentile(95)),
            "max": round_ms(self.max),
            "avg": round_ms(self.total / self.count) if self.count else None,
        }


def round_ms(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2) if value < 100 else round(value, 1)


class Rolling:
    """The last hour as six 10-minute histograms, plus a total since start."""

    SLOT_SECONDS = 600
    SLOTS = 6

    __slots__ = ("_slots", "_slot_ids", "total")

    def __init__(self) -> None:
        self._slots = [Histogram() for _ in range(self.SLOTS)]
        self._slot_ids = [-1] * self.SLOTS
        self.total = 0

    def record(self, ms: float, now: float | None = None) -> None:
        slot_id = int((time.time() if now is None else now) // self.SLOT_SECONDS)
        index = slot_id % self.SLOTS
        if self._slot_ids[index] != slot_id:
            self._slots[index] = Histogram()
            self._slot_ids[index] = slot_id
        self._slots[index].record(ms)
        self.total += 1

    def last_hour(self, now: float | None = None) -> Histogram:
        current = int((time.time() if now is None else now) // self.SLOT_SECONDS)
        merged = Histogram()
        for index in range(self.SLOTS):
            if current - self._slot_ids[index] < self.SLOTS:
                merged.merge(self._slots[index])
        return merged


class Windowed:
    """One series: the current sampler interval and the rolling last hour."""

    __slots__ = ("interval", "hour")

    def __init__(self) -> None:
        self.interval = Histogram()
        self.hour = Rolling()

    def record(self, ms: float) -> None:
        self.interval.record(ms)
        self.hour.record(ms)

    def swap(self) -> Histogram:
        """Hand back the finished interval and start a new one."""
        done = self.interval
        self.interval = Histogram()
        return done


class RateCounter:
    """Events in the last 60 seconds, in one-second slots."""

    __slots__ = ("_counts", "_seconds", "total")

    def __init__(self) -> None:
        self._counts = [0] * 60
        self._seconds = [-1] * 60
        self.total = 0

    def add(self, n: int = 1, now: float | None = None) -> None:
        second = int(time.time() if now is None else now)
        index = second % 60
        if self._seconds[index] != second:
            self._counts[index] = 0
            self._seconds[index] = second
        self._counts[index] += n
        self.total += n

    def last_minute(self, now: float | None = None) -> int:
        second = int(time.time() if now is None else now)
        return sum(
            count
            for count, stamp in zip(self._counts, self._seconds, strict=True)
            if 0 <= second - stamp < 60
        )


def safe(fn: Callable[P, R]) -> Callable[P, R | None]:
    """Run ``fn`` but never let it raise: a metric must not break the app."""

    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R | None:
        try:
            return fn(*args, **kwargs)
        except Exception:
            logger.debug("perf recorder %s failed", fn.__name__, exc_info=True)
            return None

    return wrapper


def top(items: dict[str, Any], key: Callable[[Any], float], limit: int) -> list[tuple[str, Any]]:
    """The ``limit`` largest entries of ``items`` by ``key``."""
    return sorted(items.items(), key=lambda kv: key(kv[1]), reverse=True)[:limit]
