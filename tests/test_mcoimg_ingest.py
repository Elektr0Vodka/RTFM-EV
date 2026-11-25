"""MCOimg v3 channel pictures end to end (issue #391).

GRP_DATA ``0x0120`` datagram -> chat row with the envelope sender and the app
payload kept -> ``mcoimg`` on the message; ``im3:`` channel text -> the same;
a payload that does not decode never breaks the message list.
"""

import base64
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app import mcoimg_v3
from app.decoder import TXT_TYPE_GROUP_DATA
from app.models import Message
from app.repository import ChannelRepository, ContactRepository, MessageRepository

CHANNEL_KEY_HEX = "7ABA109EDCF304A84433CB71D0F3AB73"
FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "mcoimg_v3_decoder_fixtures.json").read_text(
        encoding="utf-8"
    )
)["fixtures"]
QUADTREE = next(f for f in FIXTURES if f["name"] == "quadtree")


def _envelope(name: str, app_payload: bytes) -> bytes:
    raw = name.encode("utf-8")
    return bytes([len(raw)]) + raw + app_payload


def _with_nonce(app_payload: bytes, nonce: int) -> bytes:
    return app_payload[:1] + bytes([nonce]) + app_payload[2:]


def _packet(blob: bytes, data_type: int = 0x0120) -> bytes:
    from tests.test_decoder import build_group_data_packet

    return build_group_data_packet(bytes.fromhex(CHANNEL_KEY_HEX), data_type, blob)


async def _messages() -> list[Message]:
    return await MessageRepository.get_all(
        msg_type="CHAN", conversation_key=CHANNEL_KEY_HEX, limit=20
    )


@pytest.mark.asyncio
async def test_datagram_becomes_picture_row_with_envelope_sender(test_db, captured_broadcasts):
    from app.packet_processor import process_raw_packet

    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    broadcasts, mock_broadcast = captured_broadcasts
    payload = base64.b64decode(QUADTREE["appPayloadBase64"])

    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        result = await process_raw_packet(
            _packet(_envelope("Zoë 📷", payload)), timestamp=1700000000
        )

    assert result is not None and result["decrypted"] is True
    assert result["sender"] == "Zoë 📷"
    (msg,) = await _messages()
    assert msg.txt_type == TXT_TYPE_GROUP_DATA
    assert msg.sender_name == "Zoë 📷"
    assert msg.text.startswith("Zoë 📷: [image] MCOimg v3 sha=")
    assert msg.mcoimg is not None and msg.mcoimg.ok
    assert msg.mcoimg.source == "datagram"
    assert (msg.mcoimg.width, msg.mcoimg.height) == (QUADTREE["width"], QUADTREE["height"])
    assert msg.mcoimg.image_id == mcoimg_v3.image_identity(payload)
    assert base64.b64decode(msg.mcoimg.png_base64 or "").startswith(b"\x89PNG")

    sent = [b for b in broadcasts if b["type"] == "message"]
    assert len(sent) == 1
    assert sent[0]["data"]["mcoimg"]["ok"] is True
    assert sent[0]["data"]["sender_name"] == "Zoë 📷"
    assert "app_payload" not in sent[0]["data"]


@pytest.mark.asyncio
async def test_envelope_name_resolves_unique_contact(test_db, captured_broadcasts):
    from app.packet_processor import process_raw_packet

    pubkey = "ab" * 32
    await ContactRepository.upsert({"public_key": pubkey, "name": "Alice", "type": 1})
    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    _, mock_broadcast = captured_broadcasts
    payload = base64.b64decode(QUADTREE["appPayloadBase64"])

    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        await process_raw_packet(_packet(_envelope("Alice", payload)), timestamp=1700000000)

    (msg,) = await _messages()
    assert msg.sender_name == "Alice"
    assert msg.sender_key == pubkey


@pytest.mark.asyncio
async def test_repeat_collapses_resend_is_new_row(test_db, captured_broadcasts):
    from app.packet_processor import process_raw_packet

    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    _, mock_broadcast = captured_broadcasts
    payload = base64.b64decode(QUADTREE["appPayloadBase64"])
    first = _packet(_envelope("Bob", _with_nonce(payload, 0x11)))
    resend = _packet(_envelope("Bob", _with_nonce(payload, 0x22)))

    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        await process_raw_packet(first, timestamp=1700000000)
        repeat = await process_raw_packet(first, timestamp=1700000001)
        await process_raw_packet(resend, timestamp=1700000002)

    assert repeat is not None and repeat["message_id"] is None
    messages = await _messages()
    assert len(messages) == 2
    # Same picture: the identity hash ignores the nonce.
    assert messages[0].mcoimg and messages[1].mcoimg
    assert messages[0].mcoimg.image_id == messages[1].mcoimg.image_id


@pytest.mark.asyncio
async def test_other_subtype_keeps_generic_placeholder(test_db, captured_broadcasts):
    from app.packet_processor import process_raw_packet

    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    _, mock_broadcast = captured_broadcasts
    blob = _envelope("Bob", b"\x14" + b"\x00" * 10)  # MCOimg v4: not decoded here

    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        await process_raw_packet(_packet(blob), timestamp=1700000000)

    (msg,) = await _messages()
    assert msg.text.startswith("[data] type=0x0120 len=")
    assert msg.mcoimg is None
    assert msg.sender_name is None


@pytest.mark.asyncio
async def test_bad_body_is_stored_and_marked_not_ok(test_db, captured_broadcasts, client):
    from app.packet_processor import process_raw_packet

    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    _, mock_broadcast = captured_broadcasts
    broken = b"\x13" + b"\xff" * 30

    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        result = await process_raw_packet(_packet(_envelope("Bob", broken)), timestamp=1700000000)

    assert result is not None and result["message_id"] is not None
    (msg,) = await _messages()
    assert msg.mcoimg is not None
    assert msg.mcoimg.ok is False
    assert msg.mcoimg.png_base64 is None

    # A good message next to the broken one: the list endpoint still answers.
    await MessageRepository.create(
        msg_type="CHAN",
        text="Carol: hello",
        received_at=1700000005,
        conversation_key=CHANNEL_KEY_HEX,
        sender_timestamp=1700000005,
    )
    async with client as c:
        response = await c.get(
            "/api/messages", params={"type": "CHAN", "conversation_key": CHANNEL_KEY_HEX}
        )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    by_text = {m["text"]: m for m in body}
    assert by_text["Carol: hello"]["mcoimg"] is None
    broken_row = next(m for m in body if m["text"] != "Carol: hello")
    assert broken_row["mcoimg"]["ok"] is False


@pytest.mark.parametrize(
    "stored",
    [
        b"",
        b"\x13",
        b"\x00\x01\x02",
        bytes(range(256))[:165],
    ],
)
def test_message_model_never_raises_on_stored_payload(stored):
    msg = Message(
        id=1,
        type="CHAN",
        conversation_key=CHANNEL_KEY_HEX,
        text="Bob: [image] MCOimg v3 sha=00000000",
        received_at=1,
        app_payload=stored,
    )
    assert msg.mcoimg is not None and msg.mcoimg.ok is False


def test_im3_channel_text_is_a_picture():
    msg = Message(
        id=1,
        type="CHAN",
        conversation_key=CHANNEL_KEY_HEX,
        text=f"Bob: {QUADTREE['text']}",
        received_at=1,
    )
    assert msg.mcoimg is not None and msg.mcoimg.ok
    assert msg.mcoimg.source == "text"
    assert (msg.mcoimg.width, msg.mcoimg.height) == (QUADTREE["width"], QUADTREE["height"])
    # Without a sender prefix (outgoing / own text) too.
    bare = Message(id=2, type="CHAN", conversation_key="x", text=QUADTREE["text"], received_at=1)
    assert bare.mcoimg is not None and bare.mcoimg.ok


@pytest.mark.parametrize(
    "text",
    [
        "Bob: look im3:g/5WjAL`NA",
        "Bob: im3:g/5WjAL`NA and more words",
        "the prefix im3: is for pictures",
        "Bob: hello",
        "",
    ],
)
def test_text_that_only_quotes_im3_stays_text(text):
    msg = Message(id=1, type="CHAN", conversation_key="x", text=text, received_at=1)
    assert msg.mcoimg is None


def test_im3_text_that_does_not_decode_is_marked_not_ok():
    msg = Message(id=1, type="CHAN", conversation_key="x", text="Bob: im3:AAAAAAAA", received_at=1)
    assert msg.mcoimg is not None
    assert msg.mcoimg.ok is False
    assert msg.mcoimg.source == "text"


@pytest.mark.asyncio
async def test_im3_text_row_round_trips_through_the_list(test_db, client):
    await MessageRepository.create(
        msg_type="CHAN",
        text=f"Bob: {QUADTREE['text']}",
        received_at=1700000000,
        conversation_key=CHANNEL_KEY_HEX,
        sender_timestamp=1700000000,
        sender_name="Bob",
    )
    async with client as c:
        response = await c.get(
            "/api/messages", params={"type": "CHAN", "conversation_key": CHANNEL_KEY_HEX}
        )
    assert response.status_code == 200
    (row,) = response.json()
    assert row["mcoimg"]["ok"] is True
    assert row["mcoimg"]["source"] == "text"


@pytest.mark.asyncio
async def test_im3_channel_text_through_channel_ingest(test_db, captured_broadcasts):
    from app.packet_processor import create_message_from_decrypted
    from app.repository import RawPacketRepository

    await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
    packet_id, _ = await RawPacketRepository.create(b"im3_chan", 1700000000)
    broadcasts, mock_broadcast = captured_broadcasts
    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        msg_id = await create_message_from_decrypted(
            packet_id=packet_id,
            channel_key=CHANNEL_KEY_HEX,
            sender="Bob",
            message_text=QUADTREE["text"],
            timestamp=1700000000,
            received_at=1700000000,
        )
    assert msg_id is not None
    (msg,) = await _messages()
    assert msg.smaz is False
    assert msg.mcoimg is not None and msg.mcoimg.ok and msg.mcoimg.source == "text"
    (sent,) = [b for b in broadcasts if b["type"] == "message"]
    assert sent["data"]["mcoimg"]["ok"] is True


def test_smaz_of_im3_text_is_not_a_conforming_body_and_stays_text():
    """SMAZ makes Base91 longer, so meshcore-open never sends im3: compressed and
    app.smaz rejects such a body: it is stored as typed and is not a picture."""
    from app import smaz

    body = "s:" + base64.b64encode(smaz.compress(QUADTREE["text"].encode())).decode()
    assert smaz.try_decode_prefixed(body) is None
    msg = Message(id=1, type="CHAN", conversation_key="x", text=f"Bob: {body}", received_at=1)
    assert msg.mcoimg is None


def test_smaz_flagged_row_holding_im3_text_is_still_a_picture():
    msg = Message(
        id=1,
        type="CHAN",
        conversation_key="x",
        text=f"Bob: {QUADTREE['text']}",
        received_at=1,
        smaz=True,
    )
    assert msg.smaz is True
    assert msg.mcoimg is not None and msg.mcoimg.ok
