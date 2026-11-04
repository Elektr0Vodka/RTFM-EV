"""Malformed flag for a sender clock running ahead (migration _169).

Covers the rule, the flag set at ingest with the operator's limit, the setting
round-trip and validation, and re-checking stored messages when it changes.
"""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.malformed import (
    DEFAULT_CLOCK_AHEAD_MINUTES,
    has_clock_ahead,
    is_malformed_channel_message,
    malformed_reason,
)
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services.malformed_clock import rescan_clock_ahead
from app.services.messages import create_fallback_channel_message

CHAN_KEY = "EE" * 16
NOW = 1793800000
GIBBERISH = "ヂχРıкけ"


def _broadcast(event_type, data, *args, **kwargs):
    pass


async def _ingest(sender: str, body: str, stamp: int, received: int = NOW):
    return await create_fallback_channel_message(
        conversation_key=CHAN_KEY,
        message_text=body,
        sender_timestamp=stamp,
        received_at=received,
        path=None,
        path_len=None,
        txt_type=0,
        sender_name=sender,
        channel_name="#public",
        broadcast_fn=_broadcast,
    )


async def _rows() -> dict[str, tuple[bool, str | None]]:
    """Flag and reason of every future-stamped row, by text."""
    return {
        row["text"]: (bool(row["malformed"]), row["malformed_reason"])
        for row in await MessageRepository.get_future_stamped_channel_rows()
    }


class TestRule:
    def test_ahead_beyond_the_limit_only(self):
        assert has_clock_ahead(NOW + 3601, NOW, 60)
        assert not has_clock_ahead(NOW + 3600, NOW, 60)
        assert not has_clock_ahead(NOW - 86400, NOW, 60)
        assert not has_clock_ahead(None, NOW, 60)

    def test_zero_is_off(self):
        assert not has_clock_ahead(NOW + 7 * 86400, NOW, 0)

    def test_off_unless_a_limit_is_given(self):
        # The older migrations call these without a limit; their rule stays.
        assert not is_malformed_channel_message("hoi", NOW + 2 * 86400, NOW)
        assert is_malformed_channel_message("hoi", NOW + 2 * 86400, NOW, 60)

    def test_reason_is_clock_or_both(self):
        assert malformed_reason("hoi", NOW + 2 * 86400, NOW, 60) == "clock"
        assert malformed_reason(GIBBERISH, NOW + 2 * 86400, NOW, 60) == "both"
        assert malformed_reason("hoi", NOW + 60, NOW, 60) is None


class TestIngest:
    @pytest.mark.asyncio
    async def test_default_limit_flags_a_clock_days_ahead(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        ahead = await _ingest("ClownBassie998", "pikkeboeven", NOW + 2 * 86400 + 7 * 3600)
        close = await _ingest("Friend", "hoi", NOW + 120)
        assert ahead is not None and ahead.malformed is True
        assert close is not None and close.malformed is False

    @pytest.mark.asyncio
    async def test_operator_limit_is_used(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(malformed_clock_ahead_minutes=0)
        off = await _ingest("A", "een", NOW + 2 * 86400)
        await AppSettingsRepository.update(malformed_clock_ahead_minutes=5)
        strict = await _ingest("B", "twee", NOW + 10 * 60)
        assert off is not None and off.malformed is False
        assert strict is not None and strict.malformed is True


class TestSettings:
    @pytest.mark.asyncio
    async def test_default(self, test_db):
        settings = await AppSettingsRepository.get()
        assert settings.malformed_clock_ahead_minutes == DEFAULT_CLOCK_AHEAD_MINUTES == 60

    @pytest.mark.asyncio
    async def test_update_persists(self, test_db):
        result = await update_settings(AppSettingsUpdate(malformed_clock_ahead_minutes=15))
        assert result.malformed_clock_ahead_minutes == 15
        assert (await AppSettingsRepository.get()).malformed_clock_ahead_minutes == 15

    def test_out_of_range_is_refused(self):
        with pytest.raises(ValidationError):
            AppSettingsUpdate(malformed_clock_ahead_minutes=-1)
        with pytest.raises(ValidationError):
            AppSettingsUpdate(malformed_clock_ahead_minutes=10081)


class TestStoredMessages:
    @pytest.mark.asyncio
    async def test_saving_the_limit_flags_and_clears_stored_messages(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(malformed_clock_ahead_minutes=0)
        await _ingest("A", "een", NOW + 2 * 86400)
        await _ingest("B", "twee", NOW + 30 * 60)
        await _ingest("C", GIBBERISH, NOW + 30 * 60)
        assert await _rows() == {
            "A: een": (False, None),
            "B: twee": (False, None),
            f"C: {GIBBERISH}": (True, "text"),
        }

        await update_settings(AppSettingsUpdate(malformed_clock_ahead_minutes=60))
        assert await _rows() == {
            "A: een": (True, "clock"),
            "B: twee": (False, None),
            f"C: {GIBBERISH}": (True, "text"),
        }

        await update_settings(AppSettingsUpdate(malformed_clock_ahead_minutes=10))
        assert await _rows() == {
            "A: een": (True, "clock"),
            "B: twee": (True, "clock"),
            f"C: {GIBBERISH}": (True, "both"),
        }

        await update_settings(AppSettingsUpdate(malformed_clock_ahead_minutes=0))
        assert await _rows() == {
            "A: een": (False, None),
            "B: twee": (False, None),
            f"C: {GIBBERISH}": (True, "text"),
        }

    @pytest.mark.asyncio
    async def test_outgoing_rows_are_left_alone(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await MessageRepository.create(
            msg_type="CHAN",
            text="Me: mijn eigen bericht",
            received_at=NOW,
            conversation_key=CHAN_KEY,
            sender_timestamp=NOW + 2 * 86400,
            sender_name="Me",
            outgoing=True,
        )
        assert await rescan_clock_ahead() == 0

    @pytest.mark.asyncio
    async def test_a_change_is_announced_and_no_change_is_not(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(malformed_clock_ahead_minutes=0)
        await _ingest("A", "een", NOW + 2 * 86400)
        await AppSettingsRepository.update(malformed_clock_ahead_minutes=60)

        with patch("app.services.malformed_clock.broadcast_event") as broadcast:
            assert await rescan_clock_ahead() == 1
            broadcast.assert_called_once_with("malformed_applied", {"changed": 1})
            broadcast.reset_mock()
            assert await rescan_clock_ahead() == 0
            broadcast.assert_not_called()
