"""Spam Guard runtime: feeds the detector, stores it, flags chat, applies rules.

The detector (``app/spam``) is pure. This module is its only owner: it feeds it
every new channel message on a protected channel, runs ``decide``, writes the
spam flag on stored messages, renders the blocks as rules for the forwarding
backend, and keeps the detector's state in the database.

Backend: the host repeater's policy engine on a companion radio. When the
connected radio is an OpenHop node the host repeater does not run and the node
forwards on its own, so the rules are synced into its policy through its API
(``spam_backend_openhop``). Exactly one backend holds our rules at a time.

Nothing here transmits. Protect mode only withholds forwards: on the host
repeater only when it is armed, on an OpenHop node once the rules are synced.

Writes to disk follow the same policy as the reference implementation: at once
for important changes (a real block, a newly known name, a user action),
otherwise at most every few minutes, and at shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import asdict
from typing import Any

from pydantic import ValidationError

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.repository import AppSettingsRepository, MessageRepository
from app.repository.spam import (
    SpamEvidenceRepository,
    SpamGuardConfigRepository,
    SpamGuardStateRepository,
)
from app.services.host_repeater import host_repeater
from app.services.host_repeater_engine import lora_airtime_ms
from app.services.host_repeater_link import radio_snapshot
from app.services.spam_backend_host import HostBackend
from app.services.spam_backend_openhop import FAILURES_BAD, OpenHopBackend
from app.spam.detector import DecideResult, Event, SpamDetector
from app.spam.evidence import label_record, message_record
from app.spam.rules import RuleSet, render
from app.spam.settings import PRESETS, ProtectedChannel, SpamConfig, SpamTunables
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

TICK_SECONDS = 30.0
RECENT_MESSAGES = 100
RECENT_ACTIVITY = 100
# Unimportant changes (duplicate-suppression blocks, counters) wait this long.
LAZY_FLUSH_SECONDS = 300.0


def default_config() -> SpamConfig:
    """Never saved yet: Monitor mode, reading the Public channel only."""
    return SpamConfig(channels=[ProtectedChannel(key=PUBLIC_CHANNEL_KEY, name="Public")])


def split_path(path: str | None, hop_count: int | None) -> list[str]:
    """A stored path (hex) as a list of hop hashes, at the packet's hash width."""
    if not path or hop_count == 0:
        return []
    try:
        raw = bytes.fromhex(path)
    except ValueError:
        return []
    width = len(raw) // hop_count if hop_count and len(raw) % hop_count == 0 else 1
    if width not in (1, 2, 3):
        width = 1
    return [raw[i : i + width].hex().upper() for i in range(0, len(raw), width)]


class SpamGuardRuntime:
    def __init__(
        self, *, clock: Callable[[], float] = time.time, openhop: OpenHopBackend | None = None
    ) -> None:
        self._clock = clock
        self.enabled = False
        self.loaded = False
        self.version = 0
        self.config = default_config()
        self.detector = SpamDetector(self.config, clock=clock)
        self.host = HostBackend()
        self.openhop = openhop or OpenHopBackend()
        # A sync finishes on its own time; the page follows it through the summary.
        self.openhop.on_change = self.broadcast
        self._backend: str | None = None
        self.load_error: str | None = None
        self.last_message_at: float | None = None
        self.last_error: str | None = None
        self._channel_keys: frozenset[str] = frozenset()
        self._channel_names: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._dirty = False
        self._saved_at = 0.0
        self._tick_task: asyncio.Task[None] | None = None
        self._index_channels()

    # ── lifecycle ────────────────────────────────────────────────────────

    def _index_channels(self) -> None:
        self._channel_keys = frozenset(channel.key for channel in self.config.channels)
        self._channel_names = {channel.key: channel.name for channel in self.config.channels}

    async def load(self) -> None:
        settings = await AppSettingsRepository.get()
        stored = await SpamGuardConfigRepository.get()
        self.load_error = None
        if stored is None:
            self.version, self.config = 0, default_config()
        else:
            version, data = stored
            try:
                config = SpamConfig.model_validate(data)
            except ValidationError as exc:
                # Which fields, not their values: a value can be a channel key.
                fields = sorted(
                    {".".join(str(part) for part in error["loc"]) for error in exc.errors()}
                )
                logger.warning(
                    "Stored Spam Guard settings are invalid; using defaults (fields: %s)",
                    ", ".join(fields) or "whole document",
                )
                self.load_error = str(exc)
                config = default_config()
            self.version, self.config = version, config
        self.detector = SpamDetector(self.config, clock=self._clock)
        state = await SpamGuardStateRepository.get()
        if state:
            self.detector.load(state)
        self._index_channels()
        self._saved_at = self._clock()
        self.loaded = True
        await self.set_enabled(settings.spam_guard_enabled)

    async def ensure_loaded(self) -> None:
        if not self.loaded:
            await self.load()

    async def set_enabled(self, enabled: bool) -> None:
        """Follow the master switch: off clears our rules and stops the clock."""
        self.enabled = enabled
        if enabled:
            if self._tick_task is None or self._tick_task.done():
                self._tick_task = asyncio.create_task(self._tick_loop())
        else:
            await self._stop_tick()
            await self.flush(force=True)
        self.apply_rules()
        self.broadcast()

    async def _stop_tick(self) -> None:
        task, self._tick_task = self._tick_task, None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def stop(self) -> None:
        await self._stop_tick()
        # OpenHop rules do not expire by themselves: do not leave ours behind
        # on a node while nothing here is deciding when a block ends.
        await self.openhop.stop()
        await self.flush(force=True)

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            try:
                await self.tick()
            except Exception:
                logger.exception("Spam Guard tick failed")

    async def tick(self) -> None:
        """Expire blocks, settle recent messages and catch up on a radio change."""
        if not self.enabled:
            return
        async with self._lock:
            result = self.detector.decide()
            await self._after_decide(result)
            # Cheap, and it picks up a radio swapped for (or from) an OpenHop node.
            self.apply_rules()
            await self.flush()

    # ── backend ──────────────────────────────────────────────────────────

    def backend_name(self) -> str:
        """``openhop`` when the radio is an OpenHop node, else ``host``.

        The answer only changes while a radio is connected and has said what it
        is. A dropped link to an OpenHop node must not look like a switch to
        the host repeater: the node keeps forwarding, and blocks that end in
        the meantime still have to be taken off it.
        """
        snapshot = radio_snapshot()
        if self._backend is None or (snapshot.connected and snapshot.device_model):
            self._backend = "openhop" if snapshot.is_openhop else "host"
        return self._backend

    def openhop_rules(self, *, preview: bool = False) -> RuleSet:
        """The rule set for an OpenHop node, without private channels not agreed to."""
        return render(
            self.detector, "openhop", preview=preview, channels=self.config.shareable_channels()
        )

    def apply_rules(self) -> None:
        """Hand the current rule set to the active backend and clear the other one.

        The host engine takes it at once. An OpenHop node is synced in the
        background (``OpenHopBackend``); this only says what should be there.
        """
        try:
            backend = self.backend_name() if self.enabled else None
            if backend == "host":
                self.host.apply(render(self.detector, "host"))
            else:
                self.host.clear()
            if backend == "openhop":
                self.openhop.start()
                self.openhop.want(self.openhop_rules())
            else:
                self.openhop.release()
            self.last_error = None
        except Exception as exc:
            # Never leave half a rule set behind: no managed rules is the safe state.
            logger.exception("Spam Guard could not apply its rules")
            self.last_error = str(exc)
            self.host.clear()
            self.openhop.release()

    # ── feed ─────────────────────────────────────────────────────────────

    async def on_channel_message(
        self,
        *,
        message_id: int,
        channel_key: str,
        sender: str | None,
        text: str,
        path: str | None,
        path_len: int | None,
        received_at: int,
        packet_len: int | None = None,
        raw_frame: bool = True,
    ) -> bool:
        """Feed one newly stored channel message. True when it is flagged as spam.

        Called from message ingest before the message is broadcast. Never raises:
        a detector problem must not cost a message.

        ``raw_frame`` is false for a message the radio handed over without its
        raw packet (CHANNEL_MSG_RECV). The host engine never judged such a
        message, so a block it confirms does not count it as caught.
        """
        if not (self.enabled and self.loaded) or channel_key.upper() not in self._channel_keys:
            return False
        try:
            async with self._lock:
                event = self.detector.ingest(
                    ts=float(received_at),
                    path=split_path(path, path_len),
                    sender=sender or "",
                    text=text,
                    channel=channel_key,
                    length=packet_len or 0,
                    message_id=message_id,
                )
                self.last_message_at = self._clock()
                # The host engine judges this frame after ingest, with the rules
                # this call is about to apply; an OpenHop node already forwarded it.
                on_host = raw_frame and self.backend_name() == "host"
                result = self.detector.decide(rematch=event if on_host else None)
                self._count_airtime(event)
                await self._after_decide(result, arriving=message_id)
                if self.detector.tunables.evidence_log:
                    await self._keep_evidence(
                        message_record(
                            event,
                            known=self.detector.is_known(event.sender),
                            channel_name=self._channel_names.get(event.channel, ""),
                        )
                    )
                await self.flush()
                return message_id in result.flag
        except Exception:
            logger.exception("Spam Guard failed on message %s", message_id)
            return False

    def _count_airtime(self, event: Event) -> None:
        """Airtime not spent re-sending a caught message, when we really withheld it."""
        if event.matched is None or self.config.mode != "protect" or self.config.paused:
            return
        if self.backend_name() == "host" and not host_repeater.armed:
            return
        if self.backend_name() == "openhop" and self.openhop.status()["state"] != "synced":
            return
        block = self.detector.blocks.get(event.matched)
        radio = radio_snapshot().radio
        if block is None or block.observe or radio is None or event.length <= 0:
            return
        self.detector.add_airtime(event.ts, lora_airtime_ms(event.length, radio))

    async def _after_decide(self, result: DecideResult, arriving: int | None = None) -> None:
        if result.flag:
            changed = await MessageRepository.set_spam(sorted(result.flag))
            # The arriving message carries its flag in its own broadcast.
            earlier = [message_id for message_id in changed if message_id != arriving]
            if earlier:
                self._broadcast("message_spam", {"message_ids": earlier, "spam": True})
        if result.changed:
            self.apply_rules()
            self._dirty = True
            self.broadcast()
            if result.important:
                await self.flush(force=True)

    # ── settings and actions ─────────────────────────────────────────────

    async def save_config(self, expected_version: int, config: SpamConfig) -> int | None:
        """Persist the settings if ``expected_version`` is current; None on a conflict."""
        async with self._lock:
            await self.ensure_loaded()
            version = await SpamGuardConfigRepository.save(
                expected_version, config.model_dump(mode="json")
            )
            if version is None:
                return None
            self.version, self.config = version, config
            self.detector.configure(config)
            self._index_channels()
            result = self.detector.decide()
            await self._after_decide(result)
            self.apply_rules()
        self.broadcast()
        return version

    async def action(
        self, op: str, body: dict[str, Any], *, message_id: int | None = None
    ) -> dict[str, Any]:
        """Run one user action on the detector. Raises ValueError for bad input.

        ``message_id`` is the stored message a 'This is spam' / 'Not spam' was
        pressed on; its chat flag follows the answer.
        """
        async with self._lock:
            await self.ensure_loaded()
            if op == "not_spam" and message_id is not None and not body.get("matched"):
                body = {**body, "matched": self._block_behind(message_id)}
            outcome = self.detector.action(op, **body)
            if message_id is not None and op in ("mark_spam", "not_spam"):
                await self.set_message_spam(message_id, op == "mark_spam")
                if self.detector.tunables.evidence_log:
                    await self._keep_label(op, body, message_id)
            exceptions = self.detector.exceptions()
            if any(getattr(self.config, name) != values for name, values in exceptions.items()):
                # The action changed an exception list: it is part of the settings.
                config = self.config.model_copy(update=exceptions)
                version = await SpamGuardConfigRepository.save(
                    self.version, config.model_dump(mode="json")
                )
                if version is not None:
                    self.version, self.config = version, config
                    self.detector.configure(config)
            result = self.detector.decide()
            await self._after_decide(result)
            self.apply_rules()
            self._dirty = True
            await self.flush(force=True)
        self.broadcast()
        return outcome

    def _block_behind(self, message_id: int) -> str | None:
        """The text block a 'Not spam' from chat should undo for this message.

        Chat does not know block keys. A block the user made with 'This is
        spam' on this very text comes first, so the two buttons undo each
        other; otherwise the block that caught the message.
        """
        event = next(
            (e for e in reversed(self.detector.events) if e.message_id == message_id), None
        )
        if event is None:
            return None
        for block in self.detector.blocks.values():
            if block.kind == "text" and block.reason == "marked_spam" and block.value in event.text:
                return block.key
        return event.matched

    # ── evidence log ─────────────────────────────────────────────────────

    async def _keep_evidence(self, record: dict[str, Any]) -> None:
        """Write one evidence record. A failure costs the record, nothing else."""
        try:
            await SpamEvidenceRepository.add(record)
        except Exception:
            logger.warning("Could not write a Spam Guard evidence record", exc_info=True)

    async def _keep_label(self, op: str, body: dict[str, Any], message_id: int) -> None:
        """The user's 'This is spam' / 'Not spam' on a message, for replay to score against."""
        event = next(
            (e for e in reversed(self.detector.events) if e.message_id == message_id), None
        )
        if event is not None:
            sender, text, channel = event.sender, event.text, event.channel
        else:
            # Older than the detector's window: take it from the stored message.
            message = await MessageRepository.get_by_id(message_id)
            sender = (message.sender_name if message else None) or str(body.get("sender") or "")
            text = (message.text if message else None) or str(body.get("text") or "")
            channel = (message.conversation_key if message else None) or str(
                body.get("channel") or ""
            )
        await self._keep_evidence(
            label_record(
                ts=self._clock(),
                label="spam" if op == "mark_spam" else "genuine",
                message_id=message_id,
                sender=sender,
                text=text,
                channel=channel,
            )
        )

    async def set_message_spam(self, message_id: int, spam: bool) -> None:
        """A user's 'This is spam' / 'Not spam' on one stored message."""
        changed = await MessageRepository.set_spam([message_id], spam)
        if changed:
            self._broadcast("message_spam", {"message_ids": changed, "spam": spam})

    # ── persistence and broadcasts ───────────────────────────────────────

    async def flush(self, *, force: bool = False) -> bool:
        """Write the detector state when it is due. True when a write happened."""
        if not self._dirty or not self.loaded:
            return False
        now = self._clock()
        if not force and now - self._saved_at < LAZY_FLUSH_SECONDS:
            return False
        try:
            await SpamGuardStateRepository.save(self.detector.dump())
        except Exception:
            logger.warning("Could not save Spam Guard state", exc_info=True)
            return False
        self._dirty = False
        self._saved_at = now
        return True

    def health(self) -> dict[str, Any]:
        """Whether Spam Guard is doing its job: ``off``, ``ok``, ``warn`` or ``bad``."""
        backend = self.backend_name()
        on_openhop = backend == "openhop"
        sync = self.openhop.status()
        status = sync if on_openhop else self.host.status()
        ticking = self._tick_task is not None and not self._tick_task.done()
        protecting = self.config.mode == "protect" and not self.config.paused
        problems: list[str] = []
        warnings: list[str] = []
        if self.enabled:
            if not ticking:
                problems.append("not_running")
            if self.last_error:
                problems.append("rules_failed")
            if not on_openhop and status["rules_expected"] != status["rules_present"]:
                problems.append("rules_missing")
            if on_openhop and sync["failures"] >= FAILURES_BAD:
                problems.append("openhop_sync_failed")
            if self.load_error:
                warnings.append("settings_invalid")
            if protecting and not on_openhop and host_repeater.state != "armed":
                # Protect asks for drops, but nothing is being forwarded to drop.
                warnings.append("host_not_armed")
            if on_openhop and sync["state"] == "refused":
                warnings.append("openhop_spamguard_present")
            if protecting and on_openhop and sync["state"] == "unconfigured":
                # No API url and token: there is no way to put a rule on the node.
                warnings.append("openhop_not_configured")
            if protecting and on_openhop and self.config.private_unshared_channels():
                warnings.append("openhop_key_not_shared")
            if not self.config.channels:
                warnings.append("no_channels")
        state = "off" if not self.enabled else "bad" if problems else "warn" if warnings else "ok"
        return {
            "state": state,
            "problems": problems,
            "warnings": warnings,
            "running": ticking,
            "backend": backend,
            "backend_state": self._backend_state(backend),
            "rules_expected": status["rules_expected"],
            "rules_present": status["rules_present"],
            # OpenHop only: idle / pending / synced / unconfigured / refused / failed,
            # how often our rules had to be put back, and the last good sync.
            "sync_state": sync["state"] if on_openhop else None,
            "repairs": sync["repairs"] if on_openhop else 0,
            "last_sync_at": sync["last_sync_at"] if on_openhop else None,
            "last_message_at": self.last_message_at,
            "last_saved_at": self._saved_at or None,
            # No error text here: ``problems`` and ``warnings`` carry the codes, the
            # text (which can quote stored values or a node URL) goes to the log.
        }

    def _backend_state(self, backend: str) -> str:
        """Host: off / shadow / armed. OpenHop: the state of the rule sync."""
        return host_repeater.state if backend == "host" else self.openhop.status()["state"]

    def snapshot(self) -> dict[str, Any]:
        """Everything the Spam Guard page shows."""
        det = self.detector
        blocks = []
        for block in det.ordered_blocks():
            entry = asdict(block)
            entry["gated"] = det.gated(block)
            entry["mode"] = det.hop_mode(block) if block.kind == "hop" else None
            if block.kind == "suffix":
                entry["allowed_origins"] = sorted(det.allowed_origins(block))
            blocks.append(entry)
        messages = [
            {
                "ts": event.ts,
                "message_id": event.message_id,
                "sender": event.sender,
                "text": event.text,
                "channel": event.channel,
                "path": list(event.path),
                "name_score": event.name_score,
                "random": event.random,
                "disguised": event.disguised,
                "known": det.is_known(event.sender),
                "exempt": event.exempt,
                "matched": event.matched,
                "spam": event.spam,
                "campaign": event.campaign,
            }
            for event in list(det.events)[-RECENT_MESSAGES:]
        ]
        messages.reverse()
        campaigns = [
            {
                "id": cid,
                "senders": len(campaign.senders),
                "messages": len(campaign.events),
                "suspect": campaign.suspect,
                "strong": campaign.strong,
                "confirmed": campaign.confirmed,
                "sample": campaign.events[-1].text[:160],
                "last": campaign.events[-1].ts,
            }
            for cid, campaign in det.campaigns.items()
        ]
        return {
            **self.public_state(),
            "settings": self.config.model_dump(mode="json"),
            "tunables": det.tunables.model_dump(mode="json"),
            "presets": PRESETS,
            "defaults": SpamTunables().model_dump(mode="json"),
            "health": self.health(),
            "metrics": det.metrics(),
            "block_list": blocks,
            "held": list(det.held)[::-1],
            "messages": messages,
            "campaigns": campaigns,
            "activity": list(det.activity)[:RECENT_ACTIVITY],
            "known_names": det.known_names(),
            "suppressed": dict(det.suppressed),
            # Protected channels whose key is a secret: on OpenHop each needs the
            # user's agreement (``share_key``) before a rule may carry it.
            "private_channels": [c.key for c in self.config.channels if not c.key_is_public],
        }

    def public_state(self) -> dict[str, Any]:
        """The small summary pushed over the WebSocket; the API serves the detail."""
        backend = self.backend_name()
        return {
            "enabled": self.enabled,
            "version": self.version,
            "mode": self.config.mode,
            "paused": self.config.paused,
            "backend": backend,
            "backend_state": self._backend_state(backend),
            # Routine duplicate suppression is not counted: there is one such
            # block for nearly every long message, and they last minutes.
            "blocks": sum(1 for b in self.detector.blocks.values() if b.source != "dedupe"),
            "lockdown": "lockdown" in self.detector.blocks,
        }

    def broadcast(self) -> None:
        self._broadcast("spam_guard", self.public_state())

    @staticmethod
    def _broadcast(event: str, data: dict[str, Any]) -> None:
        try:
            broadcast_event(event, data)
        except RuntimeError:
            # No running event loop (sync test context); nothing to notify.
            pass


spam_guard = SpamGuardRuntime()
