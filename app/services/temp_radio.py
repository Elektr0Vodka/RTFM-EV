"""Temporary radio settings for the connected companion (spec 2026-10-22).

Companion firmware has no ``tempradio`` command (only repeaters and room
servers do), so a temporary change is emulated: RTFM stores the normal
settings, applies the temporary ones with ``CMD_SET_RADIO_PARAMS`` (live, no
reboot) and applies the normal ones again when the session ends. The firmware
writes both to flash, so the session is persisted and reconciled on every
connect: a restart or a dropped link must never strand the companion.

Reconcile rules on connect (spec 5.2), keyed on the companion's public key:
- another companion: leave the session alone, it is not this radio's;
- radio on the temporary settings: resume the timer, or restore when expired;
- radio on the normal settings: the session is over, clear it;
- anything else: changed elsewhere, drop the session and never overwrite.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

from app import radio_stamp
from app.models import (
    RadioStamp,
    TempRadioScanProgress,
    TempRadioSource,
    TempRadioStartRequest,
    TempRadioState,
)
from app.region_scope import normalize_region_scope
from app.repository import AppSettingsRepository
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)


class TempRadioUnavailableError(RuntimeError):
    """The radio is not connected, or its current settings are unknown."""


class TempRadioConflictError(RuntimeError):
    """The session belongs to a different companion than the one connected."""


# Seconds between restore attempts after a failed restore on a connected radio.
RESTORE_RETRY_SECS = 30.0


def normalize_session_region(region: str | None) -> str | None:
    """Request region -> session region: blank means 'leave it', '*' means unscoped."""
    if region is None:
        return None
    stripped = region.strip()
    if not stripped:
        return None
    if stripped == "*":
        return "*"
    return normalize_region_scope(stripped) or None


class TempRadioService:
    def __init__(self) -> None:
        self._state = TempRadioState()
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.clock: Callable[[], float] = time.time
        self.retry_secs: float = RESTORE_RETRY_SECS
        self.broadcast: Callable[[str, dict], None] = _broadcast
        # Called with no arguments whenever a session ends; the scanner hooks in here.
        self.on_session_end: Callable[[], None] | None = None

    # ── radio access (replaced in tests) ─────────────────────────────────

    def _current(self) -> RadioStamp | None:
        return radio_stamp.current_radio_stamp()

    def _client_repeat(self) -> bool | None:
        return radio_manager.client_repeat

    def _connected_key(self) -> str | None:
        if not radio_manager.is_connected:
            return None
        info = getattr(radio_manager.meshcore, "self_info", None) or {}
        key = info.get("public_key")
        return key.lower() if isinstance(key, str) and key else None

    async def _apply_radio(self, stamp: RadioStamp, repeat: bool | None) -> None:
        from app.radio_sync import sync_radio_time
        from app.routers.radio import RadioConfigUpdate, RadioSettings
        from app.services.radio_commands import apply_radio_config_update

        update = RadioConfigUpdate(
            radio=RadioSettings(freq=stamp.freq, bw=stamp.bw, sf=stamp.sf, cr=stamp.cr)
        )
        async with radio_manager.radio_operation("temp_radio_settings") as mc:
            await apply_radio_config_update(
                mc,
                update,
                path_hash_mode_supported=radio_manager.path_hash_mode_supported,
                set_path_hash_mode=lambda mode: setattr(radio_manager, "path_hash_mode", mode),
                sync_radio_time_fn=sync_radio_time,
                firmware_ver_code=radio_manager.firmware_ver_code,
                client_repeat=radio_manager.client_repeat,
                allowed_repeat_freqs=radio_manager.allowed_repeat_freqs,
                set_client_repeat=lambda value: setattr(radio_manager, "client_repeat", value),
                repeat_override=repeat,
            )

    async def _apply_region(self, region: str | None) -> None:
        """Put a session region on the radio; None puts the saved app setting back."""
        from app.services.flood_scope import set_radio_flood_scope

        if region is None:
            settings = await AppSettingsRepository.get()
            scope = normalize_region_scope(settings.flood_scope)
        else:
            scope = "" if region == "*" else region
        async with radio_manager.radio_operation("temp_radio_region") as mc:
            await set_radio_flood_scope(mc, scope, fw_ver=radio_manager.firmware_ver_code)

    def _schedule(self) -> None:
        """(Re)start the expiry task for the current session."""
        self._cancel_task()
        if not self._state.active or self._state.expires_at is None:
            return
        self._task = asyncio.create_task(self._expiry_loop(self._state.expires_at))

    # ── state ────────────────────────────────────────────────────────────

    async def load(self) -> None:
        """Read the stored session (backend startup). The radio is not touched here."""
        stored = await AppSettingsRepository.get_temp_radio_state()
        self._state = stored if stored is not None else TempRadioState()

    async def get_state(self) -> TempRadioState:
        return self._state

    def state(self) -> TempRadioState:
        return self._state

    def _owned(self) -> bool:
        """A session runs and it belongs to the companion that is connected now."""
        state = self._state
        return state.active and state.companion_key == self._connected_key()

    def session_active(self) -> bool:
        return self._owned()

    def opted_in(self, item: str) -> bool:
        """Whether an automatic sender may run now (always outside this radio's session)."""
        if not self._owned():
            return True
        return bool(getattr(self._state.opt_ins, item, False))

    def fanout_allowed(self, config_id: str) -> bool:
        if not self._owned():
            return True
        return config_id in self._state.opt_ins.fanout_ids

    def session_region(self) -> str | None:
        """The session's region ('*' = unscoped), or None when the region is untouched."""
        return self._state.region if self._owned() else None

    async def _save(self, state: TempRadioState) -> None:
        self._state = state
        await AppSettingsRepository.set_temp_radio_state(state if state.active else None)
        self.broadcast("temp_radio_state", state.model_dump())

    async def _clear(self) -> None:
        self._cancel_task()
        await self._save(TempRadioState())
        if self.on_session_end is not None:
            self.on_session_end()

    def _cancel_task(self) -> None:
        task = self._task
        self._task = None
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()

    # ── session ──────────────────────────────────────────────────────────

    async def start(
        self,
        req: TempRadioStartRequest,
        *,
        scan: TempRadioScanProgress | None = None,
    ) -> TempRadioState:
        """Switch to ``req.radio`` for ``req.duration_secs``; keeps the original if active."""
        async with self._lock:
            return await self._start_locked(req, scan=scan)

    async def _start_locked(
        self, req: TempRadioStartRequest, *, scan: TempRadioScanProgress | None
    ) -> TempRadioState:
        key = self._connected_key()
        current = self._current()
        if key is None or current is None:
            raise TempRadioUnavailableError("Radio not connected or its settings are unknown")

        previous = self._state if self._state.active else None
        if previous is not None and previous.companion_key != key:
            raise TempRadioConflictError(
                "A temporary session of another companion is still pending"
            )
        now = self.clock()
        region = normalize_session_region(req.region)
        temp = RadioStamp(**req.radio.model_dump())
        if previous is not None:
            original = previous.original
            original_repeat = previous.original_repeat
        else:
            original = current
            original_repeat = self._client_repeat()

        state = TempRadioState(
            active=True,
            companion_key=key,
            original=original,
            temp=temp,
            region=region,
            original_repeat=original_repeat,
            prev_temp=previous.temp if previous is not None else None,
            opt_ins=req.opt_ins,
            source=req.source,
            started_at=previous.started_at if previous is not None else now,
            expires_at=now + req.duration_secs,
            restore_pending=False,
            scan=scan,
        )
        # Persist first: a crash between this and the radio command still
        # reconciles on the next connect.
        await self._save(state)

        repeat = bool(original_repeat) if req.opt_ins.client_repeat else False
        if original_repeat is None:
            repeat = None
        try:
            await self._apply_radio(temp, repeat)
            if region is not None:
                await self._apply_region(region)
            elif previous is not None and previous.region is not None:
                await self._apply_region(None)
        except Exception:
            # A command may have reached the radio before the failure: never
            # just forget the session. Go back to where we came from; if that
            # fails too, keep the session with a restore pending.
            await self._undo_failed_start(state, previous)
            raise
        self._schedule()
        logger.info(
            "Temporary radio settings on: %s MHz, %s kHz, SF%d, CR%d until %d",
            temp.freq,
            temp.bw,
            temp.sf,
            temp.cr,
            int(state.expires_at or 0),
        )
        return state

    async def _undo_failed_start(
        self, state: TempRadioState, previous: TempRadioState | None
    ) -> None:
        try:
            if previous is None:
                if state.original is not None:
                    await self._apply_radio(state.original, state.original_repeat)
                if state.region is not None:
                    await self._apply_region(None)
                await self._clear()
            else:
                if previous.temp is not None:
                    repeat = (
                        bool(previous.original_repeat) if previous.opt_ins.client_repeat else False
                    )
                    if previous.original_repeat is None:
                        repeat = None
                    await self._apply_radio(previous.temp, repeat)
                if state.region != previous.region:
                    await self._apply_region(previous.region)
                await self._save(previous)
                self._schedule()
        except Exception as exc:
            logger.warning("Could not undo a failed temporary radio switch: %s", exc)
            await self._save(state.model_copy(update={"restore_pending": True}))

    async def restore(self) -> TempRadioState:
        """Put the normal settings back and end the session.

        On failure the session stays with ``restore_pending=True`` and the
        error is raised; the next connect retries.
        """
        async with self._lock:
            return await self._restore_locked()

    async def _restore_locked(self) -> TempRadioState:
        state = self._state
        if not state.active or state.original is None:
            return state
        if state.companion_key != self._connected_key():
            # Never write one companion's settings to another one.
            if not state.restore_pending:
                await self._save(state.model_copy(update={"restore_pending": True}))
            raise TempRadioUnavailableError(
                "The companion of this session is not connected; restore when it is"
            )
        try:
            await self._apply_radio(state.original, state.original_repeat)
            if state.region is not None:
                await self._apply_region(None)
        except Exception:
            if not state.restore_pending:
                await self._save(state.model_copy(update={"restore_pending": True}))
            raise
        logger.info("Temporary radio settings ended, normal settings restored")
        await self._clear()
        return self._state

    async def end_as_new_normal(self) -> None:
        """The radio's current settings become normal: end without restoring them."""
        async with self._lock:
            state = self._state
            if not state.active:
                return
            await self._put_saved_region_back(state)
            await self._clear()

    async def extend_to(self, expires_at: float) -> None:
        """Move the session's end later (a scan entry held on by activity)."""
        async with self._lock:
            state = self._state
            if not state.active:
                return
            if state.expires_at is not None and expires_at <= state.expires_at:
                return
            await self._save(state.model_copy(update={"expires_at": expires_at}))
            self._schedule()

    async def handle_expiry(self) -> None:
        """Expiry: restore; retry while this radio stays connected, else on reconnect."""
        while True:
            try:
                await self.restore()
                return
            except Exception as exc:
                state = self._state
                if (
                    not state.active
                    or not state.restore_pending
                    or state.companion_key != self._connected_key()
                ):
                    logger.warning("Temporary radio restore failed, retrying on reconnect: %s", exc)
                    return
                logger.warning(
                    "Temporary radio restore failed, retrying in %.0f s: %s", self.retry_secs, exc
                )
            await asyncio.sleep(self.retry_secs)

    async def _expiry_loop(self, expires_at: float) -> None:
        try:
            await asyncio.sleep(max(0.0, expires_at - self.clock()))
        except asyncio.CancelledError:
            return
        if self._state.active and self._state.expires_at == expires_at:
            await self.handle_expiry()

    async def reconcile_on_connect(self) -> None:
        """Bring the stored session in line with the radio that just connected."""
        async with self._lock:
            state = self._state
            if not state.active or state.temp is None or state.original is None:
                return
            key = self._connected_key()
            if key is None or key != state.companion_key:
                return
            current = self._current()
            if current is None:
                return
            ours = radio_stamp.stamps_equal(current, state.temp) or (
                state.prev_temp is not None and radio_stamp.stamps_equal(current, state.prev_temp)
            )
            if ours:
                if state.scan is not None or state.restore_pending:
                    # A scan does not resume after a restart or reconnect (spec 4.7).
                    try:
                        await self._restore_locked()
                    except Exception as exc:
                        logger.warning("Restore after interrupted scan failed: %s", exc)
                    return
                if state.expires_at is not None and self.clock() >= state.expires_at:
                    try:
                        await self._restore_locked()
                    except Exception as exc:
                        logger.warning("Overdue temporary radio restore failed: %s", exc)
                    return
                self._schedule()
                return
            if radio_stamp.stamps_equal(current, state.original):
                await self._put_saved_region_back(state)
                await self._clear()
                return
            logger.warning(
                "Radio settings changed outside RTFM during a temporary session; "
                "dropping the session without restoring"
            )
            await self._put_saved_region_back(state)
            await self._clear()
            self.broadcast("temp_radio_dropped", {"reason": "changed_elsewhere"})

    def effective_flood_scope(self, app_scope: str) -> str:
        """The scope the radio should use on connect: the session's, else the saved one."""
        state = self._state
        if not state.active or state.region is None:
            return app_scope
        if state.companion_key != self._connected_key():
            return app_scope
        return "" if state.region == "*" else state.region

    async def _put_saved_region_back(self, state: TempRadioState) -> None:
        if state.region is None:
            return
        try:
            await self._apply_region(None)
        except Exception as exc:
            logger.warning("Could not put the saved region back on the radio: %s", exc)

    def source_kind(self) -> str | None:
        return self._state.source.kind if self._state.active else None


def radio_change_ends_session(
    service: TempRadioService,
    new: RadioStamp | None,
    *,
    current: RadioStamp | None,
    explicit: bool = False,
) -> bool:
    """Whether a Settings > Radio save makes new settings the normal (ends the session).

    ``explicit`` is the modal's "Make this my new normal": it always ends the
    session, also when the chosen settings are the temporary ones already on.
    """
    if not service.session_active():
        return False
    if explicit:
        return True
    if new is None:
        return False
    if current is None:
        return True
    return not radio_stamp.stamps_equal(new, current)


async def start_for_contact(public_key: str) -> TempRadioState:
    """Switch to a contact's saved settings (the DM header button, spec 4.6).

    Raises LookupError when the contact has no saved settings. A running scan
    stops first; an active session keeps its opt-ins.
    """
    from app.models import RadioStampInput, TempRadioOptIns
    from app.repository.contact_radio_profiles import ContactRadioProfilesRepository
    from app.services.radio_scan import radio_scan

    profile = await ContactRadioProfilesRepository.get(public_key)
    if profile is None:
        raise LookupError("No saved radio settings for this contact")
    if await radio_scan.stop_for_other_switch(restore=False):
        temp_radio.broadcast("temp_radio_dropped", {"reason": "scan_stopped_for_contact"})
    current = temp_radio.state()
    opt_ins = current.opt_ins if current.active else TempRadioOptIns()
    request = TempRadioStartRequest(
        radio=RadioStampInput(**profile.radio.model_dump()),
        duration_secs=profile.duration_secs,
        region=profile.region,
        opt_ins=opt_ins,
        source=TempRadioSource(kind="contact", contact_key=profile.public_key),
    )
    return await temp_radio.start(request)


async def ensure_contact_settings(public_key: str) -> bool:
    """Before a DM: switch to the contact's settings when it has auto switch on.

    True when a switch happened. Never raises: a failed switch leaves the send
    to go out on the current settings.
    """
    from app.repository.contact_radio_profiles import ContactRadioProfilesRepository

    try:
        profile = await ContactRadioProfilesRepository.get(public_key)
        if profile is None or not profile.auto_switch:
            return False
        current = temp_radio._current()
        if current is not None and radio_stamp.stamps_equal(current, profile.radio):
            return False
        await start_for_contact(public_key)
        return True
    except Exception as exc:
        logger.warning("Auto switch to %s's radio settings failed: %s", public_key[:12], exc)
        return False


def _broadcast(event: str, data: dict) -> None:
    from app.websocket import broadcast_event

    broadcast_event(event, data)


temp_radio = TempRadioService()

__all__ = [
    "TempRadioConflictError",
    "TempRadioService",
    "ensure_contact_settings",
    "normalize_session_region",
    "start_for_contact",
    "TempRadioSource",
    "TempRadioUnavailableError",
    "radio_change_ends_session",
    "temp_radio",
]
