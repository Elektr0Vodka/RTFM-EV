"""Resolving a hash-style reaction to the message it reacts to."""

import pytest
from fastapi import HTTPException

from app.repository import MessageRepository
from app.routers.messages import get_reaction_target

CHAN = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
CONTACT = "ab" * 32


async def _msg(text, ts, *, msg_type="CHAN", key=CHAN, outgoing=False, received=None):
    return await MessageRepository.create(
        msg_type=msg_type,
        text=text,
        conversation_key=key,
        sender_timestamp=ts,
        received_at=received if received is not None else ts + 5,
        outgoing=outgoing,
    )


@pytest.mark.asyncio
async def test_channel_reaction_resolves_to_target(test_db):
    target_id = await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549)
    await _msg("Someone: Test", 1790113550)  # same body, other timestamp
    reaction_id = await _msg("512 A: @[NL-OV-ENS-NL1CTM-TEST]👍\n3eykm5rn", 1790113600)

    result = await get_reaction_target(reaction_id)

    assert result.target is not None
    assert result.target.id == target_id
    assert result.emoji == "👍"
    assert result.target_hash == "3eykm5rn"


@pytest.mark.asyncio
async def test_reaction_to_own_outgoing_message_resolves(test_db):
    target_id = await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549, outgoing=True)
    reaction_id = await _msg("Other: @[NL-OV-ENS-NL1CTM-TEST]👍\n3eykm5rn", 1790113600)

    result = await get_reaction_target(reaction_id)

    assert result.target is not None and result.target.id == target_id


@pytest.mark.asyncio
async def test_dm_reaction_resolves_to_target(test_db):
    target_id = await _msg("Test", 1790113549, msg_type="PRIV", key=CONTACT, outgoing=True)
    reaction_id = await _msg("👍\n3eykm5rn", 1790113600, msg_type="PRIV", key=CONTACT)

    result = await get_reaction_target(reaction_id)

    assert result.target is not None and result.target.id == target_id


@pytest.mark.asyncio
async def test_target_in_other_conversation_is_not_matched(test_db):
    await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549, key="CC" * 16)
    reaction_id = await _msg("512 A: @[NL-OV-ENS-NL1CTM-TEST]👍\n3eykm5rn", 1790113600)

    result = await get_reaction_target(reaction_id)

    assert result.target is None
    assert result.target_hash == "3eykm5rn"


@pytest.mark.asyncio
async def test_non_reaction_message_is_rejected(test_db):
    message_id = await _msg("Bob: hello", 1790113549)

    with pytest.raises(HTTPException) as exc:
        await get_reaction_target(message_id)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_missing_message_is_404(test_db):
    with pytest.raises(HTTPException) as exc:
        await get_reaction_target(999999)
    assert exc.value.status_code == 404


class TestSendReaction:
    @pytest.mark.asyncio
    async def test_channel_reaction_sent_in_wire_format(self, test_db):
        from unittest.mock import AsyncMock, patch

        from app.models import ReactRequest
        from app.routers.messages import react_to_message

        target_id = await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549)
        sent = AsyncMock(return_value="sent-message")
        with patch("app.routers.messages.send_channel_message", sent):
            result = await react_to_message(target_id, ReactRequest(emoji="👍"))

        assert result == "sent-message"
        request = sent.await_args.args[0]
        assert request.channel_key == CHAN
        assert request.text == "@[NL-OV-ENS-NL1CTM-TEST]👍\n3eykm5rn"

    @pytest.mark.asyncio
    async def test_dm_reaction_sent_without_sender(self, test_db):
        from unittest.mock import AsyncMock, patch

        from app.models import ReactRequest
        from app.routers.messages import react_to_message

        target_id = await _msg("Test", 1790113549, msg_type="PRIV", key=CONTACT)
        sent = AsyncMock(return_value="sent-message")
        with patch("app.routers.messages.send_direct_message", sent):
            await react_to_message(target_id, ReactRequest(emoji="👍"))

        request = sent.await_args.args[0]
        assert request.destination == CONTACT
        assert request.text == "👍\n3eykm5rn"

    @pytest.mark.asyncio
    async def test_rejects_non_emoji(self, test_db):
        from app.models import ReactRequest
        from app.routers.messages import react_to_message

        target_id = await _msg("Bob: hi", 1790113549)
        with pytest.raises(HTTPException) as exc:
            await react_to_message(target_id, ReactRequest(emoji="nice"))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_reacting_to_a_reaction(self, test_db):
        from app.models import ReactRequest
        from app.routers.messages import react_to_message

        reaction_id = await _msg("512 A: @[Bob]👍\n3eykm5rn", 1790113600)
        with pytest.raises(HTTPException) as exc:
            await react_to_message(reaction_id, ReactRequest(emoji="👍"))
        assert exc.value.status_code == 400


class TestOpenReactionTargets:
    @pytest.mark.asyncio
    async def test_open_v3_channel_reaction_resolves(self, test_db):
        from app.reaction_payloads import open_reaction_hash

        target_id = await _msg("Alice: hello there", 1700000000)
        await _msg("Carol: hello there", 1700000000)  # other sender, same text/time
        h = open_reaction_hash(1700000000, "Alice", "hello there")
        reaction_id = await _msg(f"Bob: r:{h}:00", 1700000100)

        result = await get_reaction_target(reaction_id)

        assert result.target is not None and result.target.id == target_id
        assert result.target_hash == h

    @pytest.mark.asyncio
    async def test_open_v3_dm_reaction_resolves(self, test_db):
        from app.reaction_payloads import open_reaction_hash

        target_id = await _msg("hello there", 1700000000, msg_type="PRIV", key=CONTACT)
        h = open_reaction_hash(1700000000, None, "hello there")
        reaction_id = await _msg(f"r:{h}:00", 1700000100, msg_type="PRIV", key=CONTACT)

        result = await get_reaction_target(reaction_id)

        assert result.target is not None and result.target.id == target_id

    @pytest.mark.asyncio
    async def test_open_v1_channel_reaction_resolves(self, test_db):
        from app.reaction_payloads import dart_string_hash

        target_id = await _msg("Alice: hello there", 1700000000)
        name_h, text_h = dart_string_hash("Alice"), dart_string_hash("hello there")
        reaction_id = await _msg(f"Bob: r:1700000000123_{name_h}_{text_h}:👍", 1700000100)

        result = await get_reaction_target(reaction_id)

        assert result.target is not None and result.target.id == target_id
        assert result.emoji == "👍"
