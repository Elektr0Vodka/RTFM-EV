"""SF stamps on stored packets and messages, and contact radio sightings (migration _160)."""

from unittest.mock import patch

import pytest

from app.models import RadioStamp
from app.repository.contact_radio_sightings import ContactRadioSightingsRepository
from app.repository.messages import MessageRepository
from app.repository.raw_packets import RawPacketRepository
from app.services.messages import build_message_model

SF7 = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)
SF8 = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
KEY = "ab" * 32


async def _packet_stamp(test_db, packet_id: int):
    async with test_db.conn.execute(
        "SELECT radio_freq, radio_bw, radio_sf, radio_cr FROM raw_packets WHERE id = ?",
        (packet_id,),
    ) as cur:
        return tuple(await cur.fetchone())


class TestRawPacketStamp:
    @pytest.mark.asyncio
    async def test_create_stores_stamp(self, test_db):
        packet_id, _ = await RawPacketRepository.create(b"\x01\x02\x03", 1, radio_stamp=SF8)
        assert await _packet_stamp(test_db, packet_id) == (869.618, 62.5, 8, 8)

    @pytest.mark.asyncio
    async def test_create_without_stamp_stores_null(self, test_db):
        packet_id, _ = await RawPacketRepository.create(b"\x01\x02\x04", 1)
        assert await _packet_stamp(test_db, packet_id) == (None, None, None, None)

    @pytest.mark.asyncio
    async def test_duplicate_keeps_first_stamp(self, test_db):
        packet_id, _ = await RawPacketRepository.create(b"\x01\x02\x05", 1, radio_stamp=SF7)
        dup_id, is_new = await RawPacketRepository.create(b"\x01\x02\x05", 2, radio_stamp=SF8)
        assert dup_id == packet_id and is_new is False
        assert (await _packet_stamp(test_db, packet_id))[2] == 7


class TestMessageStamp:
    @pytest.mark.asyncio
    async def test_create_uses_current_stamp_by_default(self, test_db):
        with patch("app.radio_stamp.current_radio_stamp", return_value=SF8):
            msg_id = await MessageRepository.create(
                msg_type="CHAN", text="hi", received_at=10, conversation_key="AA" * 16
            )
        assert msg_id is not None
        message = await MessageRepository.get_by_id(msg_id)
        assert message is not None
        assert message.radio_stamp == SF8

    @pytest.mark.asyncio
    async def test_create_without_radio_has_no_stamp(self, test_db):
        with patch("app.radio_stamp.current_radio_stamp", return_value=None):
            msg_id = await MessageRepository.create(
                msg_type="CHAN", text="hello", received_at=11, conversation_key="AA" * 16
            )
        assert msg_id is not None
        message = await MessageRepository.get_by_id(msg_id)
        assert message is not None
        assert message.radio_stamp is None

    def test_build_message_model_uses_current_stamp(self):
        with patch("app.radio_stamp.current_radio_stamp", return_value=SF7):
            message = build_message_model(
                message_id=1,
                msg_type="PRIV",
                conversation_key=KEY,
                text="x",
                sender_timestamp=None,
                received_at=1,
            )
        assert message.radio_stamp == SF7


class TestContactRadioSightings:
    @pytest.mark.asyncio
    async def test_record_new_then_existing(self, test_db):
        assert await ContactRadioSightingsRepository.record(KEY, SF8, 100) is True
        assert await ContactRadioSightingsRepository.record(KEY, SF8, 200) is False
        sightings = (await ContactRadioSightingsRepository.get_all())[KEY]
        assert len(sightings) == 1
        assert sightings[0].first_seen == 100
        assert sightings[0].last_seen == 200

    @pytest.mark.asyncio
    async def test_two_sfs_two_rows(self, test_db):
        await ContactRadioSightingsRepository.record(KEY, SF7, 100)
        await ContactRadioSightingsRepository.record(KEY, SF8, 101)
        sfs = sorted(s.sf for s in (await ContactRadioSightingsRepository.get_all())[KEY])
        assert sfs == [7, 8]

    @pytest.mark.asyncio
    async def test_float_noise_is_same_sighting(self, test_db):
        await ContactRadioSightingsRepository.record(KEY, SF8, 100)
        noisy = RadioStamp(freq=869.6180004, bw=62.5, sf=8, cr=8)
        assert await ContactRadioSightingsRepository.record(KEY, noisy, 101) is False

    @pytest.mark.asyncio
    async def test_delete_for_contact(self, test_db):
        await ContactRadioSightingsRepository.record(KEY, SF8, 100)
        await ContactRadioSightingsRepository.delete_for(KEY)
        assert KEY not in await ContactRadioSightingsRepository.get_all()

    @pytest.mark.asyncio
    async def test_record_normalizes_key_case(self, test_db):
        await ContactRadioSightingsRepository.record(KEY.upper(), SF8, 100)
        assert KEY in await ContactRadioSightingsRepository.get_all()
