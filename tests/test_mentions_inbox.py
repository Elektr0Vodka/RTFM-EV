"""The mentions list: incoming messages that mention the radio's name."""

from unittest.mock import MagicMock, patch

import pytest

from app.repository import AppSettingsRepository, MessageRepository
from app.routers.messages import list_mentions

CHAN = "AA" * 16
DM = "bb" * 32


async def _msg(text: str, ts: int, *, msg_type="CHAN", key=CHAN, outgoing=False, **extra):
    msg_id = await MessageRepository.create(
        msg_type=msg_type,
        text=text,
        conversation_key=key,
        sender_timestamp=ts,
        received_at=ts,
        outgoing=outgoing,
        **extra,
    )
    assert msg_id is not None
    return msg_id


@pytest.mark.asyncio
async def test_lists_incoming_mentions_newest_first(test_db):
    first = await _msg("Bob: hi @[MyNode] there", 100)
    await _msg("Bob: nothing for you", 101)
    dm = await _msg("@[mynode] ping", 102, msg_type="PRIV", key=DM)
    await _msg("MyNode: @[MyNode] talking to myself", 103, outgoing=True)

    rows = await MessageRepository.get_mentions("MyNode")
    assert [m.id for m in rows] == [dm, first]


@pytest.mark.asyncio
async def test_pages_backwards(test_db):
    ids = [await _msg(f"Bob: @[MyNode] {i}", 100 + i) for i in range(3)]
    page1 = await MessageRepository.get_mentions("MyNode", limit=2)
    assert [m.id for m in page1] == [ids[2], ids[1]]
    last = page1[-1]
    page2 = await MessageRepository.get_mentions(
        "MyNode", limit=2, before=last.received_at, before_id=last.id
    )
    assert [m.id for m in page2] == [ids[0]]


@pytest.mark.asyncio
async def test_leaves_out_hidden_traffic(test_db):
    await _msg("Garbled: @[MyNode] xx", 100, malformed=True)
    await _msg("Eve: @[MyNode] hello", 101, sender_name="Eve")
    shown = await _msg("Bob: @[MyNode] ok", 102)

    rows = await MessageRepository.get_mentions(
        "MyNode", blocked_names=["Eve"], hide_malformed=True
    )
    assert [m.id for m in rows] == [shown]


@pytest.mark.asyncio
async def test_endpoint_uses_the_radio_name(test_db):
    shown = await _msg("Bob: @[Radio One] hi", 100)
    await AppSettingsRepository.get()
    mc = MagicMock()
    mc.self_info = {"name": "Radio One"}
    with patch("app.routers.messages.radio_manager") as rm:
        rm.meshcore = mc
        rows = await list_mentions(limit=50, before=None, before_id=None)
    assert [m.id for m in rows] == [shown]


@pytest.mark.asyncio
async def test_endpoint_is_empty_without_a_radio_name(test_db):
    await _msg("Bob: @[Radio One] hi", 100)
    with patch("app.routers.messages.radio_manager") as rm:
        rm.meshcore = None
        assert await list_mentions(limit=50, before=None, before_id=None) == []
