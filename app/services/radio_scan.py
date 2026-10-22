"""Scan lists: cycle the companion through user-made radio settings (spec 4.7).

Each entry runs as a temporary radio session (``temp_radio``), so the normal
settings, opt-ins and the restore/reconcile safety all come from there. The
scanner only decides when to move on:

- each entry lasts ``dwell_secs``; with ``hold_on_activity_secs`` a received
  packet keeps the entry going until that long after the last packet;
- ``normal_between_secs`` goes back to the normal settings between entries;
- ``rounds`` passes over the list (0 = until stopped); the end restores normal.

A scan never resumes after a restart or reconnect; the session reconcile puts
the normal settings back instead. Anything that ends the session from outside
(Restore now, expiry, a change made elsewhere) stops the scan.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

from app.models import (
    RadioScanList,
    RadioScanListRequest,
    RadioScanState,
    RadioStampInput,
    TempRadioScanProgress,
    TempRadioSource,
    TempRadioStartRequest,
)

logger = logging.getLogger(__name__)

# The session behind an entry outlives the entry by this much, so the scanner
# (not the session's own expiry) decides when to move on.
SESSION_MARGIN_SECS = 120


class RadioScanService:
    def __init__(self, temp: Any = None) -> None:
        self._temp = temp
        self._state = RadioScanState()
        self._task: asyncio.Task | None = None
        self._stop_requested = False
        self._skip_final_restore = False
        self._internal_switch = False
        self._entry_ends_at = 0.0
        self._hold_secs = 0
        self._wake = asyncio.Event()
        self.clock: Callable[[], float] = time.time
        self.broadcast: Callable[[str, dict], None] = _broadcast

    @property
    def temp(self):
        if self._temp is None:
            from app.services.temp_radio import temp_radio

            self._temp = temp_radio
            temp_radio.on_session_end = self._on_session_end
        return self._temp

    def state(self) -> RadioScanState:
        return self._state

    def _set_state(self, state: RadioScanState) -> None:
        self._state = state
        self.broadcast("radio_scan_state", state.model_dump())

    async def _sleep_until(self, target: float) -> None:
        """Wait until ``target`` or until woken (activity, stop)."""
        timeout = max(0.0, target - self.clock())
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=timeout)
        except TimeoutError:
            pass

    async def _dwell(self) -> None:
        while not self._stop_requested:
            target = self._entry_ends_at
            if self.clock() >= target:
                return
            self._wake.clear()
            await self._sleep_until(target)

    def on_activity(self) -> None:
        """A packet was heard: keep the current entry going (hold on activity)."""
        try:
            state = self._state
            if not state.running or state.on_normal or self._hold_secs <= 0:
                return
            new_end = self.clock() + self._hold_secs
            if new_end > self._entry_ends_at:
                self._entry_ends_at = new_end
                self._state = state.model_copy(update={"entry_ends_at": new_end})
                asyncio.ensure_future(self.temp.extend_to(new_end + SESSION_MARGIN_SECS))
                self._wake.set()
        except Exception:
            logger.debug("Scan activity hook failed", exc_info=True)

    def _on_session_end(self) -> None:
        """The temporary session ended; unless the scanner did it, stop the scan."""
        if self._internal_switch or not self._state.running:
            return
        self._stop_requested = True
        self._wake.set()

    async def _run(self, list_id: int, scan_list: RadioScanListRequest) -> None:
        name = scan_list.name
        entries = scan_list.entries
        self._stop_requested = False
        self._skip_final_restore = False
        self._hold_secs = scan_list.hold_on_activity_secs
        round_no = 0
        try:
            while not self._stop_requested:
                round_no += 1
                if scan_list.rounds and round_no > scan_list.rounds:
                    break
                for index, entry in enumerate(entries):
                    if self._stop_requested:
                        break
                    now = self.clock()
                    self._entry_ends_at = now + entry.dwell_secs
                    progress = TempRadioScanProgress(
                        list_id=list_id,
                        list_name=name,
                        entry_index=index,
                        round=round_no,
                        entry_ends_at=self._entry_ends_at,
                    )
                    self._set_state(
                        RadioScanState(
                            running=True,
                            list_id=list_id,
                            list_name=name,
                            entry_index=index,
                            entry_count=len(entries),
                            round=round_no,
                            rounds=scan_list.rounds,
                            entry_ends_at=self._entry_ends_at,
                        )
                    )
                    request = TempRadioStartRequest(
                        radio=RadioStampInput(**entry.radio.model_dump()),
                        duration_secs=entry.dwell_secs + SESSION_MARGIN_SECS,
                        region=entry.region,
                        opt_ins=scan_list.opt_ins,
                        source=TempRadioSource(kind="scan"),
                    )
                    self._internal_switch = True
                    try:
                        await self.temp.start(request, scan=progress)
                    finally:
                        self._internal_switch = False
                    await self._dwell()
                    if self._stop_requested:
                        break
                    last = (
                        index == len(entries) - 1
                        and bool(scan_list.rounds)
                        and (round_no >= scan_list.rounds)
                    )
                    if scan_list.normal_between_secs > 0 and not last:
                        await self._restore_internal()
                        self._entry_ends_at = self.clock() + scan_list.normal_between_secs
                        self._set_state(
                            self._state.model_copy(
                                update={"on_normal": True, "entry_ends_at": self._entry_ends_at}
                            )
                        )
                        await self._dwell()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Scan %r stopped: %s", name, exc)
        finally:
            if not self._skip_final_restore and self.temp.source_kind() == "scan":
                try:
                    await self._restore_internal()
                except Exception as exc:
                    logger.warning("Restore after scan failed: %s", exc)
            self._set_state(RadioScanState())
            self._task = None

    async def _restore_internal(self) -> None:
        self._internal_switch = True
        try:
            await self.temp.restore()
        finally:
            self._internal_switch = False

    async def start_task(self, scan_list: RadioScanList) -> RadioScanState:
        """Run a saved list in the background, replacing any running scan."""
        await self.stop(restore=False)
        self._state = RadioScanState(running=True, list_id=scan_list.id, list_name=scan_list.name)
        self._task = asyncio.create_task(self._run(scan_list.id, scan_list))
        return self._state

    async def stop(self, *, restore: bool = True) -> RadioScanState:
        """Stop the scan; ``restore`` puts the normal settings back."""
        task = self._task
        if task is None or task.done():
            return self._state
        # Without restore the radio stays as it is for the switch that takes over.
        self._skip_final_restore = not restore
        self._internal_switch = True
        self._stop_requested = True
        self._wake.set()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        finally:
            self._internal_switch = False
        self._task = None
        if restore and self.temp.source_kind() == "scan":
            await self._restore_internal()
        self._skip_final_restore = False
        self._set_state(RadioScanState())
        return self._state

    async def stop_for_other_switch(self, *, restore: bool = False) -> bool:
        """Stop a running scan because another switch takes over. True when one ran."""
        if self._task is None or self._task.done():
            return False
        await self.stop(restore=restore)
        return True


def _broadcast(event: str, data: dict) -> None:
    from app.websocket import broadcast_event

    broadcast_event(event, data)


radio_scan = RadioScanService()
