"""Spacing between outgoing sends.

A repeater cannot hear while it transmits. When a second message goes out
while the repeaters around us are still repeating the first, the second one is
lost. Every send that goes on air (DMs, channel messages, resends, retries and
the echo watchdog) therefore takes one shared send slot, and the slot opens:

- 1 second after the previous send's first echo or ACK was heard, or
- ``send_gap_seconds`` (app setting, 0-30, 0 = off) after the previous send,

whichever comes first, and then once the air has been quiet for a moment
(no packet heard for ``QUIET_AIR_SECONDS``), waiting at most
``QUIET_AIR_MAX_WAIT_SECONDS`` for that.

The slot is taken before the radio lock, never while holding it, so other
radio work is not held up by the wait.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

DEFAULT_SEND_GAP_SECONDS = 5
ECHO_RELEASE_SECONDS = 1.0
QUIET_AIR_SECONDS = 2.0
QUIET_AIR_MAX_WAIT_SECONDS = 3.0
_POLL_SECONDS = 0.25

SleepFn = Callable[[float], Awaitable[None]]


class _State:
    def __init__(self) -> None:
        self.slot = asyncio.Lock()
        self.waiting = 0
        self.last_send_at: float | None = None
        self.last_message_id: int | None = None
        self.first_echo_at: float | None = None
        self.last_rx_at: float | None = None


_state = _State()
_clock: Callable[[], float] = time.monotonic
_sleep: SleepFn = asyncio.sleep


def reset() -> None:
    """Forget all send history (tests, reconnect)."""
    global _state
    _state = _State()


def note_rx() -> None:
    """Record that a packet was just heard on air."""
    _state.last_rx_at = _clock()


def note_echo(message_id: int) -> None:
    """Record an echo or ACK of a sent message; the first one opens the slot early."""
    if message_id == _state.last_message_id and _state.first_echo_at is None:
        _state.first_echo_at = _clock()


def is_busy() -> bool:
    """True while a send holds the slot or waits for it."""
    return _state.waiting > 0 or _state.slot.locked()


class SendSlot:
    """Handle for the holder of the send slot."""

    def __init__(self, *, paced: bool = True) -> None:
        self._paced = paced
        self._sent_at: float | None = None

    def mark_sent(self, message_id: int | None = None) -> None:
        """Record that a send went to the radio now."""
        if not self._paced:
            return
        self._sent_at = _clock()
        _state.last_send_at = self._sent_at
        _state.last_message_id = message_id
        _state.first_echo_at = None

    def bind_message(self, message_id: int) -> None:
        """Attach the stored message id to this send (DMs are stored after sending).

        Ignored when another send has gone out since.
        """
        if self._sent_at is not None and _state.last_send_at == self._sent_at:
            _state.last_message_id = message_id


async def _read_gap_seconds() -> int:
    from app.repository import AppSettingsRepository

    try:
        settings = await AppSettingsRepository.get()
        return max(0, min(30, int(settings.send_gap_seconds)))
    except Exception:
        logger.debug("Send gap setting unavailable; using the default", exc_info=True)
        return DEFAULT_SEND_GAP_SECONDS


def _ready_at(gap_seconds: int) -> float | None:
    if _state.last_send_at is None:
        return None
    ready = _state.last_send_at + gap_seconds
    if _state.first_echo_at is not None:
        ready = min(ready, _state.first_echo_at + ECHO_RELEASE_SECONDS)
    return ready


async def _wait_for_turn(gap_seconds: int) -> None:
    while True:
        ready = _ready_at(gap_seconds)
        now = _clock()
        if ready is None or now >= ready:
            break
        await _sleep(min(_POLL_SECONDS, ready - now))

    quiet_deadline = _clock() + QUIET_AIR_MAX_WAIT_SECONDS
    while True:
        now = _clock()
        last_rx = _state.last_rx_at
        if last_rx is None or now - last_rx >= QUIET_AIR_SECONDS or now >= quiet_deadline:
            break
        await _sleep(min(_POLL_SECONDS, QUIET_AIR_SECONDS - (now - last_rx), quiet_deadline - now))


@asynccontextmanager
async def send_slot() -> AsyncIterator[SendSlot]:
    """Wait for the turn to send, then hold the send slot until the block ends."""
    state = _state
    state.waiting += 1
    try:
        await state.slot.acquire()
    finally:
        state.waiting -= 1
    try:
        gap_seconds = await _read_gap_seconds()
        if gap_seconds > 0:
            started = _clock()
            await _wait_for_turn(gap_seconds)
            waited = _clock() - started
            if waited >= 0.5:
                logger.debug("Send spacing: waited %.1fs for the send slot", waited)
        yield SendSlot()
    finally:
        state.slot.release()


@asynccontextmanager
async def unpaced() -> AsyncIterator[SendSlot]:
    """A slot for a send that never goes on air (it runs on the radio itself)."""
    yield SendSlot(paced=False)
