"""Tests for Hide bots: the setting and the server-side filter."""

import time

import pytest

from app.bot_lists.format import BotEntry
from app.push.manager import _is_blocked
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.read_state import get_unreads
from app.services.bot_lists import bot_lists

CHAN = "DD" * 16


async def _enabled_list(*entries):
    state = await bot_lists.create_local("Mine")
    list_id = state["lists"][0]["id"]
    await bot_lists.replace_entries(list_id, list(entries))
    await bot_lists.update(list_id, enabled=True)
    return list_id


async def _channel_message(sender, at):
    await MessageRepository.create(
        msg_type="CHAN",
        text=f"{sender}: hello",
        received_at=at,
        conversation_key=CHAN,
        sender_timestamp=at,
        sender_name=sender,
    )


@pytest.mark.asyncio
async def test_the_setting_defaults_off_and_is_saved(test_db):
    assert (await AppSettingsRepository.get()).hide_bots is False
    assert (await AppSettingsRepository.update(hide_bots=True)).hide_bots is True
    assert (await AppSettingsRepository.get()).hide_bots is True


@pytest.mark.asyncio
async def test_without_hide_bots_only_blocked_contacts_are_hidden(test_db):
    await _enabled_list(BotEntry(name="PingBot", public_key="ab" * 32))
    await AppSettingsRepository.toggle_blocked_name("Spammer")
    settings = await AppSettingsRepository.get()
    assert await bot_lists.hidden_senders(settings) == (None, ["Spammer"])


@pytest.mark.asyncio
async def test_with_hide_bots_the_effective_set_is_added(test_db):
    await _enabled_list(BotEntry(name="PingBot", public_key="ab" * 32))
    await AppSettingsRepository.toggle_blocked_name("Spammer")
    await AppSettingsRepository.toggle_blocked_key("cd" * 32)
    settings = await AppSettingsRepository.update(hide_bots=True)
    assert await bot_lists.hidden_senders(settings) == (
        ["ab" * 32, "cd" * 32],
        ["PingBot", "Spammer"],
    )


@pytest.mark.asyncio
async def test_nothing_to_hide_gives_none(test_db):
    settings = await AppSettingsRepository.update(hide_bots=True)
    assert await bot_lists.hidden_senders(settings) == (None, None)


@pytest.mark.asyncio
async def test_unread_counts_leave_out_listed_bots_only_while_hide_bots_is_on(test_db):
    now = int(time.time())
    await ChannelRepository.upsert(key=CHAN, name="#test")
    await ChannelRepository.update_last_read_at(CHAN, 0)
    await _channel_message("PingBot", now)
    await _channel_message("Friend", now + 1)
    await _enabled_list(BotEntry(name="PingBot"))

    assert (await get_unreads()).counts[f"channel-{CHAN}"] == 2
    await AppSettingsRepository.update(hide_bots=True)
    assert (await get_unreads()).counts[f"channel-{CHAN}"] == 1


@pytest.mark.asyncio
async def test_a_disabled_list_hides_nothing(test_db):
    now = int(time.time())
    await ChannelRepository.upsert(key=CHAN, name="#test")
    await ChannelRepository.update_last_read_at(CHAN, 0)
    await _channel_message("PingBot", now)
    list_id = await _enabled_list(BotEntry(name="PingBot"))
    await bot_lists.update(list_id, enabled=False)
    await AppSettingsRepository.update(hide_bots=True)
    assert (await get_unreads()).counts[f"channel-{CHAN}"] == 1


@pytest.mark.asyncio
async def test_push_skips_a_listed_bot_by_name_and_by_key(test_db):
    await _enabled_list(BotEntry(name="PingBot", public_key="ab" * 32))
    settings = await AppSettingsRepository.update(hide_bots=True)
    keys, names = await bot_lists.hidden_senders(settings)
    assert _is_blocked({"type": "CHAN", "sender_name": "PingBot"}, keys or [], names or [])
    assert _is_blocked({"type": "PRIV", "conversation_key": "AB" * 32}, keys or [], names or [])
    assert not _is_blocked({"type": "CHAN", "sender_name": "Friend"}, keys or [], names or [])
