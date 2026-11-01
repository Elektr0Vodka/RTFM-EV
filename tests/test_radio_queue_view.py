"""Live radio queue: which operation holds the radio, which ones wait."""

import asyncio

import pytest

from app.radio import RadioManager


@pytest.mark.asyncio
async def test_idle_radio_has_no_holder_and_no_queue():
    manager = RadioManager()
    assert manager.operation_queue() == {"holder": None, "waiting": []}


@pytest.mark.asyncio
async def test_holder_and_waiters_in_arrival_order():
    manager = RadioManager()
    await manager._acquire_operation_lock("send_channel_message", blocking=True)

    async def wait_for(name: str) -> None:
        await manager._acquire_operation_lock(name, blocking=True)
        manager._release_operation_lock(name)

    first = asyncio.create_task(wait_for("retry_direct_message"))
    await asyncio.sleep(0)
    second = asyncio.create_task(wait_for("telemetry_poll"))
    await asyncio.sleep(0)

    queue = manager.operation_queue()
    assert queue["holder"]["name"] == "send_channel_message"
    assert [w["name"] for w in queue["waiting"]] == ["retry_direct_message", "telemetry_poll"]

    manager._release_operation_lock("send_channel_message")
    await asyncio.gather(first, second)
    assert manager.operation_queue() == {"holder": None, "waiting": []}


@pytest.mark.asyncio
async def test_a_cancelled_waiter_leaves_the_queue():
    manager = RadioManager()
    await manager._acquire_operation_lock("holder", blocking=True)
    task = asyncio.create_task(manager._acquire_operation_lock("gives_up", blocking=True))
    await asyncio.sleep(0)
    assert len(manager.operation_queue()["waiting"]) == 1

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert manager.operation_queue()["waiting"] == []
    manager._release_operation_lock("holder")


@pytest.mark.asyncio
async def test_perf_snapshot_carries_the_queue():
    from app.perf.snapshot import _radio_queue

    class _NoQueue:
        pass

    assert _radio_queue(_NoQueue()) == {"holder": None, "waiting": []}
    manager = RadioManager()
    assert _radio_queue(manager) == {"holder": None, "waiting": []}
