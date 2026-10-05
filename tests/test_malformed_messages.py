"""Malformed channel message detection and the 'Hide malformed' filter (migration _129).

Covers the detection rules, the flag set at ingest, the settings round-trip,
and that flagged messages are excluded from unread counts, mention flags, the
unread boundary and last message times when the filter is on.
"""

import time

import pytest

from app.malformed import (
    MESHCORE_DEFAULT_RTC_EPOCH,
    has_default_clock,
    is_gibberish_text,
    is_malformed_channel_message,
)
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services.messages import create_fallback_channel_message, create_message_from_decrypted

CHAN_KEY = "EE" * 16
NOW = 1791220000  # 2026-10-05, the day of the observed burst

# Bodies taken from the 2026-10-05 burst.
SPAM_BODIES = [
    "ヂχ\U0004f373Р",
    "ıкけラ¥т╧♇«ォЏ",
    "ŧ¸£Δ₁",
    "⚤ΰエ☛",
    "😓ぺノυカã⁻פ😏ġね♗С😨",
    "Ż┤µ",
    "ÙĭヲрÌ",
    "テ🐄⛍В\U000dda92תや",
    "ı€צ",
    "„лΧ",
    "𐠼Е╂",
    "âЎ⚠Ź",
    "びŷⁿ",
    "\U000c016c☵☫²⁥ロ",
]

LEGIT_BODIES = [
    "goedenavond allen",
    "@[BL187] grunn lukt ook",
    "ja",
    "👍",
    "✅️",
    "👋🏻👋🏻👋🏻",
    "💵💶💸",
    "..",
    "",
    "🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f",  # England flag (tag chars)
    "\U0001faea",  # emoji newer than the bundled Unicode tables
    "привет",  # one script
    "Γειά σου",
    "שלום",
    "こんにちは、世界",  # kana + kanji is one family
    "café ├──┤ ok",  # box drawing next to ASCII letters
    "Ż┤µ test",  # any ASCII letter clears the text rule
    "73 µV Δ",
]


class TestGibberishText:
    @pytest.mark.parametrize("body", SPAM_BODIES)
    def test_spam_bodies_flagged(self, body):
        assert is_gibberish_text(body) is True

    @pytest.mark.parametrize("body", LEGIT_BODIES)
    def test_legit_bodies_not_flagged(self, body):
        assert is_gibberish_text(body) is False


class TestDefaultClock:
    def test_firmware_default_epoch_is_flagged(self):
        assert has_default_clock(MESHCORE_DEFAULT_RTC_EPOCH + 10, NOW) is True
        assert has_default_clock(MESHCORE_DEFAULT_RTC_EPOCH + 29 * 86400, NOW) is True

    def test_outside_the_default_epoch_window(self):
        assert has_default_clock(MESHCORE_DEFAULT_RTC_EPOCH - 1, NOW) is False
        assert has_default_clock(MESHCORE_DEFAULT_RTC_EPOCH + 31 * 86400, NOW) is False
        # Other wrong clocks (1970, some other default) are not this signature.
        assert has_default_clock(1234, NOW) is False
        assert has_default_clock(NOW - 13 * 86400, NOW) is False
        assert has_default_clock(NOW, NOW) is False
        assert has_default_clock(None, NOW) is False

    def test_genuinely_old_message_received_then_is_not_flagged(self):
        sent = MESHCORE_DEFAULT_RTC_EPOCH + 3600
        assert has_default_clock(sent, sent + 5) is False


class TestIsMalformedChannelMessage:
    def test_either_rule_flags(self):
        assert is_malformed_channel_message("ŧ¸£Δ₁", NOW, NOW) is True
        assert is_malformed_channel_message("hello", MESHCORE_DEFAULT_RTC_EPOCH + 60, NOW) is True
        assert is_malformed_channel_message("hello", NOW, NOW) is False


async def _chan_msg(text: str, received_at: int, *, malformed: bool = False) -> int:
    msg_id = await MessageRepository.create(
        msg_type="CHAN",
        text=text,
        received_at=received_at,
        conversation_key=CHAN_KEY,
        sender_timestamp=received_at,
        malformed=malformed,
    )
    assert msg_id is not None
    return msg_id


class TestFlagAtIngest:
    @pytest.mark.asyncio
    async def test_decrypted_channel_message_is_flagged_and_broadcast(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        events: list[tuple[str, dict]] = []

        def broadcast(event_type, data, *args, **kwargs):
            events.append((event_type, data))

        spam_id = await create_message_from_decrypted(
            packet_id=1,
            channel_key=CHAN_KEY,
            sender="Sam.2pup",
            message_text="ヂχ\U0004f373Р",
            timestamp=MESHCORE_DEFAULT_RTC_EPOCH + 10,
            received_at=NOW,
            broadcast_fn=broadcast,
        )
        ok_id = await create_message_from_decrypted(
            packet_id=2,
            channel_key=CHAN_KEY,
            sender="Friend",
            message_text="goedenavond",
            timestamp=NOW,
            received_at=NOW,
            broadcast_fn=broadcast,
        )
        assert spam_id is not None and ok_id is not None

        stored = {m.id: m for m in await MessageRepository.get_all(conversation_key=CHAN_KEY)}
        assert stored[spam_id].malformed is True
        assert stored[ok_id].malformed is False

        broadcast_flags = {
            data["id"]: data["malformed"] for event_type, data in events if event_type == "message"
        }
        assert broadcast_flags == {spam_id: True, ok_id: False}

    @pytest.mark.asyncio
    async def test_fallback_channel_message_is_flagged(self, test_db):
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")

        def broadcast(event_type, data, *args, **kwargs):
            pass

        async def ingest(sender: str, body: str):
            return await create_fallback_channel_message(
                conversation_key=CHAN_KEY,
                message_text=body,
                sender_timestamp=NOW,
                received_at=NOW,
                path=None,
                path_len=None,
                txt_type=0,
                sender_name=sender,
                channel_name="#public",
                broadcast_fn=broadcast,
            )

        spam = await ingest("Jelle_r4ip", "⚤ΰエ☛")
        ok = await ingest("Friend", "hoi")
        assert spam is not None and spam.malformed is True
        assert ok is not None and ok.malformed is False
        stored = {m.id: m for m in await MessageRepository.get_all(conversation_key=CHAN_KEY)}
        assert stored[spam.id].malformed is True
        assert stored[ok.id].malformed is False


class TestRawPacketPipeline:
    """A real GroupText from the 2026-10-05 burst, as heard on #public over the air."""

    RAW_PACKET_HEX = (
        "147EC900004CD89C8B1ACCE5F1E47E5765D5A0CFAEEDBB73ED34F1BCF1D06678F426CE9F599ED4093C38"
        "50C05E392A3298F52D3F70D860DE06AB2055A7DA1B777C"
    )
    PUBLIC_HASHTAG_KEY = "8B4B705B080C0D943B1C80F6B3EF6B6D"  # sha256("#public")[:16]
    HEARD_AT = 1791221050

    @pytest.mark.asyncio
    async def test_spam_packet_is_flagged_at_ingest(self, test_db, captured_broadcasts):
        from unittest.mock import patch

        from app.packet_processor import process_raw_packet

        await ChannelRepository.upsert(key=self.PUBLIC_HASHTAG_KEY, name="#public", is_hashtag=True)
        broadcasts, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(
                bytes.fromhex(self.RAW_PACKET_HEX), timestamp=self.HEARD_AT
            )

        assert result is not None and result.get("decrypted") is True
        messages = await MessageRepository.get_all(
            msg_type="CHAN", conversation_key=self.PUBLIC_HASHTAG_KEY
        )
        assert [(m.text, m.sender_timestamp, m.malformed) for m in messages] == [
            ("Ed186-a1vtn: ŧ¸£Δ₁", 1715772463, True)
        ]
        message_events = [b["data"] for b in broadcasts if b["type"] == "message"]
        assert [e["malformed"] for e in message_events] == [True]


class TestSettingsRoundTrip:
    @pytest.mark.asyncio
    async def test_default_off(self, test_db):
        assert (await AppSettingsRepository.get()).hide_malformed is False

    @pytest.mark.asyncio
    async def test_update_persists(self, test_db):
        result = await update_settings(AppSettingsUpdate(hide_malformed=True))
        assert result.hide_malformed is True
        assert (await AppSettingsRepository.get()).hide_malformed is True

        result = await update_settings(AppSettingsUpdate(hide_malformed=False))
        assert result.hide_malformed is False


class TestUnreadCountsMalformedFilter:
    @pytest.mark.asyncio
    async def test_malformed_messages_excluded(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=CHAN_KEY, name="#public")
        await ChannelRepository.update_last_read_at(CHAN_KEY, 0)

        # Oldest unread is a flagged message that also mentions us.
        await _chan_msg("Spam: @[Me] ŧ¸£Δ₁", now, malformed=True)
        visible_id = await _chan_msg("Friend: hoi", now + 1)
        await _chan_msg("Spam: ⚤ΰエ☛", now + 2, malformed=True)

        key = f"channel-{CHAN_KEY}"
        unfiltered = await MessageRepository.get_unread_counts("Me")
        assert unfiltered["counts"][key] == 3
        assert unfiltered["mentions"].get(key) is True
        assert unfiltered["last_message_times"][key] == now + 2

        filtered = await MessageRepository.get_unread_counts("Me", hide_malformed=True)
        assert filtered["counts"][key] == 1
        assert key not in filtered["mentions"]
        assert filtered["first_unread_ids"][key] == visible_id
        assert filtered["last_message_times"][key] == now + 1

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
            malformed=True,
        )
        result = await MessageRepository.get_unread_counts(None, hide_malformed=True)
        assert result["last_message_times"][f"channel-{CHAN_KEY}"] == now
