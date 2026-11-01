"""Tests for the spacing between outgoing sends."""

import asyncio

import pytest

from app.services import send_pacer


class _FakeTime:
    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


@pytest.fixture
def fake_time(monkeypatch):
    fake = _FakeTime()
    monkeypatch.setattr(send_pacer, "_clock", fake.clock)
    monkeypatch.setattr(send_pacer, "_sleep", fake.sleep)
    return fake


def _gap(monkeypatch, seconds: int) -> None:
    async def _read() -> int:
        return seconds

    monkeypatch.setattr(send_pacer, "_read_gap_seconds", _read)


@pytest.mark.asyncio
async def test_first_send_does_not_wait(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent(1)
    assert fake_time.now == 1000.0


@pytest.mark.asyncio
async def test_next_send_waits_the_gap_without_an_echo(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent(1)
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == pytest.approx(1005.0)


@pytest.mark.asyncio
async def test_first_echo_opens_the_slot_one_second_later(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent(1)
    fake_time.now += 2.0
    send_pacer.note_echo(1)
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == pytest.approx(1003.0)


@pytest.mark.asyncio
async def test_echo_of_another_message_does_not_open_the_slot(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent(1)
    send_pacer.note_echo(99)
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == pytest.approx(1005.0)


@pytest.mark.asyncio
async def test_waits_for_quiet_air_but_not_forever(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    send_pacer.note_rx()
    async with send_pacer.send_slot():
        pass
    # Quiet for 2 s after the last packet heard.
    assert fake_time.now == pytest.approx(1000.0 + send_pacer.QUIET_AIR_SECONDS)

    # A packet keeps arriving: the wait stops at the cap.
    async def _busy_sleep(seconds: float) -> None:
        fake_time.now += seconds
        send_pacer.note_rx()

    monkeypatch.setattr(send_pacer, "_sleep", _busy_sleep)
    start = fake_time.now
    send_pacer.note_rx()
    async with send_pacer.send_slot():
        pass
    assert fake_time.now - start == pytest.approx(send_pacer.QUIET_AIR_MAX_WAIT_SECONDS)


@pytest.mark.asyncio
async def test_gap_zero_turns_spacing_off(fake_time, monkeypatch):
    _gap(monkeypatch, 0)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent(1)
    send_pacer.note_rx()
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == 1000.0


@pytest.mark.asyncio
async def test_bind_message_attaches_a_dm_stored_after_sending(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.send_slot() as slot:
        slot.mark_sent()
    slot.bind_message(7)
    send_pacer.note_echo(7)
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == pytest.approx(1001.0)


@pytest.mark.asyncio
async def test_unpaced_slot_never_waits_or_records(fake_time, monkeypatch):
    _gap(monkeypatch, 5)
    async with send_pacer.unpaced() as slot:
        slot.mark_sent(1)
    async with send_pacer.send_slot():
        pass
    assert fake_time.now == 1000.0


@pytest.mark.asyncio
async def test_is_busy_while_a_send_holds_or_waits_for_the_slot(monkeypatch):
    _gap(monkeypatch, 0)
    assert not send_pacer.is_busy()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder() -> None:
        async with send_pacer.send_slot():
            entered.set()
            await release.wait()

    task = asyncio.create_task(holder())
    await entered.wait()
    assert send_pacer.is_busy()
    release.set()
    await task
    assert not send_pacer.is_busy()
