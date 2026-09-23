"""Incoming SMAZ "s:<base64>" bodies are decoded before storage (DMs and channels)."""

import base64
from unittest.mock import MagicMock, patch

import pytest

from app import smaz
from app.decoder import DecryptedDirectMessage
from app.repository import ChannelRepository, MessageRepository, RawPacketRepository

CHANNEL_KEY = "ABC123DEF456ABC123DEF456ABC12345"
CONTACT_PUB = "a1b2c3d3ba9f5fa8705b9845fe11cc6f01d1d49caaf4d122ac7121663c5beec7"
OUR_PUB = "FACE123334789E2B81519AFDBC39A3C9EB7EA3457AD367D3243597A484847E46"
TS = 1700000000

PLAIN = "@[TestUser] meet at the station with the others at the hill"
SMAZ_BODY = "s:" + base64.b64encode(smaz.compress(PLAIN.encode())).decode()


def test_fixture_is_a_real_smaz_body():
    assert smaz.try_decode_prefixed(SMAZ_BODY) == PLAIN


async def _all(msg_type: str, key: str):
    return await MessageRepository.get_all(msg_type=msg_type, conversation_key=key, limit=10)


class TestChannelIngest:
    @pytest.mark.asyncio
    async def test_packet_path_stores_decoded_text(self, test_db, captured_broadcasts):
        from app.packet_processor import create_message_from_decrypted

        packet_id, _ = await RawPacketRepository.create(b"smaz_chan", TS)
        broadcasts, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            msg_id = await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=CHANNEL_KEY,
                sender="Alice",
                message_text=SMAZ_BODY,
                timestamp=TS,
                received_at=TS,
            )

        assert msg_id is not None
        [stored] = await _all("CHAN", CHANNEL_KEY)
        assert stored.text == f"Alice: {PLAIN}"
        [sent] = [b for b in broadcasts if b["type"] == "message"]
        assert sent["data"]["text"] == f"Alice: {PLAIN}"

    @pytest.mark.asyncio
    async def test_decoded_mention_flags_unread(self, test_db, captured_broadcasts):
        from app.packet_processor import create_message_from_decrypted

        await ChannelRepository.upsert(key=CHANNEL_KEY, name="Test")
        packet_id, _ = await RawPacketRepository.create(b"smaz_mention", TS)
        _, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=CHANNEL_KEY,
                sender="Alice",
                message_text=SMAZ_BODY,
                timestamp=TS,
                received_at=TS,
            )

        result = await MessageRepository.get_unread_counts("TestUser")
        assert result["mentions"].get(f"channel-{CHANNEL_KEY}") is True

    @pytest.mark.asyncio
    async def test_fallback_path_stores_decoded_text(self, test_db, captured_broadcasts):
        from app.services.messages import create_fallback_channel_message

        _, mock_broadcast = captured_broadcasts
        message = await create_fallback_channel_message(
            conversation_key=CHANNEL_KEY,
            message_text=SMAZ_BODY,
            sender_timestamp=TS,
            received_at=TS,
            path=None,
            path_len=None,
            txt_type=0,
            sender_name="Alice",
            channel_name=None,
            broadcast_fn=mock_broadcast,
        )

        assert message is not None
        assert message.text == f"Alice: {PLAIN}"
        [stored] = await _all("CHAN", CHANNEL_KEY)
        assert stored.text == f"Alice: {PLAIN}"

    @pytest.mark.asyncio
    async def test_plain_s_prefix_text_is_kept(self, test_db, captured_broadcasts):
        from app.packet_processor import create_message_from_decrypted

        packet_id, _ = await RawPacketRepository.create(b"plain_s", TS)
        _, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=CHANNEL_KEY,
                sender="Alice",
                message_text="s:test",
                timestamp=TS,
                received_at=TS,
            )

        [stored] = await _all("CHAN", CHANNEL_KEY)
        assert stored.text == "Alice: s:test"


class TestDirectMessageIngest:
    @pytest.mark.asyncio
    async def test_packet_path_stores_decoded_text(self, test_db, captured_broadcasts):
        from app.packet_processor import create_dm_message_from_decrypted

        pkt_id, _ = await RawPacketRepository.create(b"smaz_dm", TS)
        decrypted = DecryptedDirectMessage(
            timestamp=TS, flags=0, message=SMAZ_BODY, dest_hash="fa", src_hash="a1"
        )
        _, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            msg_id = await create_dm_message_from_decrypted(
                packet_id=pkt_id,
                decrypted=decrypted,
                their_public_key=CONTACT_PUB,
                our_public_key=OUR_PUB,
                received_at=TS,
                outgoing=False,
            )

        assert msg_id is not None
        [stored] = await _all("PRIV", CONTACT_PUB.lower())
        assert stored.text == PLAIN

    @pytest.mark.asyncio
    async def test_fallback_path_decodes_and_dedups_against_packet_path(
        self, test_db, captured_broadcasts
    ):
        from app.event_handlers import on_contact_message
        from app.packet_processor import create_dm_message_from_decrypted

        pkt_id, _ = await RawPacketRepository.create(b"smaz_dm_dual", TS)
        decrypted = DecryptedDirectMessage(
            timestamp=TS, flags=0, message=SMAZ_BODY, dest_hash="fa", src_hash="a1"
        )
        _, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await create_dm_message_from_decrypted(
                packet_id=pkt_id,
                decrypted=decrypted,
                their_public_key=CONTACT_PUB,
                our_public_key=OUR_PUB,
                received_at=TS,
                outgoing=False,
            )

        event = MagicMock()
        event.payload = {
            "public_key": CONTACT_PUB,
            "text": SMAZ_BODY,
            "txt_type": 0,
            "sender_timestamp": TS,
        }
        with patch("app.event_handlers.broadcast_event", mock_broadcast):
            await on_contact_message(event)

        stored = await _all("PRIV", CONTACT_PUB.lower())
        assert [m.text for m in stored] == [PLAIN]

    @pytest.mark.asyncio
    async def test_fallback_only_path_stores_decoded_text(self, test_db, captured_broadcasts):
        from app.event_handlers import on_contact_message

        _, mock_broadcast = captured_broadcasts
        event = MagicMock()
        event.payload = {
            "public_key": CONTACT_PUB,
            "text": SMAZ_BODY,
            "txt_type": 0,
            "sender_timestamp": TS,
        }
        with patch("app.event_handlers.broadcast_event", mock_broadcast):
            await on_contact_message(event)

        [stored] = await _all("PRIV", CONTACT_PUB.lower())
        assert stored.text == PLAIN

    @pytest.mark.asyncio
    async def test_outgoing_echo_is_not_decoded(self, test_db, captured_broadcasts):
        """Our own sends are never SMAZ; an echo must still match the stored row."""
        from app.packet_processor import create_dm_message_from_decrypted

        msg_id = await MessageRepository.create(
            msg_type="PRIV",
            text=SMAZ_BODY,
            conversation_key=CONTACT_PUB.lower(),
            sender_timestamp=TS,
            received_at=TS,
            outgoing=True,
        )
        pkt_id, _ = await RawPacketRepository.create(b"smaz_dm_echo", TS + 1)
        decrypted = DecryptedDirectMessage(
            timestamp=TS, flags=0, message=SMAZ_BODY, dest_hash="a1", src_hash="fa"
        )
        _, mock_broadcast = captured_broadcasts
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await create_dm_message_from_decrypted(
                packet_id=pkt_id,
                decrypted=decrypted,
                their_public_key=CONTACT_PUB,
                our_public_key=OUR_PUB,
                received_at=TS + 1,
                path="aabb",
                outgoing=True,
            )

        assert result is None
        stored = await _all("PRIV", CONTACT_PUB.lower())
        assert [(m.id, m.text) for m in stored] == [(msg_id, SMAZ_BODY)]
