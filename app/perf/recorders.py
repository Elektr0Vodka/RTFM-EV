"""Recorders the hot paths feed. One module-level instance each.

Every public ``record``/``tick`` is cheap (a few dict and list updates) and
never raises into the caller. ``snapshot()`` builds the JSON-ready view the
Performance page reads.
"""

import logging
import sys
import threading
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal

from app.perf.metrics import Histogram, RateCounter, Rolling, Windowed, round_ms, safe, top

# Payload types that carry an encrypted body RTFM-EV tries to decrypt.
_DECRYPTABLE = frozenset({"GROUP_TEXT", "GROUP_DATA", "TEXT_MESSAGE"})
# Per-key tables are capped so a bug that mints keys cannot grow memory.
_MAX_KEYS = 300


def _error_text(exc: BaseException) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return text if len(text) <= 300 else text[:297] + "..."


# ── Background loops ─────────────────────────────────────────────────────


@dataclass
class _LoopState:
    name: str
    every_s: float | None
    running_since: float | None = None
    last_start: float | None = None
    last_duration_ms: float | None = None
    last_ok: bool = True
    runs: int = 0
    errors: int = 0
    last_error: str | None = None
    last_error_at: float | None = None
    durations: Rolling = field(default_factory=Rolling)
    # hour number -> [runs, errors, max_ms]
    hourly: dict[int, list[float]] = field(default_factory=dict)


def overdue_after(every_s: float) -> float:
    """Seconds without a new run before a loop counts as overdue."""
    return max(2 * every_s, every_s + 60)


class LoopRegistry:
    """Liveness of the long-running background loops.

    Wrap one iteration of a loop (not its sleep) in ``tick(name, every_s)``.
    ``every_s`` is how often the loop means to run; ``None`` for a loop that
    only works on demand (never overdue).
    """

    def __init__(self) -> None:
        self._loops: dict[str, _LoopState] = {}

    @contextmanager
    def tick(self, name: str, every_s: float | None) -> Iterator[None]:
        state = self._begin(name, every_s)
        started = time.perf_counter()
        try:
            yield
        except Exception as exc:
            self._end(state, started, exc)
            raise
        except BaseException:
            # Cancelled (shutdown): not a failure, just no longer running.
            if state is not None:
                state.running_since = None
            raise
        else:
            self._end(state, started, None)

    @safe
    def _begin(self, name: str, every_s: float | None) -> _LoopState:
        state = self._loops.get(name)
        if state is None:
            if len(self._loops) >= _MAX_KEYS:
                raise RuntimeError("too many loops")
            state = self._loops[name] = _LoopState(name=name, every_s=every_s)
        state.every_s = every_s
        now = time.time()
        state.running_since = now
        state.last_start = now
        return state

    @safe
    def _end(self, state: _LoopState | None, started: float, exc: BaseException | None) -> None:
        if state is None:
            return
        ms = (time.perf_counter() - started) * 1000
        now = time.time()
        state.running_since = None
        state.last_duration_ms = ms
        state.runs += 1
        state.durations.record(ms, now)
        hour = int(now // 3600)
        cell = state.hourly.setdefault(hour, [0, 0, 0.0])
        cell[0] += 1
        cell[2] = max(cell[2], ms)
        if exc is not None:
            state.errors += 1
            state.last_ok = False
            state.last_error = _error_text(exc)
            state.last_error_at = now
            cell[1] += 1
        else:
            state.last_ok = True
        for old in [h for h in state.hourly if h <= hour - 24]:
            del state.hourly[old]

    def rows(self, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        hour = int(now // 3600)
        rows = []
        for s in self._loops.values():
            threshold = overdue_after(s.every_s) if s.every_s else None
            if s.running_since is not None:
                stuck = threshold is not None and now - s.running_since > threshold
                state = "overdue" if stuck else "running"
            elif threshold is not None and s.last_start is not None:
                state = "overdue" if now - s.last_start > threshold else "ok"
            else:
                state = "idle"
            if state in ("ok", "idle") and not s.last_ok:
                state = "error"
            hist = s.durations.last_hour(now)
            rows.append(
                {
                    "name": s.name,
                    "state": state,
                    "every_s": s.every_s,
                    "running_since": s.running_since,
                    "last_start": s.last_start,
                    "last_duration_ms": round_ms(s.last_duration_ms),
                    "p95_ms": round_ms(hist.percentile(95)),
                    "runs": s.runs,
                    "errors": s.errors,
                    "last_error": s.last_error,
                    "last_error_at": s.last_error_at,
                    "hourly": [_hour_cell(s.hourly.get(h)) for h in range(hour - 23, hour + 1)],
                }
            )
        rows.sort(key=lambda r: r["name"])
        return rows


def _hour_cell(cell: list[float] | None) -> dict:
    if cell is None:
        return {"runs": 0, "errors": 0, "max_ms": None}
    return {"runs": int(cell[0]), "errors": int(cell[1]), "max_ms": round_ms(cell[2])}


# ── Packet pipeline ──────────────────────────────────────────────────────

_STAGES = ("parse", "store", "process", "broadcast", "total")


class PipelineRecorder:
    """Per-packet stage timings and outcomes from ``process_raw_packet``."""

    def __init__(self) -> None:
        self.stages = {name: Windowed() for name in _STAGES}
        self.received = RateCounter()
        self.duplicate = RateCounter()
        self.decrypted = RateCounter()
        self.undecrypted = RateCounter()
        self.malformed = RateCounter()
        self.interval_count = 0
        # type -> [count, total_ms] since start
        self._by_type: dict[str, list[float]] = {}

    @safe
    def record(
        self,
        *,
        payload_type: str,
        parse_ms: float,
        store_ms: float,
        process_ms: float,
        broadcast_ms: float,
        is_new: bool,
        decrypted: bool,
        malformed: bool,
    ) -> None:
        total = parse_ms + store_ms + process_ms + broadcast_ms
        for name, ms in (
            ("parse", parse_ms),
            ("store", store_ms),
            ("process", process_ms),
            ("broadcast", broadcast_ms),
            ("total", total),
        ):
            self.stages[name].record(ms)
        self.received.add()
        self.interval_count += 1
        if not is_new:
            self.duplicate.add()
        if decrypted:
            self.decrypted.add()
        elif payload_type in _DECRYPTABLE:
            self.undecrypted.add()
        if malformed:
            self.malformed.add()
        entry = self._by_type.get(payload_type)
        if entry is None and len(self._by_type) < _MAX_KEYS:
            entry = self._by_type[payload_type] = [0, 0.0]
        if entry is not None:
            entry[0] += 1
            entry[1] += process_ms

    def take_interval_count(self) -> int:
        count, self.interval_count = self.interval_count, 0
        return count

    def snapshot(self) -> dict:
        return {
            "per_minute": {
                "received": self.received.last_minute(),
                "duplicate": self.duplicate.last_minute(),
                "decrypted": self.decrypted.last_minute(),
                "undecrypted": self.undecrypted.last_minute(),
                "malformed": self.malformed.last_minute(),
            },
            "total_received": self.received.total,
            "stages": {name: w.hour.last_hour().summary() for name, w in self.stages.items()},
            "by_type": [
                {
                    "type": name,
                    "count": int(v[0]),
                    "avg_process_ms": round_ms(v[1] / v[0]) if v[0] else None,
                }
                for name, v in top(self._by_type, lambda v: v[0], 20)
            ],
        }


# ── Database ─────────────────────────────────────────────────────────────

_SKIP_FILES = ("contextlib.py",)
_SKIP_PARTS = ("app/database.py", "app\\database.py", "app/perf/", "app\\perf\\")


def caller_name() -> str:
    """``Module.function`` of the first frame outside the DB and perf layers."""
    frame = sys._getframe(1)
    while frame is not None:
        filename = frame.f_code.co_filename
        if not filename.endswith(_SKIP_FILES) and not any(p in filename for p in _SKIP_PARTS):
            qualname = frame.f_code.co_qualname
            if "." in qualname and "<locals>" not in qualname:
                return qualname
            module = str(frame.f_globals.get("__name__", "")).rsplit(".", 1)[-1]
            return f"{module}.{qualname.rsplit('.', 1)[-1]}" if module else qualname
        frame = frame.f_back
    return "unknown"


@dataclass
class _CallStats:
    hold: Rolling = field(default_factory=Rolling)
    wait: Rolling = field(default_factory=Rolling)
    calls: int = 0
    errors: int = 0
    kind: str = "read"


class DbCallRecorder:
    """Time spent waiting for and holding database connections, per caller."""

    def __init__(self) -> None:
        self.read_hold = Windowed()
        self.read_wait = Windowed()
        self.write_hold = Windowed()
        self.write_wait = Windowed()
        self.calls = RateCounter()
        self._callers: dict[str, _CallStats] = {}

    @safe
    def record(
        self,
        kind: Literal["read", "write"],
        caller: str,
        *,
        wait_ms: float,
        hold_ms: float,
        error: bool,
    ) -> None:
        if kind == "write":
            self.write_hold.record(hold_ms)
            self.write_wait.record(wait_ms)
        else:
            self.read_hold.record(hold_ms)
            self.read_wait.record(wait_ms)
        self.calls.add()
        stats = self._callers.get(caller)
        if stats is None:
            if len(self._callers) >= _MAX_KEYS:
                caller = "other"
                stats = self._callers.setdefault(caller, _CallStats())
            else:
                stats = self._callers[caller] = _CallStats(kind=kind)
        stats.hold.record(hold_ms)
        stats.wait.record(wait_ms)
        stats.calls += 1
        if error:
            stats.errors += 1

    @safe
    def record_here(
        self, kind: Literal["read", "write"], *, wait_ms: float, hold_ms: float, error: bool
    ) -> None:
        """``record`` for the function that opened the connection block."""
        self.record(kind, caller_name(), wait_ms=wait_ms, hold_ms=hold_ms, error=error)

    def interval_p95(self) -> float | None:
        merged = Histogram()
        merged.merge(self.read_hold.swap())
        merged.merge(self.write_hold.swap())
        self.read_wait.swap()
        self.write_wait.swap()
        return merged.percentile(95)

    def snapshot(self, limit: int = 15) -> dict:
        now = time.time()
        rows = []
        for caller, s in self._callers.items():
            hour = s.hold.last_hour(now)
            if hour.count == 0:
                continue
            rows.append(
                {
                    "caller": caller,
                    "kind": s.kind,
                    "calls_last_hour": hour.count,
                    "p95_ms": round_ms(hour.percentile(95)),
                    "max_ms": round_ms(hour.max),
                    "wait_p95_ms": round_ms(s.wait.last_hour(now).percentile(95)),
                    "errors": s.errors,
                }
            )
        rows.sort(key=lambda r: r["p95_ms"] or 0, reverse=True)
        return {
            "calls_per_minute": self.calls.last_minute(),
            "read": {
                "hold": self.read_hold.hour.last_hour(now).summary(),
                "wait": self.read_wait.hour.last_hour(now).summary(),
            },
            "write": {
                "hold": self.write_hold.hour.last_hour(now).summary(),
                "wait": self.write_wait.hour.last_hour(now).summary(),
            },
            "slowest": rows[:limit],
        }


# ── Radio link ───────────────────────────────────────────────────────────


@dataclass
class _OpStats:
    hold: Rolling = field(default_factory=Rolling)
    wait: Rolling = field(default_factory=Rolling)
    calls: int = 0
    errors: int = 0
    last_error: str | None = None


class RadioOpRecorder:
    """Radio operations: lock wait and time holding the radio, per operation name."""

    def __init__(self) -> None:
        self.hold = Windowed()
        self._ops: dict[str, _OpStats] = {}
        self.reconnect_attempts = 0
        self.reconnect_ok = 0
        self.last_reconnect_at: float | None = None

    @safe
    def record(
        self,
        name: str,
        *,
        wait_ms: float,
        hold_ms: float,
        error: bool,
        error_text: str | None = None,
    ) -> None:
        self.hold.record(hold_ms)
        stats = self._ops.get(name)
        if stats is None:
            if len(self._ops) >= _MAX_KEYS:
                return
            stats = self._ops[name] = _OpStats()
        stats.hold.record(hold_ms)
        stats.wait.record(wait_ms)
        stats.calls += 1
        if error:
            stats.errors += 1
            stats.last_error = error_text

    @safe
    def note_reconnect(self, *, ok: bool) -> None:
        self.reconnect_attempts += 1
        if ok:
            self.reconnect_ok += 1
        self.last_reconnect_at = time.time()

    def snapshot(self, limit: int = 15) -> dict:
        now = time.time()
        ops = []
        for name, s in self._ops.items():
            hour = s.hold.last_hour(now)
            ops.append(
                {
                    "name": name,
                    "calls_last_hour": hour.count,
                    "calls": s.calls,
                    "p95_ms": round_ms(hour.percentile(95)),
                    "max_ms": round_ms(hour.max),
                    "wait_p95_ms": round_ms(s.wait.last_hour(now).percentile(95)),
                    "errors": s.errors,
                    "last_error": s.last_error,
                }
            )
        ops.sort(key=lambda r: r["p95_ms"] or 0, reverse=True)
        return {
            "hold": self.hold.hour.last_hour(now).summary(),
            "ops": ops[:limit],
            "errors": sum(s.errors for s in self._ops.values()),
            "reconnects": {"attempts": self.reconnect_attempts, "ok": self.reconnect_ok},
            "last_reconnect_at": self.last_reconnect_at,
        }


# ── Outputs (fanout modules) ─────────────────────────────────────────────


@dataclass
class _OutputStats:
    latency: Rolling = field(default_factory=Rolling)
    ok: int = 0
    timeouts: int = 0
    errors: int = 0
    last_at: float | None = None


class OutputRecorder:
    """Fanout dispatches per module: how many, how long, how many failed."""

    def __init__(self) -> None:
        self._outputs: dict[str, _OutputStats] = {}

    @safe
    def record(self, config_id: str, ms: float, outcome: Literal["ok", "timeout", "error"]) -> None:
        stats = self._outputs.get(config_id)
        if stats is None:
            if len(self._outputs) >= _MAX_KEYS:
                return
            stats = self._outputs[config_id] = _OutputStats()
        stats.latency.record(ms)
        stats.last_at = time.time()
        if outcome == "ok":
            stats.ok += 1
        elif outcome == "timeout":
            stats.timeouts += 1
        else:
            stats.errors += 1

    def snapshot(self) -> dict[str, dict]:
        now = time.time()
        result = {}
        for config_id, s in self._outputs.items():
            hour = s.latency.last_hour(now)
            result[config_id] = {
                "sent_last_hour": hour.count,
                "p95_ms": round_ms(hour.percentile(95)),
                "ok": s.ok,
                "timeouts": s.timeouts,
                "errors": s.errors,
                "last_at": s.last_at,
            }
        return result


# ── HTTP API routes ──────────────────────────────────────────────────────


@dataclass
class _RouteStats:
    latency: Rolling = field(default_factory=Rolling)
    calls: int = 0
    errors_5xx: int = 0


class RouteRecorder:
    """API requests per route template."""

    def __init__(self) -> None:
        self.latency = Windowed()
        self._routes: dict[str, _RouteStats] = {}

    @safe
    def record(self, method: str, template: str, ms: float, status: int) -> None:
        self.latency.record(ms)
        key = f"{method} {template}"
        stats = self._routes.get(key)
        if stats is None:
            if len(self._routes) >= _MAX_KEYS:
                return
            stats = self._routes[key] = _RouteStats()
        stats.latency.record(ms)
        stats.calls += 1
        if status >= 500:
            stats.errors_5xx += 1

    def snapshot(self, limit: int = 25) -> dict:
        now = time.time()
        rows = []
        for key, s in self._routes.items():
            hour = s.latency.last_hour(now)
            if hour.count == 0:
                continue
            rows.append(
                {
                    "route": key,
                    "calls": hour.count,
                    "p50_ms": round_ms(hour.percentile(50)),
                    "p95_ms": round_ms(hour.percentile(95)),
                    "max_ms": round_ms(hour.max),
                    "errors_5xx": s.errors_5xx,
                }
            )
        rows.sort(key=lambda r: r["calls"], reverse=True)
        return {"all": self.latency.hour.last_hour(now).summary(), "routes": rows[:limit]}


# ── Warnings and errors from the log ─────────────────────────────────────


class PerfLogHandler(logging.Handler):
    """Keeps the newest WARNING+ records for the Logs tab.

    It sees records after the logger's own filters ran, so the meshcore CLI
    secret redaction (``CliSecretRedactFilter``) has already applied, the
    same as for the ``/api/debug`` ring buffer.
    """

    def __init__(self, max_records: int = 200) -> None:
        super().__init__(level=logging.WARNING)
        self._records: deque[dict] = deque(maxlen=max_records)
        self._lock_records = threading.Lock()
        self.warnings = RateCounter()
        self.interval_count = 0

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        exc = record.exc_info[1] if record.exc_info else None
        if exc is not None and str(exc) not in message:
            message = f"{message} ({_error_text(exc)})"
        if len(message) > 1000:
            message = message[:997] + "..."
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }
        with self._lock_records:
            self._records.append(entry)
            self.warnings.add(now=record.created)
            self.interval_count += 1

    def records(self, limit: int = 200) -> list[dict]:
        with self._lock_records:
            return list(reversed(self._records))[:limit]

    def take_interval_count(self) -> int:
        with self._lock_records:
            count, self.interval_count = self.interval_count, 0
            return count


loops = LoopRegistry()
pipeline = PipelineRecorder()
db_calls = DbCallRecorder()
radio_ops = RadioOpRecorder()
outputs = OutputRecorder()
routes = RouteRecorder()
log_tail = PerfLogHandler()
