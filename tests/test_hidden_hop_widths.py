"""'Hide by hop size' filter stored server-side (migration _121).

Covers the settings round-trip, the shared width helper, and that hidden
messages are excluded from unread counts, mention flags, the unread boundary
and last message times, like blocked traffic.
"""

import time

import pytest

from app.path_utils import message_hidden_by_hop_width, stored_path_hop_width
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.settings import AppSettingsUpdate, update_settings

CHAN_KEY = "EE" * 16


class TestStoredPathHopWidth:
    @pytest.mark.parametrize(
        ("path", "path_len", "expected"),
        [
            ("a1", 1, 1),
            ("a1b2", 2, 1),
            ("a1b2", 1, 2),
            ("a1b2c3", 1, 3),
            ("a1b2c3d4e5f6", 2, 3),
            ("", 0, None),
            ("a1b2", None, None),
            ("a1b2", 0, None),
            ("a1b2c", 2, None),
            ("a1b2c3d4", 1, None),
        ],
    )
    def test_width(self, path, path_len, expected):
        assert stored_path_hop_width(path, path_len) == expected

    def test_any_path_matching_hides(self):
        paths = [
            {"path": "a1b2c3d4", "path_len": 2},
            {"path": "a1", "path_len": 1},
        ]
        assert message_hidden_by_hop_width(paths, [1]) is True
        assert message_hidden_by_hop_width(paths, [3]) is False
        assert message_hidden_by_hop_width(paths, []) is False
        assert message_hidden_by_hop_width(None, [1, 2, 3]) is False


class TestSettingsRoundTrip:
    @pytest.mark.asyncio
    async def test_default_empty(self, test_db):
        assert (await AppSettingsRepository.get()).hidden_hop_widths == []

    @pytest.mark.asyncio
    async def test_update_sanitizes_and_persists(self, test_db):
        result = await update_settings(AppSettingsUpdate(hidden_hop_widths=[3, 1, 1, 4, 0]))
        assert result.hidden_hop_widths == [1, 3]
        assert (await AppSettingsRepository.get()).hidden_hop_widths == [1, 3]

        result = await update_settings(AppSettingsUpdate(hidden_hop_widths=[]))
        assert result.hidden_hop_widths == []


async def _chan_msg(text: str, received_at: int, path: str, path_len: int) -> int:
    msg_id = await MessageRepository.create(
        msg_type="CHAN",
        text=text,
        received_at=received_at,
        conversation_key=CHAN_KEY,
        sender_timestamp=received_at,
        path=path,
        path_len=path_len,
    )
    assert msg_id is not None
    return msg_id


class TestUnreadCountsHopFilter:
    @pytest.mark.asyncio
    async def test_hidden_messages_excluded(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=CHAN_KEY, name="#hops")
        await ChannelRepository.update_last_read_at(CHAN_KEY, 0)

        # Oldest unread is a 1-byte spam message that also mentions us.
        await _chan_msg("Spam: @[Me] 1-byte", now, "a1b2", 2)
        visible_id = await _chan_msg("Friend: 2-byte", now + 1, "a1b2c3d4", 2)
        await _chan_msg("Friend: direct", now + 2, "", 0)
        await _chan_msg("Spam: 1-byte late", now + 3, "c3", 1)

        key = f"channel-{CHAN_KEY}"
        unfiltered = await MessageRepository.get_unread_counts("Me")
        assert unfiltered["counts"][key] == 4
        assert unfiltered["mentions"].get(key) is True
        assert unfiltered["last_message_times"][key] == now + 3

        filtered = await MessageRepository.get_unread_counts("Me", hidden_hop_widths=[1])
        assert filtered["counts"][key] == 2
        assert key not in filtered["mentions"]
        # The unread boundary skips the hidden oldest message.
        assert filtered["first_unread_ids"][key] == visible_id
        # A hidden message does not bump the conversation's recency.
        assert filtered["last_message_times"][key] == now + 2

    @pytest.mark.asyncio
    async def test_all_hidden_channel_has_no_unreads(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=CHAN_KEY, name="#hops")
        await ChannelRepository.update_last_read_at(CHAN_KEY, 0)
        await _chan_msg("Spam: a", now, "a1", 1)

        result = await MessageRepository.get_unread_counts(None, hidden_hop_widths=[1])
        key = f"channel-{CHAN_KEY}"
        assert key not in result["counts"]
        assert key not in result["first_unread_ids"]
