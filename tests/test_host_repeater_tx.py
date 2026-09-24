"""Host repeater armed mode: arming preconditions, scheduler, sends, auto-disarm (plan 29, Phase 3).

Every test uses a stubbed radio: ``radio_manager`` and ``radio_snapshot`` in
``host_repeater_tx`` are patched, so nothing here can reach a transport.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from meshcore.events import EventType

from app.radio import RadioDisconnectedError, RadioOperationBusyError
from app.services import host_repeater_tx as tx_module
from app.services.host_repeater import HostRepeaterRuntime
from app.services.host_repeater_engine import Decision, RadioParams
from app.services.host_repeater_link import RadioSnapshot
from app.services.host_repeater_settings import HostRepeaterSettings
from app.services.host_repeater_tx import (
    ArmRefused,
    HostRepeaterTx,
)

RADIO = RadioParams(freq_mhz=869.618, bw_khz=62.5, sf=8, cr=8)
KEY = bytes(range(32))
# Captured before the fixture replaces them, for the one test that runs the real loop.
_ORIG_ENSURE_TASK = HostRepeaterTx._ensure_task
_ORIG_STOP_TASK = HostRepeaterTx._stop_task


def snap(**overrides) -> RadioSnapshot:
    base = {
        "connected": True,
        "public_key": KEY,
        "name": "me",
        "radio": RADIO,
        "firmware_ver_code": 13,
        "device_model": "T-Echo",
        "client_repeat": False,
        "lock_busy": False,
    }
    base.update(overrides)
    return RadioSnapshot(**base)


class FakeRadio:
    """Stands in for ``radio_runtime``: records raw sends, can be busy or error."""

    def __init__(self) -> None:
        self.sent: list[tuple[bytes, int]] = []
        self.busy = False
        self.busy_once = 0
        self.disconnected = False
        self.results: list[object] = []

    @asynccontextmanager
    async def radio_operation(self, name: str, **kwargs):
        assert name == "host_repeater_forward" and kwargs.get("blocking") is False
        if self.busy_once:
            self.busy_once -= 1
            raise RadioOperationBusyError("busy")
        if self.busy:
            raise RadioOperationBusyError("busy")
        if self.disconnected:
            raise RadioDisconnectedError("gone")
        yield SimpleNamespace(commands=SimpleNamespace(send_raw_packet=self._send))

    async def _send(self, data: bytes, priority: int = 0):
        self.sent.append((bytes(data), priority))
        if self.results:
            return self.results.pop(0)
        return SimpleNamespace(type=EventType.OK, payload={})


def ok():
    return SimpleNamespace(type=EventType.OK, payload={})


def err(code: int):
    return SimpleNamespace(type=EventType.ERROR, payload={"error_code": code})


@pytest.fixture
def setup(monkeypatch):
    """Fresh runtime + tx pair wired together, env switch on, admin on, radio stubbed."""
    runtime = HostRepeaterRuntime()
    runtime.settings = HostRepeaterSettings(admin_enabled=True, shadow_enabled=True)
    runtime.loaded = True
    runtime.engine.configure(settings=runtime.settings)
    tx = HostRepeaterTx()
    tx.attach(runtime)
    radio = FakeRadio()
    current = {"snap": snap()}
    monkeypatch.setattr(tx_module, "radio_manager", radio)
    monkeypatch.setattr(tx_module, "radio_snapshot", lambda: current["snap"])
    monkeypatch.setattr(tx_module.HostRepeaterTx, "_ensure_task", lambda self: None)
    monkeypatch.setattr(tx_module.HostRepeaterTx, "_stop_task", lambda self: None)
    with patch.object(runtime, "broadcast"):
        with patch.object(type(runtime), "env_enabled", property(lambda self: True)):
            yield SimpleNamespace(runtime=runtime, tx=tx, radio=radio, current=current)


def forward_decision(payload: bytes = b"\x15\x40\x01\x02\x03", **kw) -> Decision:
    defaults: dict = {
        "forward": True,
        "reason": "flood",
        "packet_hash": "abcd",
        "payload_type": 0x05,
        "route_type": 1,
        "hop_count": 2,
        "rx_len": len(payload),
        "forwarded": payload,
        "priority": 3,
        "delay_ms": 0.0,
        "airtime_ms": 120.0,
    }
    defaults.update(kw)
    return Decision(**defaults)


# ── preconditions ───────────────────────────────────────────────────────


def test_blockers_cover_every_precondition(setup):
    tx = setup.tx
    assert tx.blockers(snap()) == []
    assert tx.blockers(snap(connected=False)) == ["radio_disconnected"]
    assert tx.blockers(snap(public_key=None)) == ["identity_unknown"]
    assert tx.blockers(snap(firmware_ver_code=12)) == ["raw_send_unsupported"]
    assert tx.blockers(snap(firmware_ver_code=None)) == ["raw_send_unsupported"]
    assert tx.blockers(snap(client_repeat=True)) == ["firmware_repeat_on"]
    assert tx.blockers(snap(device_model="OpenHop v1")) == ["openhop"]
    assert tx.blockers(snap(radio=None)) == ["frequency_unknown"]
    assert tx.blockers(snap(radio=RadioParams(915.0, 250.0, 10, 5))) == ["frequency_unknown"]
    # 868.0-868.6 MHz is a 1 % band: allowed at the default minimum, refused above it.
    one_percent = RadioParams(868.2, 250.0, 10, 5)
    assert tx.blockers(snap(radio=one_percent)) == []
    setup.runtime.settings = setup.runtime.settings.model_copy(
        update={"arm_min_sub_band_percent": 5.0}
    )
    assert tx.blockers(snap(radio=one_percent)) == ["sub_band_below_minimum"]


def test_env_and_admin_switches_block_arming(setup):
    tx = setup.tx
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"admin_enabled": False})
    assert tx.blockers(snap()) == ["admin_switch_off"]
    with patch.object(type(setup.runtime), "env_enabled", property(lambda self: False)):
        assert tx.blockers(snap()) == ["env_switch_off", "admin_switch_off"]


def test_arm_needs_confirmation_and_no_blockers(setup):
    tx = setup.tx
    with pytest.raises(ArmRefused) as info:
        tx.arm(confirm=False)
    assert info.value.confirm_missing and info.value.blockers == []
    setup.current["snap"] = snap(client_repeat=True)
    with pytest.raises(ArmRefused) as info:
        tx.arm(confirm=True)
    assert info.value.blockers == ["firmware_repeat_on"] and not tx.armed
    setup.current["snap"] = snap()
    tx.arm(confirm=True)
    assert tx.armed and tx.armed_since is not None and tx.disarm_reason is None
    assert setup.runtime.state == "armed" and setup.runtime.shadow_active
    setup.runtime.broadcast.assert_called()


def test_armed_runs_the_engine_even_with_shadow_off(setup):
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"shadow_enabled": False})
    assert setup.runtime.state == "off" and not setup.runtime.shadow_active
    setup.tx.arm(confirm=True)
    assert setup.runtime.state == "armed" and setup.runtime.shadow_active
    setup.tx.disarm("user")
    assert setup.runtime.state == "off" and not setup.runtime.shadow_active


# ── scheduling and sending ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_nothing_is_sent_unless_armed(setup):
    tx, radio = setup.tx, setup.radio
    tx.enqueue(forward_decision(), arrival=0.0, now=0.0)
    assert tx.queued == 0
    await tx._tick(10.0, snap())
    assert radio.sent == []


@pytest.mark.asyncio
async def test_due_job_is_sent_with_exact_bytes_and_priority(setup):
    tx, radio = setup.tx, setup.radio
    tx.arm(confirm=True)
    tx.enqueue(forward_decision(priority=7, delay_ms=500.0), arrival=100.0, now=100.0)
    assert tx.queued == 1
    await tx._tick(100.4, snap())  # before send_at (100.5): held
    assert radio.sent == [] and tx.queued == 1
    await tx._tick(100.6, snap())
    assert radio.sent == [(b"\x15\x40\x01\x02\x03", 7)] and tx.queued == 0
    assert tx.stats.sent == 1 and tx.stats.sent_airtime_ms == 120.0
    assert tx.snapshot()["sent"] == 1


@pytest.mark.asyncio
async def test_job_past_its_deadline_is_dropped_not_sent(setup):
    tx, radio = setup.tx, setup.radio
    tx.arm(confirm=True)
    # delay 0, max_forward_latency 5000 ms -> deadline = arrival + 5 s
    tx.enqueue(forward_decision(), arrival=0.0, now=0.0)
    await tx._tick(6.0, snap())
    assert radio.sent == [] and tx.stats.dropped_too_late == 1


@pytest.mark.asyncio
async def test_queue_cap_drops_oldest(setup):
    tx = setup.tx
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"max_pending_forwards": 2})
    tx.arm(confirm=True)
    for i in range(3):
        tx.enqueue(forward_decision(payload=bytes([0x15, 0x40, i])), arrival=0.0, now=0.0)
    assert tx.queued == 2 and tx.stats.dropped_queue_full == 1
    assert [j.forwarded[-1] for j in tx._queue] == [1, 2]


@pytest.mark.asyncio
async def test_in_flight_cap_holds_the_next_job(setup):
    tx, radio = setup.tx, setup.radio
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"max_in_flight": 1})
    tx.arm(confirm=True)
    base = time.monotonic()
    tx.enqueue(forward_decision(payload=b"\x15\x40\x01"), arrival=base, now=base)
    tx.enqueue(forward_decision(payload=b"\x15\x40\x02"), arrival=base, now=base)
    await tx._tick(base, snap())
    assert len(radio.sent) == 1 and tx.queued == 1
    # After the modelled airtime + margin (220 ms) the slot frees up.
    await tx._tick(base + 1.0, snap())
    assert len(radio.sent) == 2


@pytest.mark.asyncio
async def test_busy_radio_lock_is_retried_then_given_up_at_deadline(setup):
    tx, radio = setup.tx, setup.radio
    tx.arm(confirm=True)
    radio.busy_once = 2
    tx.enqueue(forward_decision(), arrival=0.0, now=0.0)
    with patch.object(tx_module, "LOCK_RETRY_SECONDS", 0.0):
        with patch.object(tx_module.time, "monotonic", return_value=1.0):
            await tx._tick(1.0, snap())
    assert len(radio.sent) == 1 and tx.stats.lock_retries == 2

    radio.busy = True
    tx.enqueue(forward_decision(), arrival=10.0, now=10.0)  # deadline 15.0
    with patch.object(tx_module, "LOCK_RETRY_SECONDS", 0.0):
        # The tick sees the job as due and in time; the retry clock is already past the deadline.
        with patch.object(tx_module.time, "monotonic", return_value=15.5):
            await tx._tick(14.9, snap())
    assert len(radio.sent) == 1 and tx.stats.dropped_lock_busy == 1 and tx.armed


# ── automatic disarm ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_table_full_streak_disarms(setup):
    tx, radio = setup.tx, setup.radio
    tx.arm(confirm=True)
    radio.results = [err(3)] * 5
    base = time.monotonic()
    for i in range(5):
        tx.enqueue(forward_decision(payload=bytes([0x15, 0x40, i])), arrival=base, now=base)
    await tx._tick(base, snap())
    assert not tx.armed and tx.disarm_reason == "send_errors"
    assert tx.stats.table_full == 5 and tx.stats.send_errors == 5


@pytest.mark.asyncio
async def test_error_rate_over_twenty_percent_disarms(setup):
    tx, radio = setup.tx, setup.radio
    # Lift the in-flight cap so all ten sends happen in one pass.
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"max_in_flight": 16})
    tx.arm(confirm=True)
    # 10 sends: 3 generic errors (30 %) -> over the 20 % threshold once 10 samples exist.
    radio.results = [ok(), err(6), ok(), ok(), err(6), ok(), ok(), ok(), ok(), err(6)]
    base = time.monotonic()
    for i in range(10):
        tx.enqueue(forward_decision(payload=bytes([0x15, 0x40, i])), arrival=base, now=base)
    await tx._tick(base, snap())
    assert not tx.armed and tx.disarm_reason == "send_errors"


@pytest.mark.asyncio
async def test_disconnect_disarms_and_rearms_only_when_opted_in(setup):
    tx = setup.tx
    tx.arm(confirm=True)
    await tx._tick(1.0, snap(connected=False))
    assert not tx.armed and tx.disarm_reason == "radio_disconnected" and not tx.rearm_pending
    await tx._tick(2.0, snap())
    assert not tx.armed  # no opt-in: stays disarmed after reconnect

    setup.runtime.settings = setup.runtime.settings.model_copy(
        update={"auto_rearm_after_reconnect": True}
    )
    tx.arm(confirm=True)
    await tx._tick(3.0, snap(connected=False))
    assert not tx.armed and tx.rearm_pending
    await tx._tick(4.0, snap(connected=False))
    assert not tx.armed
    await tx._tick(5.0, snap())
    assert tx.armed and not tx.rearm_pending

    # The kill switch also cancels a pending re-arm.
    await tx._tick(6.0, snap(connected=False))
    assert tx.rearm_pending
    tx.disarm("user")
    assert not tx.rearm_pending and tx.disarm_reason == "user"


@pytest.mark.asyncio
async def test_firmware_repeat_identity_and_modulation_changes_disarm(setup):
    tx = setup.tx
    tx.arm(confirm=True)
    await tx._tick(1.0, snap(client_repeat=True))
    assert tx.disarm_reason == "firmware_repeat_on"
    tx.arm(confirm=True)
    await tx._tick(2.0, snap(public_key=bytes(32)))
    assert tx.disarm_reason == "identity_changed"
    tx.arm(confirm=True)
    await tx._tick(3.0, snap(radio=RadioParams(869.618, 250.0, 8, 8)))
    assert tx.disarm_reason == "radio_settings_changed"


@pytest.mark.asyncio
async def test_disconnect_during_send_disarms(setup):
    tx, radio = setup.tx, setup.radio
    tx.arm(confirm=True)
    radio.disconnected = True
    tx.enqueue(forward_decision(), arrival=0.0, now=0.0)
    await tx._tick(1.0, snap())
    assert not tx.armed and tx.disarm_reason == "radio_disconnected" and radio.sent == []


def test_measured_duty_cycle_over_sub_band_limit_disarms(setup):
    tx = setup.tx
    tx.arm(confirm=True)
    tx.on_stats_sample(own_tx_last_hour_ms=300_000.0, freq_mhz=869.618)  # 8.3 % of 10 %
    assert tx.armed
    tx.on_stats_sample(own_tx_last_hour_ms=370_000.0, freq_mhz=869.618)  # 10.3 %
    assert not tx.armed and tx.disarm_reason == "duty_cycle_exceeded"


@pytest.mark.asyncio
async def test_stuck_full_queue_disarms(setup):
    tx = setup.tx
    setup.runtime.settings = setup.runtime.settings.model_copy(update={"max_pending_forwards": 1})
    tx.arm(confirm=True)
    # A job whose delay keeps it in the queue for the whole stuck window.
    tx.enqueue(forward_decision(delay_ms=600_000.0), arrival=0.0, now=0.0)
    await tx._tick(30.0, snap())
    assert tx.armed
    await tx._tick(61.0, snap())
    assert not tx.armed and tx.disarm_reason == "queue_stuck"


def test_disarm_drops_pending_jobs_and_admin_off_disarms(setup):
    tx, runtime = setup.tx, setup.runtime
    tx.arm(confirm=True)
    tx.enqueue(forward_decision(delay_ms=5000.0), arrival=0.0, now=0.0)
    assert tx.queued == 1
    tx.disarm("user")
    assert tx.queued == 0 and tx.stats.dropped_disarmed == 1 and tx.disarm_reason == "user"
    assert runtime.public_state()["disarm_reason"] == "user"


@pytest.mark.asyncio
async def test_saving_admin_off_while_armed_disarms(setup, test_db):
    tx, runtime = setup.tx, setup.runtime
    tx.arm(confirm=True)
    new = runtime.settings.model_copy(update={"admin_enabled": False})
    version = await runtime.save(0, new)
    assert version == 1 and not tx.armed and tx.disarm_reason == "user"


# ── the runtime hands forwards to the sender only while armed ───────────


@pytest.mark.asyncio
async def test_runtime_enqueues_forward_decisions_only_when_armed(setup, test_db):
    tx, runtime = setup.tx, setup.runtime
    raw = bytes([0x15, 0x40]) + b"\x01\x02\x03\x04\x05\x06\x07"  # GRP_TXT flood, hops 0
    decision = await runtime.observe(
        raw, snr=1.0, rssi=-90, arrival=time.monotonic(), result={}, pre=None, radio=snap()
    )
    assert decision is not None and decision.forward
    assert tx.queued == 0  # shadow only
    tx.arm(confirm=True)
    runtime.engine.reset_state()
    decision = await runtime.observe(
        raw, snr=1.0, rssi=-90, arrival=time.monotonic(), result={}, pre=None, radio=snap()
    )
    assert decision is not None and decision.forward and tx.queued == 1
    job = tx._queue[0]
    assert job.forwarded == decision.forwarded and job.priority == decision.priority


# ── the scheduler loop itself ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_background_loop_sends_and_stops_on_disarm(setup, monkeypatch):
    tx, radio = setup.tx, setup.radio
    # Restore the real task management for this test only.
    monkeypatch.setattr(tx_module.HostRepeaterTx, "_ensure_task", _ORIG_ENSURE_TASK)
    monkeypatch.setattr(tx_module.HostRepeaterTx, "_stop_task", _ORIG_STOP_TASK)
    monkeypatch.setattr(tx_module, "TICK_SECONDS", 0.01)
    tx.arm(confirm=True)
    assert tx._task is not None and not tx._task.done()
    tx.enqueue(forward_decision(), arrival=asyncio.get_running_loop().time())
    for _ in range(50):
        await asyncio.sleep(0.01)
        if radio.sent:
            break
    assert len(radio.sent) == 1
    await tx.stop()
    assert not tx.armed and tx.disarm_reason == "shutdown" and tx._task is None
