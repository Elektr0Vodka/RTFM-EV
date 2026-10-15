"""Incoming MeshCore 1.18 CLI commands (txt_type 3) from other companions."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.decoder import TXT_TYPE_CLI_COMMAND, DecryptedDirectMessage
from app.fanout.manager import _scope_matches_message
from app.models import ContactUpsert
from app.push.manager import PushManager
from app.repository import ContactRepository, MessageRepository
from app.services.dm_ingest import cli_permitted_for, ingest_decrypted_direct_message

KEY = "ee" * 32


def _decrypted(txt_type: int, text: str = "get wifi.pwd") -> DecryptedDirectMessage:
    return DecryptedDirectMessage(
        timestamp=1_800_000_000,
        flags=txt_type << 2,
        message=text,
        dest_hash="aa",
        src_hash="ee",
        signed_sender_prefix=None,
    )


def test_cli_permitted_for():
    assert cli_permitted_for(MagicMock(flags=0x11), TXT_TYPE_CLI_COMMAND) is True
    assert cli_permitted_for(MagicMock(flags=0x01), TXT_TYPE_CLI_COMMAND) is False
    assert cli_permitted_for(None, TXT_TYPE_CLI_COMMAND) is False
    assert cli_permitted_for(MagicMock(flags=0x11), 0) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(("flags", "expected"), [(0x11, True), (0x01, False)])
async def test_incoming_cli_command_is_stored_with_permission(test_db, flags, expected):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, type=1, flags=flags, name="Bob"))

    message = await ingest_decrypted_direct_message(
        packet_id=None,
        decrypted=_decrypted(TXT_TYPE_CLI_COMMAND),
        their_public_key=KEY,
        received_at=1_800_000_000,
        broadcast_fn=MagicMock(),
    )

    assert message is not None
    assert message.txt_type == TXT_TYPE_CLI_COMMAND
    assert message.cli_permitted is expected
    stored = await MessageRepository.get_by_id(message.id)
    assert stored is not None
    assert stored.cli_permitted is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("txt_type", [1, TXT_TYPE_CLI_COMMAND])
async def test_outgoing_cli_echo_not_stored(test_db, txt_type):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, type=1, name="Bob"))

    message = await ingest_decrypted_direct_message(
        packet_id=None,
        decrypted=_decrypted(txt_type, "get name"),
        their_public_key=KEY,
        received_at=1_800_000_000,
        outgoing=True,
        broadcast_fn=MagicMock(),
    )

    assert message is None


@pytest.mark.asyncio
async def test_cli_command_rows_do_not_count_as_unread(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, type=1, name="Bob"))
    await MessageRepository.create(
        msg_type="PRIV",
        text="get name",
        received_at=1_800_000_000,
        conversation_key=KEY,
        sender_timestamp=1_800_000_000,
        txt_type=TXT_TYPE_CLI_COMMAND,
        cli_permitted=False,
    )

    unread = await MessageRepository.get_unread_counts()

    assert f"contact-{KEY}" not in unread["counts"]
    assert f"contact-{KEY}" not in unread["last_message_times"]


@pytest.mark.asyncio
async def test_plain_dm_still_counts_as_unread(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=KEY, type=1, name="Bob"))
    await MessageRepository.create(
        msg_type="PRIV",
        text="hello",
        received_at=1_800_000_000,
        conversation_key=KEY,
        sender_timestamp=1_800_000_000,
    )

    unread = await MessageRepository.get_unread_counts()

    assert unread["counts"][f"contact-{KEY}"] == 1


def test_fanout_drops_cli_command_rows_even_for_all_messages_scope():
    assert _scope_matches_message({"messages": "all"}, {"type": "PRIV", "txt_type": 3}) is False
    assert _scope_matches_message({"messages": "all"}, {"type": "PRIV", "txt_type": 0}) is True


@pytest.mark.asyncio
async def test_push_skips_cli_command_rows():
    with patch(
        "app.push.manager.AppSettingsRepository.get_push_conversations", AsyncMock()
    ) as conv:
        await PushManager().dispatch_message(
            {"type": "PRIV", "conversation_key": KEY, "txt_type": 3}
        )
    conv.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("text", "secret"),
    [("set wifi.pwd hunter2", "hunter2"), ("set pin 123456", "123456")],
)
async def test_incoming_secret_commands_are_masked_in_log_and_storage(
    test_db, caplog, text, secret
):
    import logging

    await ContactRepository.upsert(ContactUpsert(public_key=KEY, type=1, flags=0x11, name="Bob"))

    with caplog.at_level(logging.DEBUG):
        message = await ingest_decrypted_direct_message(
            packet_id=None,
            decrypted=_decrypted(TXT_TYPE_CLI_COMMAND, text),
            their_public_key=KEY,
            received_at=1_800_000_000,
            broadcast_fn=MagicMock(),
        )

    assert message is not None
    assert secret not in message.text
    assert message.text.endswith("***")
    stored = await MessageRepository.get_by_id(message.id)
    assert stored is not None
    assert secret not in stored.text
    assert secret not in caplog.text
