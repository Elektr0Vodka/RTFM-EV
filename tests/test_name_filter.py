"""The 'Hide by name pattern' chat filter (migration _167).

Covers the pattern rules, the flag set at ingest, the check of stored messages
when the list changes, and what the filter keeps out of unread counts and
mentions. The names are the ones heard on a public channel on 2026-11-01: one
sender per message, with a new number each time.
"""

import time
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.name_filter import (
    MAX_PATTERN_LENGTH,
    MAX_PATTERNS,
    clean_patterns,
    name_matches,
    shown_sender,
)
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services.messages import create_fallback_channel_message, create_message_from_decrypted
from app.services.name_filter import rescan_messages

CHAN_KEY = "EE" * 16
NOW = 1793000000
SCRIPTED = r"(ClownBassie|Adriaan|Robin|DeBaron|VluggeJapie)\d{2,4}|B2-\d{2,4}"


def _broadcast(event_type, data, *args, **kwargs):
    pass


async def _ingest(sender: str | None, body: str, at: int = NOW):
    return await create_fallback_channel_message(
        conversation_key=CHAN_KEY,
        message_text=body,
        sender_timestamp=at,
        received_at=at,
        path=None,
        path_len=None,
        txt_type=0,
        sender_name=sender,
        channel_name="#public",
        broadcast_fn=_broadcast,
    )


async def _flags() -> dict[str, bool]:
    messages = await MessageRepository.get_all(conversation_key=CHAN_KEY)
    return {m.text: m.name_filtered for m in messages}


class TestPatterns:
    @pytest.mark.parametrize(
        "name",
        [
            "ClownBassie723",
            "Adriaan257",
            "Robin689",
            "DeBaron886",
            "VluggeJapie402",
            "B2-852",
            "B2-87",
            "adriaan257",
        ],
    )
    def test_scripted_names_match(self, name):
        assert name_matches(name, [SCRIPTED])

    @pytest.mark.parametrize("name", ["Adriaan", "Robin", "MijnAdriaan1", "Adriaan257x", "B2"])
    def test_the_whole_name_has_to_match(self, name):
        assert not name_matches(name, [SCRIPTED])

    def test_any_pattern_of_the_list_is_enough(self):
        assert name_matches("Bob", ["Alice", "bob"])
        assert not name_matches("Bob", [])

    def test_clean_trims_and_drops_blanks_and_repeats(self):
        assert clean_patterns([" a\\d+ ", "", "   ", "a\\d+", "b"]) == ["a\\d+", "b"]

    def test_clean_refuses_a_broken_expression(self):
        with pytest.raises(ValueError, match="Adriaan\\("):
            clean_patterns(["Adriaan("])

    def test_clean_refuses_too_long_and_too_many(self):
        with pytest.raises(ValueError, match="at most"):
            clean_patterns(["a" * (MAX_PATTERN_LENGTH + 1)])
        with pytest.raises(ValueError, match="At most"):
            clean_patterns([f"name{i}" for i in range(MAX_PATTERNS + 1)])

    def test_broken_stored_pattern_is_skipped(self):
        assert name_matches("Bob", ["(", "Bob"])

    def test_shown_sender_falls_back_to_the_text_prefix(self):
        assert shown_sender("Bob", "Bob: hoi") == "Bob"
        assert shown_sender(None, "[Bob]: hoi") == "[Bob]"
        assert shown_sender(None, "no prefix") is None


class TestIngest:
    @pytest.mark.asyncio
    async def test_decrypted_message_is_flagged_and_broadcast(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(name_filter_patterns=[SCRIPTED])
        events = []

        def broadcast(event_type, data, *args, **kwargs):
            events.append((event_type, data))

        async def ingest(packet_id: int, sender: str):
            return await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=CHAN_KEY,
                sender=sender,
                message_text="Rustig Bassie",
                timestamp=NOW,
                received_at=NOW,
                broadcast_fn=broadcast,
            )

        hit = await ingest(1, "Adriaan589")
        miss = await ingest(2, "Friend")

        stored = {m.id: m for m in await MessageRepository.get_all(conversation_key=CHAN_KEY)}
        assert stored[hit].name_filtered is True
        assert stored[miss].name_filtered is False
        flags = {data["id"]: data["name_filtered"] for kind, data in events if kind == "message"}
        assert flags == {hit: True, miss: False}

    @pytest.mark.asyncio
    async def test_fallback_message_is_flagged(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(name_filter_patterns=[SCRIPTED])
        hit = await _ingest("DeBaron886", "Foei!")
        miss = await _ingest("Friend", "hoi")
        assert hit is not None and hit.name_filtered is True
        assert miss is not None and miss.name_filtered is False

    @pytest.mark.asyncio
    async def test_a_lookup_problem_never_costs_a_message(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        with patch(
            "app.services.messages.AppSettingsRepository.get_name_filter_patterns",
            side_effect=RuntimeError("boom"),
        ):
            message = await _ingest("Adriaan589", "hoi")
        assert message is not None and message.name_filtered is False


class TestStoredMessages:
    @pytest.mark.asyncio
    async def test_saving_patterns_flags_and_clears_stored_messages(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await _ingest("Adriaan589", "een")
        await _ingest("Friend", "twee")
        await _ingest("Robin689", "drie")

        result = await update_settings(AppSettingsUpdate(name_filter_patterns=[r"Adriaan\d+"]))
        assert result.name_filter_patterns == [r"Adriaan\d+"]
        assert await _flags() == {
            "Adriaan589: een": True,
            "Friend: twee": False,
            "Robin689: drie": False,
        }

        await update_settings(AppSettingsUpdate(name_filter_patterns=[r"Robin\d+"]))
        assert await _flags() == {
            "Adriaan589: een": False,
            "Friend: twee": False,
            "Robin689: drie": True,
        }

        await update_settings(AppSettingsUpdate(name_filter_patterns=[]))
        assert not any((await _flags()).values())

    @pytest.mark.asyncio
    async def test_row_without_a_stored_sender_goes_by_its_text_prefix(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await MessageRepository.create(
            msg_type="CHAN",
            text="[Adriaan589]: hoi",
            received_at=NOW,
            conversation_key=CHAN_KEY,
            sender_timestamp=NOW,
        )
        await AppSettingsRepository.update(name_filter_patterns=[r"\[Adriaan\d+\]"])
        assert await rescan_messages() == 1
        assert await _flags() == {"[Adriaan589]: hoi": True}

    @pytest.mark.asyncio
    async def test_outgoing_and_direct_rows_are_left_alone(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await MessageRepository.create(
            msg_type="CHAN",
            text="Adriaan589: mijn eigen bericht",
            received_at=NOW,
            conversation_key=CHAN_KEY,
            sender_timestamp=NOW,
            sender_name="Adriaan589",
            outgoing=True,
        )
        await MessageRepository.create(
            msg_type="PRIV",
            text="Adriaan589: hoi",
            received_at=NOW,
            conversation_key="ab" * 32,
            sender_timestamp=NOW,
            sender_name="Adriaan589",
        )
        await AppSettingsRepository.update(name_filter_patterns=[r"Adriaan\d+"])
        assert await rescan_messages() == 0

    @pytest.mark.asyncio
    async def test_a_change_is_announced_and_no_change_is_not(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await _ingest("Adriaan589", "een")
        await AppSettingsRepository.update(name_filter_patterns=[r"Adriaan\d+"])

        with patch("app.services.name_filter.broadcast_event") as broadcast:
            assert await rescan_messages() == 1
            broadcast.assert_called_once_with("name_filter_applied", {"changed": 1})
            broadcast.reset_mock()
            assert await rescan_messages() == 0
            broadcast.assert_not_called()


class TestSettings:
    @pytest.mark.asyncio
    async def test_default_is_off_and_empty(self, test_db):
        settings = await AppSettingsRepository.get()
        assert settings.hide_name_filtered is False
        assert settings.name_filter_patterns == []

    @pytest.mark.asyncio
    async def test_update_persists(self, test_db):
        result = await update_settings(
            AppSettingsUpdate(hide_name_filtered=True, name_filter_patterns=[" a\\d+ ", ""])
        )
        assert result.hide_name_filtered is True
        assert result.name_filter_patterns == ["a\\d+"]
        stored = await AppSettingsRepository.get()
        assert stored.hide_name_filtered is True
        assert stored.name_filter_patterns == ["a\\d+"]

    @pytest.mark.asyncio
    async def test_broken_pattern_is_refused_and_the_list_stays(self, test_db):
        await update_settings(AppSettingsUpdate(name_filter_patterns=["ok"]))
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(name_filter_patterns=["ok", "Adriaan("]))
        assert exc.value.status_code == 400
        assert "Adriaan(" in exc.value.detail
        assert (await AppSettingsRepository.get()).name_filter_patterns == ["ok"]

    @pytest.mark.asyncio
    async def test_toggling_does_not_touch_the_flags(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await update_settings(AppSettingsUpdate(name_filter_patterns=[r"Adriaan\d+"]))
        await _ingest("Adriaan589", "een")
        with patch("app.routers.settings.rescan_messages") as rescan:
            await update_settings(AppSettingsUpdate(hide_name_filtered=True))
            rescan.assert_not_called()
        assert await _flags() == {"Adriaan589: een": True}


class TestHidden:
    @pytest.mark.asyncio
    async def test_excluded_from_unread_counts(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await ChannelRepository.update_last_read_at(CHAN_KEY, 0)
        await AppSettingsRepository.update(name_filter_patterns=[r"Adriaan\d+"])

        await _ingest("Adriaan1", "@[Me] een", now)
        visible = await _ingest("Friend", "twee", now + 1)
        await _ingest("Adriaan2", "drie", now + 2)
        assert visible is not None

        key = f"channel-{CHAN_KEY}"
        unfiltered = await MessageRepository.get_unread_counts("Me")
        assert unfiltered["counts"][key] == 3
        assert unfiltered["mentions"].get(key) is True

        filtered = await MessageRepository.get_unread_counts("Me", hide_name_filtered=True)
        assert filtered["counts"][key] == 1
        assert key not in filtered["mentions"]
        assert filtered["first_unread_ids"][key] == visible.id
        assert filtered["last_message_times"][key] == now + 1

    @pytest.mark.asyncio
    async def test_excluded_from_mentions_and_summaries(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await AppSettingsRepository.update(name_filter_patterns=[r"Adriaan\d+"])
        await _ingest("Adriaan1", "@[Me] een", NOW)
        await _ingest("Friend", "@[Me] twee", NOW + 1)

        mentions = await MessageRepository.get_mentions("Me", hide_name_filtered=True)
        assert [m.sender_name for m in mentions] == ["Friend"]
        latest = await MessageRepository.get_latest_since(
            "CHAN", CHAN_KEY, 0, 10, hide_name_filtered=True
        )
        assert [m.sender_name for m in latest] == ["Friend"]

    @pytest.mark.asyncio
    async def test_outgoing_flagged_row_is_never_hidden(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await MessageRepository.create(
            msg_type="CHAN",
            text="Me: test",
            received_at=now,
            conversation_key=CHAN_KEY,
            sender_timestamp=now,
            outgoing=True,
            name_filtered=True,
        )
        result = await MessageRepository.get_unread_counts(None, hide_name_filtered=True)
        assert result["last_message_times"][f"channel-{CHAN_KEY}"] == now
