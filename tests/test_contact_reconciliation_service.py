"""Tests for shared contact/message reconciliation helpers."""

import pytest

from app.repository import ContactNameHistoryRepository, ContactRepository, MessageRepository
from app.services.contact_reconciliation import (
    claim_prefix_messages_for_contact,
    promote_prefix_contacts_for_contact,
    record_contact_name_and_reconcile,
)


@pytest.mark.asyncio
async def test_claim_prefix_messages_for_contact_promotes_prefix_dm(test_db):
    public_key = "aa" * 32
    await ContactRepository.upsert({"public_key": public_key, "name": "Alice", "type": 1})

    await MessageRepository.create(
        msg_type="PRIV",
        text="hello",
        conversation_key=public_key[:12],
        sender_timestamp=1000,
        received_at=1000,
    )

    claimed = await claim_prefix_messages_for_contact(public_key=public_key)

    assert claimed == 1
    messages = await MessageRepository.get_all(conversation_key=public_key)
    assert len(messages) == 1
    assert messages[0].conversation_key == public_key


@pytest.mark.asyncio
async def test_prefix_promotion_carries_the_read_cursor(test_db):
    """A same-second arrival after the mark stays unread once the prefix is promoted."""
    public_key = "ab" * 32
    prefix = public_key[:12]
    await ContactRepository.upsert({"public_key": prefix, "name": "Alice", "type": 1})
    await MessageRepository.create(
        msg_type="PRIV",
        text="read before the mark",
        conversation_key=prefix,
        sender_timestamp=1000,
        received_at=1000,
    )
    await ContactRepository.update_last_read_at(prefix, 1000)
    await MessageRepository.create(
        msg_type="PRIV",
        text="arrived after the mark",
        conversation_key=prefix,
        sender_timestamp=1001,
        received_at=1000,
    )
    await ContactRepository.upsert({"public_key": public_key, "name": "Alice", "type": 1})

    await promote_prefix_contacts_for_contact(public_key=public_key)
    await claim_prefix_messages_for_contact(public_key=public_key)

    counts = (await MessageRepository.get_unread_counts(None))["counts"]
    assert counts == {f"contact-{public_key}": 1}


@pytest.mark.asyncio
async def test_record_contact_name_and_reconcile_records_history_and_backfills(test_db):
    public_key = "bb" * 32
    channel_key = "CC" * 16
    await ContactRepository.upsert({"public_key": public_key, "name": "Alice", "type": 1})

    await MessageRepository.create(
        msg_type="PRIV",
        text="dm",
        conversation_key=public_key[:12],
        sender_timestamp=1000,
        received_at=1000,
    )
    await MessageRepository.create(
        msg_type="CHAN",
        text="Alice: hello",
        conversation_key=channel_key,
        sender_timestamp=1001,
        received_at=1001,
        sender_name="Alice",
    )

    claimed, backfilled = await record_contact_name_and_reconcile(
        public_key=public_key,
        contact_name="Alice",
        timestamp=1234,
    )

    assert claimed == 1
    assert backfilled == 1

    history = await ContactNameHistoryRepository.get_history(public_key)
    assert len(history) == 1
    assert history[0].name == "Alice"
    assert history[0].first_seen == 1234
    assert history[0].last_seen == 1234

    messages = await MessageRepository.get_all(msg_type="CHAN", conversation_key=channel_key)
    assert len(messages) == 1
    assert messages[0].sender_key == public_key
