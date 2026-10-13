"""Tests for the hourly refresh loop of subscribed bot lists."""

import asyncio

import pytest

from app.services import bot_list_refresh


@pytest.mark.asyncio
async def test_one_pass_asks_the_service(monkeypatch):
    calls = []

    async def fake_due():
        calls.append("due")
        return 2

    monkeypatch.setattr(bot_list_refresh.bot_lists, "refresh_due", fake_due)
    assert await bot_list_refresh.run_bot_list_refresh_once() == 2
    assert calls == ["due"]


@pytest.mark.asyncio
async def test_the_loop_survives_an_error_and_stops_on_request(monkeypatch):
    passes = []

    async def failing_due():
        passes.append(1)
        raise RuntimeError("database is locked")

    monkeypatch.setattr(bot_list_refresh.bot_lists, "refresh_due", failing_due)
    monkeypatch.setattr(bot_list_refresh, "FIRST_CHECK_SECONDS", 0)
    monkeypatch.setattr(bot_list_refresh, "CHECK_INTERVAL_SECONDS", 0)

    bot_list_refresh.start_bot_list_refresh()
    for _ in range(50):
        await asyncio.sleep(0)
        if len(passes) >= 2:
            break
    await bot_list_refresh.stop_bot_list_refresh()
    assert len(passes) >= 2
    count = len(passes)
    await asyncio.sleep(0)
    assert len(passes) == count
