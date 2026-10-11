"""Keeps the channel list the same on every radio (plan 30, decision D3).

Shared: a channel's key, name and hashtag flag. Everything else about a
channel (favourite, muted, read state, flood scope and path hash overrides,
its messages) stays with the radio.

Adds: the gateway compares the channel lists of all running workers and adds
what is missing. That runs when a worker starts, after a request that changes
channels, and on a timer, so it also covers channels a worker creates on its
own (radio sync, communities).

Deletes cannot be told from "not added yet" by comparing lists, so a delete
only spreads when the gateway sees the request. It is replayed to the other
radios and remembered per radio in ``radios.json`` until it has been applied;
a radio that was stopped at the time gets it when it next runs and cannot
bring the channel back.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from hashlib import sha256

import httpx

from app.gateway.registry import RadioRegistry
from app.gateway.supervisor import Worker
from app.security import WORKER_TOKEN_HEADER

logger = logging.getLogger(__name__)

RECONCILE_INTERVAL_SECONDS = 30.0
_REQUEST_TIMEOUT_SECONDS = 15.0
_KEY = re.compile(r"[0-9A-Fa-f]{32}")
_DELETE_PATH = re.compile(r"api/channels/([0-9A-Fa-f]{32})")
_READ_ONLY = frozenset({"GET", "HEAD", "OPTIONS"})


def changes_channels(method: str, path: str) -> bool:
    """Whether a worker request can add or remove channels."""
    if method in _READ_ONLY:
        return False
    return path == "api/channels" or path.startswith(("api/channels/", "api/communities"))


def deleted_keys(method: str, path: str, body: bytes) -> list[str]:
    """Channel keys a successful worker request deleted."""
    if method == "DELETE":
        match = _DELETE_PATH.fullmatch(path)
        return [match.group(1).upper()] if match else []
    if method == "POST" and path == "api/channels/bulk-delete":
        try:
            keys = json.loads(body).get("keys", [])
        except (ValueError, AttributeError):
            return []
        return [k.upper() for k in keys if isinstance(k, str) and _KEY.fullmatch(k)]
    return []


def _hashtag_key(name: str) -> str:
    """The key a worker derives for a ``#name`` channel (app/routers/channels.py)."""
    return sha256(name.encode("utf-8")).digest()[:16].hex().upper()


class ChannelSync:
    def __init__(
        self,
        registry: RadioRegistry,
        supervisor,
        client: httpx.AsyncClient,
        *,
        interval: float = RECONCILE_INTERVAL_SECONDS,
    ) -> None:
        self._registry = registry
        self._supervisor = supervisor
        self._client = client
        self._interval = interval
        self._wake = asyncio.Event()
        self._lock = asyncio.Lock()
        # (worker token, channel key) that could not be added. The token changes
        # on every worker start, so each run of a worker gets one attempt.
        self._failed_adds: set[tuple[str, str]] = set()
        # Worker token at the last health report, per radio.
        self._worker_runs: dict[int, str] = {}

    def wake(self) -> None:
        """Ask for a reconcile soon (worker started, channels changed)."""
        self._wake.set()

    def note_worker_alive(self, radio_id: int) -> None:
        """Called on every health report. A new token means the worker (re)started,
        which is when its channel list is brought in line."""
        token = self._supervisor.worker(radio_id).token
        if self._worker_runs.get(radio_id) != token:
            self._worker_runs[radio_id] = token
            self.wake()

    def note_deleted(self, origin_id: int, keys: list[str]) -> None:
        """Radio ``origin_id`` deleted these channels: every other radio must too."""
        others = [radio.id for radio in self._registry.radios if radio.id != origin_id]
        if keys and others:
            self._registry.add_pending_channel_deletes(others, keys)
        self.wake()

    async def run(self) -> None:
        """Reconcile on every wake-up and at least every ``interval``. Cancel to stop."""
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), self._interval)
            except TimeoutError:
                pass
            self._wake.clear()
            try:
                await self.reconcile()
            except Exception:
                logger.exception("Channel reconcile failed")

    async def reconcile(self) -> None:
        async with self._lock:
            running: list[tuple[int, Worker]] = []
            for radio in self._registry.radios:
                worker = self._supervisor.worker(radio.id)
                if worker.state == "running":
                    running.append((radio.id, worker))

            for radio_id, worker in running:
                await self._apply_pending_deletes(radio_id, worker)

            lists: dict[int, dict[str, dict]] = {}
            for radio_id, worker in running:
                response = await self._request(worker, "GET", "/api/channels")
                if response is None or response.status_code != 200:
                    continue
                lists[radio_id] = {str(c["key"]).upper(): c for c in response.json()}
            if len(lists) < 2:
                return

            pending = {
                radio.id: set(radio.pending_channel_deletes) for radio in self._registry.radios
            }
            union: dict[str, dict] = {}
            for radio_id, channels in lists.items():
                for key, channel in channels.items():
                    # A channel this radio still has to delete is not offered to others.
                    if key not in pending.get(radio_id, set()):
                        union.setdefault(key, channel)

            for radio_id, worker in running:
                if radio_id not in lists:
                    continue
                missing = [
                    channel
                    for key, channel in union.items()
                    if key not in lists[radio_id]
                    and key not in pending.get(radio_id, set())
                    and (worker.token, key) not in self._failed_adds
                ]
                if missing:
                    await self._add(radio_id, worker, missing)

    async def _apply_pending_deletes(self, radio_id: int, worker: Worker) -> None:
        radio = self._registry.get(radio_id)
        for key in list(radio.pending_channel_deletes) if radio else []:
            response = await self._request(worker, "DELETE", f"/api/channels/{key}")
            # 4xx means the worker will never delete it (the Public channel): done.
            if response is not None and response.status_code < 500:
                self._registry.clear_pending_channel_delete(radio_id, key)
            else:
                logger.warning("Radio %d: delete of channel %s not applied yet", radio_id, key)

    async def _add(self, radio_id: int, worker: Worker, channels: list[dict]) -> None:
        """Create the channels on one worker with the same key, name and hashtag flag."""
        by_import: list[dict] = []
        for channel in channels:
            name = str(channel["name"])
            key = str(channel["key"]).upper()
            if not channel.get("is_hashtag") and not name.startswith("#"):
                body = {"name": name, "key": key}
            elif name.startswith("#") and _hashtag_key(name) == key:
                body = {"name": name}
            else:
                # A hashtag channel whose key is not derived from its name (it was
                # imported). Only the import endpoint takes such a pair.
                by_import.append(channel)
                continue
            response = await self._request(worker, "POST", "/api/channels", json=body)
            if response is None or response.status_code >= 300:
                self._give_up(radio_id, worker, key)

        if by_import:
            text = "".join(f"{c['name']} - {str(c['key']).lower()}\n" for c in by_import)
            response = await self._request(
                worker,
                "POST",
                "/api/channels/import",
                files={"file": ("channels.txt", text.encode("utf-8"), "text/plain")},
            )
            if response is None or response.status_code >= 300:
                for channel in by_import:
                    self._give_up(radio_id, worker, str(channel["key"]).upper())

    def _give_up(self, radio_id: int, worker: Worker, key: str) -> None:
        self._failed_adds.add((worker.token, key))
        logger.warning(
            "Radio %d: could not add channel %s; next attempt when its worker restarts",
            radio_id,
            key,
        )

    async def _request(
        self, worker: Worker, method: str, path: str, **kwargs
    ) -> httpx.Response | None:
        try:
            return await self._client.request(
                method,
                f"http://127.0.0.1:{worker.port}{path}",
                headers={WORKER_TOKEN_HEADER: worker.token},
                timeout=_REQUEST_TIMEOUT_SECONDS,
                **kwargs,
            )
        except httpx.HTTPError:
            return None
