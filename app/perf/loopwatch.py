"""Event-loop lag and stall capture.

A heartbeat task sleeps ``HEARTBEAT_S`` and measures how late it wakes up:
that delay is the event-loop lag, the time a ready task waits to run.

A watchdog thread checks the heartbeat every ``WATCH_S``. When the heartbeat
is overdue the loop is blocked, so the thread reads the loop thread's current
stack (``sys._current_frames()``) and the running task. When the heartbeat
finally runs it records the stall with that stack, which answers "what was
the main process doing".
"""

import asyncio
import logging
import sys
import threading
import time
import traceback
from collections import deque
from pathlib import Path

from app.perf.metrics import Windowed, round_ms

logger = logging.getLogger(__name__)

HEARTBEAT_S = 0.1
WATCH_S = 0.05
# Heartbeat this late (interval plus 80 ms) means the loop is blocked: capture.
CAPTURE_LATE_S = HEARTBEAT_S + 0.08
STALL_MS = 100.0
MAX_FRAMES = 12

_ROOT = str(Path(__file__).resolve().parents[2])


def _short_path(filename: str) -> str:
    normalized = filename.replace("\\", "/")
    root = _ROOT.replace("\\", "/")
    if normalized.startswith(root + "/"):
        return normalized[len(root) + 1 :]
    marker = "site-packages/"
    if marker in normalized:
        return normalized.split(marker, 1)[1]
    return normalized.rsplit("/", 1)[-1]


def format_stack(frame) -> list[str]:
    """Innermost frames first, ``path:line in function``.

    When the innermost frames are all library code (an import, pydantic), the
    innermost ``app/`` frame is added at the end so the line of RTFM-EV that
    led there is always shown.
    """
    lines = [
        f"{_short_path(f.filename)}:{f.lineno} in {f.name}"
        for f in reversed(traceback.extract_stack(frame))
    ]
    shown = lines[:MAX_FRAMES]
    if not any(line.startswith("app/") for line in shown):
        own = next((line for line in lines[MAX_FRAMES:] if line.startswith("app/")), None)
        if own is not None:
            shown.append(own)
    return shown


class LoopWatch:
    def __init__(self) -> None:
        self.lag = Windowed()
        self._stalls: deque[dict] = deque(maxlen=50)
        self._lock = threading.Lock()
        self._beat = time.monotonic()
        self._pending: dict | None = None
        self._task: asyncio.Task | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread_id: int | None = None

    def start(self) -> None:
        if self._task is not None:
            return
        self._loop = asyncio.get_running_loop()
        self._loop_thread_id = threading.get_ident()
        self._beat = time.monotonic()
        self._stop.clear()
        self._task = asyncio.create_task(self._heartbeat(), name="perf.loopwatch")
        self._thread = threading.Thread(target=self._watch, name="perf-watchdog", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._thread is not None:
            self._thread.join(timeout=1)
            self._thread = None

    async def _heartbeat(self) -> None:
        while True:
            before = time.monotonic()
            await asyncio.sleep(HEARTBEAT_S)
            now = time.monotonic()
            lag_ms = max(0.0, (now - before - HEARTBEAT_S) * 1000)
            self.lag.record(lag_ms)
            with self._lock:
                self._beat = now
                pending, self._pending = self._pending, None
            if lag_ms >= STALL_MS:
                self._stalls.append(
                    {
                        "at": time.time() - lag_ms / 1000,
                        "duration_ms": round_ms(lag_ms),
                        "task": pending["task"] if pending else None,
                        "stack": pending["stack"] if pending else [],
                    }
                )
                if lag_ms >= 1000:
                    where = pending["stack"][0] if pending and pending["stack"] else "unknown"
                    logger.warning("Event loop blocked for %.0f ms at %s", lag_ms, where)

    def _watch(self) -> None:
        while not self._stop.wait(WATCH_S):
            try:
                with self._lock:
                    late = time.monotonic() - self._beat
                    if late < CAPTURE_LATE_S or self._pending is not None:
                        continue
                    self._pending = self._capture()
            except Exception:
                logger.debug("perf watchdog capture failed", exc_info=True)

    def _capture(self) -> dict:
        frame = sys._current_frames().get(self._loop_thread_id or -1)
        task_name = None
        if self._loop is not None:
            try:
                task = asyncio.current_task(self._loop)
            except RuntimeError:
                task = None
            if task is not None:
                coro = task.get_coro()
                qualname = getattr(coro, "__qualname__", None)
                task_name = f"{task.get_name()} ({qualname})" if qualname else task.get_name()
        return {"task": task_name, "stack": format_stack(frame) if frame is not None else []}

    def stalls(self, limit: int = 50) -> list[dict]:
        return list(reversed(self._stalls))[:limit]

    def stalls_since(self, ts: float, min_ms: float = STALL_MS) -> list[dict]:
        return [s for s in self._stalls if s["at"] >= ts and (s["duration_ms"] or 0) >= min_ms]


loop_watch = LoopWatch()
