"""Host repeater armed mode: the forward scheduler and the only module that sends (plan 29, Phase 3).

Shadow mode (``host_repeater.py``) judges every received frame and never touches the
radio. Armed mode adds this module: when the operator has armed the repeater, every
"would forward" decision becomes a ``ForwardJob`` that is held on the host until its
random retransmit delay has passed, then handed to the firmware with
``CMD_SEND_RAW_PACKET`` (the firmware queues it with the given priority and no delay
of its own).

RF safety, by construction:
- Arming needs the server switch (``MESHCORE_HOST_REPEATER_ENABLED``) AND the admin
  setting AND an explicit confirmation from the operator, plus every capability check
  in ``blockers()``. Nothing arms at startup; a restart always comes up disarmed.
- The engine and the shadow runtime still cannot import the radio; only this module
  can, and it only sends jobs the runtime handed it while ``armed`` was True.
- Automatic disarm (section 10.2 of the plan): radio disconnect, firmware client
  repeat found on, identity or modulation change, send errors, measured duty cycle
  over the sub-band limit, a stuck queue, and the kill switch
  (``POST /radio/host-repeater/disarm``).
- Our own messaging always wins: forwards take the radio lock non-blocking and give
  up at their latency deadline instead of waiting.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from meshcore.events import EventType

from app.radio import RadioDisconnectedError, RadioOperationBusyError
from app.services.host_repeater_engine import Decision, RadioParams
from app.services.host_repeater_link import RadioSnapshot, radio_snapshot
from app.services.host_repeater_settings import sub_band_duty_limit
from app.services.radio_runtime import radio_runtime as radio_manager

if TYPE_CHECKING:
    from app.services.host_repeater import HostRepeaterRuntime

logger = logging.getLogger(__name__)

ERR_CODE_TABLE_FULL = 3
LOCK_RETRY_SECONDS = 0.025
TICK_SECONDS = 0.25
SEND_ERROR_WINDOW = 50
SEND_ERROR_MIN_SAMPLES = 10
SEND_ERROR_RATE_DISARM = 0.20
TABLE_FULL_STREAK_DISARM = 5
QUEUE_STUCK_SECONDS = 60.0
# A raw send is assumed transmitted this long after its modelled airtime.
IN_FLIGHT_MARGIN_MS = 100.0
HOUR_MS = 3_600_000.0

ArmBlocker = Literal[
    "env_switch_off",
    "admin_switch_off",
    "radio_disconnected",
    "identity_unknown",
    "raw_send_unsupported",
    "firmware_repeat_on",
    "openhop",
    "frequency_unknown",
    "sub_band_below_minimum",
]

DisarmReason = Literal[
    "user",
    "radio_disconnected",
    "firmware_repeat_on",
    "identity_changed",
    "radio_settings_changed",
    "send_errors",
    "duty_cycle_exceeded",
    "queue_stuck",
    "shutdown",
]


class ArmRefused(Exception):
    """Arming was refused; ``blockers`` says why (empty when only the confirmation was missing)."""

    def __init__(self, blockers: list[str], *, confirm_missing: bool = False) -> None:
        super().__init__("host repeater cannot arm")
        self.blockers = blockers
        self.confirm_missing = confirm_missing


@dataclass
class ForwardJob:
    forwarded: bytes
    priority: int
    arrival: float
    send_at: float
    deadline: float
    packet_hash: str
    payload_type: str
    airtime_ms: float
    lock_retries: int = 0


class TxStats:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.sent = 0
        self.send_errors = 0
        self.table_full = 0
        self.dropped_queue_full = 0
        self.dropped_too_late = 0
        self.dropped_lock_busy = 0
        self.dropped_disarmed = 0
        self.lock_retries = 0
        self.last_error: str | None = None
        self.last_sent_at: float | None = None
        self.sent_airtime_ms = 0.0


class HostRepeaterTx:
    """Armed-mode state machine and forward scheduler (one instance, ``host_repeater_tx``)."""

    def __init__(self) -> None:
        self._runtime: HostRepeaterRuntime | None = None
        self.armed = False
        self.armed_since: float | None = None
        self.disarm_reason: str | None = None
        self.stats = TxStats()
        self._armed_key: bytes | None = None
        self._armed_radio: RadioParams | None = None
        self._pending_rearm = False
        self._queue: deque[ForwardJob] = deque()
        self._in_flight: deque[float] = deque()
        self._errors: deque[bool] = deque(maxlen=SEND_ERROR_WINDOW)
        self._table_full_streak = 0
        self._queue_full_since: float | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    # ── wiring ───────────────────────────────────────────────────────────

    def attach(self, runtime: HostRepeaterRuntime) -> None:
        self._runtime = runtime
        runtime.attach_tx(self)

    @property
    def runtime(self) -> HostRepeaterRuntime:
        assert self._runtime is not None, "host_repeater_tx is not attached to the runtime"
        return self._runtime

    @property
    def attached_runtime(self) -> HostRepeaterRuntime | None:
        return self._runtime

    @property
    def rearm_pending(self) -> bool:
        return self._pending_rearm

    @property
    def queued(self) -> int:
        return len(self._queue)

    def in_flight(self, now: float) -> int:
        while self._in_flight and self._in_flight[0] <= now:
            self._in_flight.popleft()
        return len(self._in_flight)

    # ── preconditions ────────────────────────────────────────────────────

    def blockers(self, snap: RadioSnapshot) -> list[str]:
        """Why arming is not possible right now (empty list = it is)."""
        rt = self.runtime
        out: list[str] = []
        if not rt.env_enabled:
            out.append("env_switch_off")
        if not rt.settings.admin_enabled:
            out.append("admin_switch_off")
        if not snap.connected:
            out.append("radio_disconnected")
        if snap.public_key is None:
            out.append("identity_unknown")
        if snap.raw_send_supported is not True:
            out.append("raw_send_unsupported")
        if snap.client_repeat:
            out.append("firmware_repeat_on")
        if snap.is_openhop:
            out.append("openhop")
        freq = snap.radio.freq_mhz if snap.radio else None
        limit = sub_band_duty_limit(freq)
        if snap.radio is None or freq is None or limit is None:
            out.append("frequency_unknown")
        elif limit < rt.settings.arm_min_sub_band_percent:
            out.append("sub_band_below_minimum")
        return out

    # ── arm / disarm ─────────────────────────────────────────────────────

    def arm(self, *, confirm: bool, snap: RadioSnapshot | None = None) -> None:
        """Arm live forwarding. Raises ``ArmRefused`` unless confirmed and unblocked."""
        snap = snap or radio_snapshot()
        blockers = self.blockers(snap)
        if blockers:
            raise ArmRefused(blockers)
        if not confirm:
            raise ArmRefused([], confirm_missing=True)
        if self.armed:
            return
        assert snap.radio is not None
        self._pending_rearm = False
        self.armed = True
        self.armed_since = time.time()
        self.disarm_reason = None
        self._armed_key = snap.public_key
        self._armed_radio = snap.radio
        self._errors.clear()
        self._table_full_streak = 0
        self._queue_full_since = None
        self._ensure_task()
        logger.warning(
            "Host repeater ARMED: forwarding on %.3f MHz (sub-band limit %s%%)",
            snap.radio.freq_mhz or 0.0,
            sub_band_duty_limit(snap.radio.freq_mhz),
        )
        self.runtime.broadcast()

    def disarm(self, reason: str, *, rearm_when_reconnected: bool = False) -> None:
        """Stop forwarding now. Pending jobs are dropped; a job already handed to the
        firmware cannot be recalled."""
        was_armed = self.armed
        self.armed = False
        self.armed_since = None
        self._armed_key = None
        self._armed_radio = None
        self._pending_rearm = rearm_when_reconnected
        if self._queue:
            self.stats.dropped_disarmed += len(self._queue)
            self._queue.clear()
        if was_armed or reason == "user":
            self.disarm_reason = reason
        if was_armed:
            logger.warning("Host repeater DISARMED: %s", reason)
        if self._pending_rearm:
            self._ensure_task()
        else:
            self._stop_task()
        if was_armed or reason == "user":
            self.runtime.broadcast()

    async def stop(self) -> None:
        """Process shutdown: disarm and cancel the scheduler."""
        self._pending_rearm = False
        if self.armed:
            self.disarm("shutdown")
        self._stop_task()
        task = self._task
        if task is not None:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    def _ensure_task(self) -> None:
        if self._task is None or self._task.done():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return  # no loop (sync test): the caller drives _tick() by hand
            self._wake = asyncio.Event()
            self._task = loop.create_task(self._run(), name="host_repeater_tx")
        elif self._wake is not None:
            self._wake.set()

    def _stop_task(self) -> None:
        task = self._task
        if task is not None and not task.done():
            task.cancel()
        if self._wake is not None:
            self._wake.set()

    # ── scheduling ───────────────────────────────────────────────────────

    def enqueue(self, decision: Decision, arrival: float, *, now: float | None = None) -> None:
        """Queue a forward decision made while armed. ``arrival`` and ``now`` are monotonic."""
        if not self.armed or not decision.forward or decision.forwarded is None:
            return
        now = time.monotonic() if now is None else now
        settings = self.runtime.settings
        delay_s = (decision.delay_ms or 0.0) / 1000.0
        job = ForwardJob(
            forwarded=decision.forwarded,
            priority=max(0, min(255, decision.priority or 0)),
            arrival=arrival,
            send_at=arrival + delay_s,
            deadline=arrival + delay_s + settings.max_forward_latency_ms / 1000.0,
            packet_hash=decision.packet_hash,
            payload_type=decision.payload_type_name,
            airtime_ms=decision.airtime_ms or 0.0,
        )
        cap = settings.max_pending_forwards
        while len(self._queue) >= cap:
            self._queue.popleft()
            self.stats.dropped_queue_full += 1
        self._queue.append(job)
        if len(self._queue) >= cap:
            self._queue_full_since = self._queue_full_since or now
        else:
            self._queue_full_since = None
        if self._wake is not None:
            self._wake.set()

    async def _run(self) -> None:
        try:
            while self.armed or self._pending_rearm:
                now = time.monotonic()
                await self._tick(now, radio_snapshot())
                wait = TICK_SECONDS
                if self.armed and self._queue:
                    wait = max(0.0, min(wait, min(j.send_at for j in self._queue) - now))
                if self._wake is not None:
                    self._wake.clear()
                    try:
                        await asyncio.wait_for(self._wake.wait(), timeout=wait)
                    except TimeoutError:
                        pass
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Host repeater scheduler crashed; disarming")
            self.disarm("send_errors")

    async def _tick(self, now: float, snap: RadioSnapshot) -> None:
        """One scheduler pass: guards, optional re-arm, then every due job."""
        if self._pending_rearm and not self.armed:
            if not self.blockers(snap):
                logger.info("Host repeater re-arming after reconnect")
                self.arm(confirm=True, snap=snap)
            return
        if not self.armed:
            return
        reason = self._guard(now, snap)
        if reason is not None:
            self.disarm(
                reason,
                rearm_when_reconnected=(
                    reason == "radio_disconnected"
                    and self.runtime.settings.auto_rearm_after_reconnect
                ),
            )
            return
        while self.armed and self._queue and self._queue[0].send_at <= now:
            job = self._queue.popleft()
            self._queue_full_since = None
            if now > job.deadline:
                self.stats.dropped_too_late += 1
                continue
            if self.in_flight(now) >= self.runtime.settings.max_in_flight:
                # The firmware still holds our previous forwards: retry on the next pass.
                self._queue.appendleft(job)
                break
            await self._send(job)
            now = time.monotonic()

    def _guard(self, now: float, snap: RadioSnapshot) -> str | None:
        if not snap.connected:
            return "radio_disconnected"
        if snap.client_repeat:
            return "firmware_repeat_on"
        if snap.public_key is not None and snap.public_key != self._armed_key:
            return "identity_changed"
        if snap.radio is not None and snap.radio != self._armed_radio:
            return "radio_settings_changed"
        if (
            self._queue_full_since is not None
            and now - self._queue_full_since > QUEUE_STUCK_SECONDS
        ):
            return "queue_stuck"
        return None

    async def _send(self, job: ForwardJob) -> None:
        """Hand one job to the firmware, retrying a busy radio lock until the deadline."""
        while self.armed:
            try:
                async with radio_manager.radio_operation(
                    "host_repeater_forward", blocking=False
                ) as mc:
                    result = await mc.commands.send_raw_packet(job.forwarded, job.priority)
            except RadioOperationBusyError:
                job.lock_retries += 1
                self.stats.lock_retries += 1
                if time.monotonic() + LOCK_RETRY_SECONDS > job.deadline:
                    self.stats.dropped_lock_busy += 1
                    return
                await asyncio.sleep(LOCK_RETRY_SECONDS)
                continue
            except RadioDisconnectedError:
                self.disarm(
                    "radio_disconnected",
                    rearm_when_reconnected=self.runtime.settings.auto_rearm_after_reconnect,
                )
                return
            except Exception as exc:
                self._record_send_error(f"{type(exc).__name__}: {exc}", table_full=False)
                return
            self._record_send_result(result, job)
            return

    def _record_send_result(self, result: Any, job: ForwardJob) -> None:
        rtype = getattr(result, "type", None)
        if result is None or rtype == EventType.ERROR:
            payload = getattr(result, "payload", None)
            code = payload.get("error_code") if isinstance(payload, dict) else None
            self._record_send_error(
                f"error_code={code}" if code is not None else "no response",
                table_full=(code == ERR_CODE_TABLE_FULL),
            )
            return
        self.stats.sent += 1
        self.stats.sent_airtime_ms += job.airtime_ms
        self.stats.last_sent_at = time.time()
        self._errors.append(False)
        self._table_full_streak = 0
        done_at = time.monotonic() + (job.airtime_ms + IN_FLIGHT_MARGIN_MS) / 1000.0
        self._in_flight.append(done_at)

    def _record_send_error(self, detail: str, *, table_full: bool) -> None:
        self.stats.send_errors += 1
        self.stats.last_error = detail
        self._errors.append(True)
        if table_full:
            self.stats.table_full += 1
            self._table_full_streak += 1
        else:
            self._table_full_streak = 0
        logger.warning("Host repeater raw send failed: %s", detail)
        if self._table_full_streak >= TABLE_FULL_STREAK_DISARM:
            self.disarm("send_errors")
            return
        if len(self._errors) >= SEND_ERROR_MIN_SAMPLES:
            rate = sum(1 for e in self._errors if e) / len(self._errors)
            if rate > SEND_ERROR_RATE_DISARM:
                self.disarm("send_errors")

    # ── duty-cycle truth check (60 s stats sampler) ──────────────────────

    def on_stats_sample(self, own_tx_last_hour_ms: float, freq_mhz: float | None) -> None:
        """Disarm when the radio's measured TX airtime over the last hour exceeds the
        sub-band limit (the model can be wrong; the firmware counter is the truth)."""
        if not self.armed:
            return
        limit = sub_band_duty_limit(freq_mhz)
        if limit is None:
            return
        if own_tx_last_hour_ms > HOUR_MS * limit / 100.0:
            self.disarm("duty_cycle_exceeded")

    # ── reporting ────────────────────────────────────────────────────────

    def reset_stats(self) -> None:
        self.stats.reset()

    def snapshot(self, now: float | None = None) -> dict[str, Any]:
        now = time.monotonic() if now is None else now
        s = self.stats
        return {
            "armed": self.armed,
            "armed_since": self.armed_since,
            "disarm_reason": self.disarm_reason,
            "rearm_pending": self._pending_rearm,
            "queued": len(self._queue),
            "in_flight": self.in_flight(now),
            "sent": s.sent,
            "sent_airtime_ms": round(s.sent_airtime_ms, 1),
            "send_errors": s.send_errors,
            "table_full": s.table_full,
            "dropped_queue_full": s.dropped_queue_full,
            "dropped_too_late": s.dropped_too_late,
            "dropped_lock_busy": s.dropped_lock_busy,
            "dropped_disarmed": s.dropped_disarmed,
            "lock_retries": s.lock_retries,
            "last_error": s.last_error,
            "last_sent_at": s.last_sent_at,
        }


host_repeater_tx = HostRepeaterTx()


def _attach() -> None:
    # Import here (not at the top) so ``host_repeater`` keeps no reference to this module
    # by name: the runtime only sees the ``ForwardSink`` protocol it declares.
    from app.services.host_repeater import host_repeater

    host_repeater_tx.attach(host_repeater)


_attach()
