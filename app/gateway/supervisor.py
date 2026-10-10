"""Starts, watches and stops one worker process per radio (plan 30).

A worker is the unchanged single-radio app (``uvicorn app.main:app``) on a
loopback port, with its own database, its own transport and a token only the
gateway knows. A worker that exits is started again with a growing delay; the
other radios keep running.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import socket
import sys
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.gateway.registry import RESERVED_ENV, RadioEntry, RadioRegistry
from app.security import WORKER_TOKEN_HEADER

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAX_BACKOFF_SECONDS = 60.0
STOP_GRACE_SECONDS = 10.0
LOG_LINES = 500
_STREAM_LIMIT = 1024 * 1024

CommandFactory = Callable[[RadioEntry, int], list[str]]
HealthCallback = Callable[[int, dict], Awaitable[None]]


def default_command(entry: RadioEntry, port: int) -> list[str]:
    return [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", "127.0.0.1", "--port", str(port),
    ]  # fmt: skip


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def build_worker_env(
    entry: RadioEntry, token: str, base_env: dict[str, str] | None = None
) -> dict[str, str]:
    """The gateway's environment minus what it owns, plus this radio's settings."""
    base = dict(os.environ if base_env is None else base_env)
    env = {k: v for k, v in base.items() if k not in RESERVED_ENV}
    env.update(entry.transport.env())
    env["MESHCORE_DATABASE_PATH"] = entry.database_path
    env["MESHCORE_WORKER_TOKEN"] = token
    env.update(entry.env)
    return env


@dataclass
class Worker:
    radio_id: int
    state: str = "stopped"  # stopped | starting | running | crashed
    desired: bool = False
    port: int = 0
    token: str = ""
    restarts: int = 0
    next_restart_at: float = 0.0
    health: dict | None = None
    process: asyncio.subprocess.Process | None = None
    reader: asyncio.Task | None = None
    log: deque[str] = field(default_factory=lambda: deque(maxlen=LOG_LINES))


class WorkerSupervisor:
    def __init__(
        self,
        registry: RadioRegistry,
        *,
        client: httpx.AsyncClient,
        command_factory: CommandFactory = default_command,
        on_health: HealthCallback | None = None,
        cwd: Path = PROJECT_ROOT,
        clock: Callable[[], float] = time.monotonic,
        poll_interval: float = 2.0,
    ) -> None:
        self._registry = registry
        self._client = client
        self._command_factory = command_factory
        self._on_health = on_health
        self._cwd = cwd
        self._clock = clock
        self._poll_interval = poll_interval
        self._workers: dict[int, Worker] = {}

    def worker(self, radio_id: int) -> Worker:
        return self._workers.setdefault(radio_id, Worker(radio_id))

    def forget(self, radio_id: int) -> None:
        self._workers.pop(radio_id, None)

    def view(self, radio_id: int) -> dict:
        worker = self.worker(radio_id)
        health = worker.health or {}
        identity = health.get("radio_identity") or {}
        return {
            "state": worker.state,
            "restarts": worker.restarts,
            "radio_connected": health.get("radio_connected"),
            "radio_name": identity.get("name"),
        }

    def log_lines(self, radio_id: int, limit: int = 200) -> list[str]:
        return list(self.worker(radio_id).log)[-limit:] if limit > 0 else []

    async def start(self, radio_id: int) -> None:
        worker = self.worker(radio_id)
        worker.desired = True
        worker.restarts = 0
        if worker.process is None or worker.process.returncode is not None:
            await self._spawn(worker)

    async def stop(self, radio_id: int) -> None:
        worker = self.worker(radio_id)
        worker.desired = False
        await self._terminate(worker)
        worker.state = "stopped"

    async def restart(self, radio_id: int) -> None:
        await self.stop(radio_id)
        await self.start(radio_id)

    async def shutdown(self) -> None:
        await asyncio.gather(*(self.stop(radio_id) for radio_id in list(self._workers)))

    async def run(self) -> None:
        """Monitor loop. Cancel it to stop."""
        while True:
            try:
                await self.tick()
            except Exception:
                logger.exception("Worker monitor pass failed")
            await asyncio.sleep(self._poll_interval)

    async def tick(self) -> None:
        """One monitor pass: notice exits, restart after the backoff, probe health."""
        for worker in list(self._workers.values()):
            if not worker.desired:
                continue
            process = worker.process
            if process is not None and process.returncode is not None:
                worker.process = None
                worker.health = None
                worker.state = "crashed"
                worker.restarts += 1
                delay = min(MAX_BACKOFF_SECONDS, 2.0**worker.restarts)
                worker.next_restart_at = self._clock() + delay
                logger.warning(
                    "Radio %d worker exited with code %s, restart in %.0f s",
                    worker.radio_id,
                    process.returncode,
                    delay,
                )
                continue
            if process is None:
                if worker.state == "crashed" and self._clock() >= worker.next_restart_at:
                    await self._spawn(worker)
                continue
            await self._probe(worker)

    async def _spawn(self, worker: Worker) -> None:
        entry = self._registry.get(worker.radio_id)
        if entry is None:
            worker.desired = False
            worker.state = "stopped"
            return
        Path(entry.database_path).parent.mkdir(parents=True, exist_ok=True)
        worker.port = free_port()
        worker.token = secrets.token_urlsafe(32)
        worker.health = None
        worker.process = await asyncio.create_subprocess_exec(
            *self._command_factory(entry, worker.port),
            cwd=str(self._cwd),
            env=build_worker_env(entry, worker.token),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            limit=_STREAM_LIMIT,
        )
        worker.state = "starting"
        worker.reader = asyncio.create_task(self._read_output(worker, worker.process))
        logger.info("Radio %d worker started on port %d", worker.radio_id, worker.port)

    async def _read_output(self, worker: Worker, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        with contextlib.suppress(ValueError):  # a line longer than the stream limit
            async for raw in process.stdout:
                line = raw.decode("utf-8", "replace").rstrip()
                worker.log.append(line)
                print(f"[radio {worker.radio_id}] {line}", flush=True)

    async def _terminate(self, worker: Worker) -> None:
        process = worker.process
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), STOP_GRACE_SECONDS)
            except TimeoutError:
                process.kill()
                await process.wait()
        if worker.reader is not None:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(worker.reader, 2.0)
            worker.reader = None
        worker.process = None
        worker.health = None

    async def _probe(self, worker: Worker) -> None:
        try:
            response = await self._client.get(
                f"http://127.0.0.1:{worker.port}/api/health",
                headers={WORKER_TOKEN_HEADER: worker.token},
                timeout=3.0,
            )
        except httpx.HTTPError:
            return
        if response.status_code != 200:
            return
        health = response.json()
        worker.health = health
        worker.state = "running"
        worker.restarts = 0
        if self._on_health is not None:
            await self._on_health(worker.radio_id, health)
