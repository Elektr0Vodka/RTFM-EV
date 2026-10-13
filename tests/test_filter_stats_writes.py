"""Writes to the per-message statistics columns (migration _143)."""

import pytest

from app.bot_lists.format import BotEntry
from app.repository import ChannelRepository, MessageRepository
from app.services.bot_lists import bot_lists
from app.services.messages import (
    create_fallback_channel_message,
    create_message_from_decrypted,
)

NOW = 1_800_000_000
PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
EMPTY = {
    "bot": 0,
    "malformed_reason": None,
    "spam_outcome": None,
    "spam_block": None,
    "spam_enforced": None,
    "spam_label": None,
}


async def stored(test_db, message_id: int) -> dict:
    cursor = await test_db.conn.execute(
        "SELECT bot, malformed_reason, spam_outcome, spam_block, spam_enforced, spam_label "
        "FROM messages WHERE id = ?",
        (message_id,),
    )
    return dict(await cursor.fetchone())


async def chan(text: str = "Bob: hi", **extra) -> int:
    message_id = await MessageRepository.create(
        msg_type="CHAN",
        text=text,
        received_at=NOW,
        conversation_key=PUBLIC,
        sender_timestamp=NOW,
        sender_name="Bob",
        **extra,
    )
    assert message_id is not None
    return message_id


class TestCreate:
    @pytest.mark.asyncio
    async def test_defaults(self, test_db):
        assert await stored(test_db, await chan()) == EMPTY

    @pytest.mark.asyncio
    async def test_stores_the_bot_flag_and_the_cause(self, test_db):
        message_id = await chan(malformed=True, malformed_reason="clock", bot=True)
        assert await stored(test_db, message_id) == {
            **EMPTY,
            "bot": 1,
            "malformed_reason": "clock",
        }


class TestSetSpamOutcomes:
    @pytest.mark.asyncio
    async def test_writes_a_batch(self, test_db):
        first, second = await chan("Bob: one"), await chan("Bob: two")
        await MessageRepository.set_spam_outcomes(
            [(first, "stopped", "campaign", True), (second, "clean", None, False)]
        )
        assert await stored(test_db, first) == {
            **EMPTY,
            "spam_outcome": "stopped",
            "spam_block": "campaign",
            "spam_enforced": 1,
        }
        assert await stored(test_db, second) == {
            **EMPTY,
            "spam_outcome": "clean",
            "spam_enforced": 0,
        }

    @pytest.mark.asyncio
    async def test_empty_batch_and_unknown_id_change_nothing(self, test_db):
        message_id = await chan()
        await MessageRepository.set_spam_outcomes([])
        await MessageRepository.set_spam_outcomes([(message_id + 999, "stopped", "hop", True)])
        assert await stored(test_db, message_id) == EMPTY


class TestSetSpamLabel:
    @pytest.mark.asyncio
    async def test_last_answer_wins(self, test_db):
        message_id = await chan()
        await MessageRepository.set_spam_label(message_id, "spam")
        assert (await stored(test_db, message_id))["spam_label"] == "spam"
        await MessageRepository.set_spam_label(message_id, "genuine")
        assert (await stored(test_db, message_id))["spam_label"] == "genuine"


GIBBERISH = "ŧ¸£Δ₁"


async def bot_list(*entries: BotEntry) -> None:
    state = await bot_lists.create_local("Mine")
    await bot_lists.update(state["created_id"], enabled=True)
    for entry in entries:
        await bot_lists.add_entry(state["created_id"], entry)


def quiet(event, data, **_):
    return None


async def heard(sender: str, text: str, offset: int) -> int:
    message_id = await create_message_from_decrypted(
        packet_id=offset,
        channel_key=PUBLIC,
        sender=sender,
        message_text=text,
        timestamp=NOW + offset,
        received_at=NOW + offset,
        broadcast_fn=quiet,
    )
    assert message_id is not None
    return message_id


class TestIsBot:
    @pytest.mark.asyncio
    async def test_matches_an_exact_name_or_a_key(self, test_db):
        await bot_list(BotEntry(name="PingBot"), BotEntry(name="KeyBot", public_key="ab" * 32))
        await bot_lists.ensure_loaded()
        assert bot_lists.is_bot("PingBot", None) is True
        assert bot_lists.is_bot("Renamed", "AB" * 32) is True
        assert bot_lists.is_bot("pingbot", None) is False
        assert bot_lists.is_bot("Alice", None) is False
        assert bot_lists.is_bot(None, None) is False

    @pytest.mark.asyncio
    async def test_an_exception_is_not_a_bot(self, test_db):
        await bot_list(BotEntry(name="PingBot"))
        await bot_lists.set_exceptions(["PingBot"])
        assert bot_lists.is_bot("PingBot", None) is False


class TestIngest:
    @pytest.mark.asyncio
    async def test_channel_message_records_the_bot_flag_and_the_cause(self, test_db):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")
        await bot_list(BotEntry(name="PingBot"))

        from_bot = await heard("PingBot", "ping", 1)
        from_person = await heard("Alice", "hello", 2)
        gibberish = await heard("Alice", GIBBERISH, 3)

        assert await stored(test_db, from_bot) == {**EMPTY, "bot": 1}
        assert await stored(test_db, from_person) == EMPTY
        assert await stored(test_db, gibberish) == {**EMPTY, "malformed_reason": "text"}

    @pytest.mark.asyncio
    async def test_fallback_channel_message_records_them_too(self, test_db):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")
        await bot_list(BotEntry(name="PingBot"))
        message = await create_fallback_channel_message(
            conversation_key=PUBLIC,
            message_text=GIBBERISH,
            sender_timestamp=NOW + 5,
            received_at=NOW + 5,
            path=None,
            path_len=None,
            txt_type=0,
            sender_name="PingBot",
            channel_name="Public",
            broadcast_fn=quiet,
        )
        assert message is not None
        assert await stored(test_db, message.id) == {
            **EMPTY,
            "bot": 1,
            "malformed_reason": "text",
        }

    @pytest.mark.asyncio
    async def test_a_failing_bot_lookup_does_not_cost_the_message(self, test_db, monkeypatch):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")

        async def broken() -> None:
            raise RuntimeError("bot lists unavailable")

        monkeypatch.setattr(bot_lists, "ensure_loaded", broken)
        message_id = await heard("PingBot", "ping", 7)
        assert await stored(test_db, message_id) == EMPTY
