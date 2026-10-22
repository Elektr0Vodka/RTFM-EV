"""Server-side SF filter for messages (``hidden_radio_sfs``, migration _160)."""

from unittest.mock import patch

import pytest

from app.models import RadioStamp
from app.radio_stamp import message_hidden_by_radio_sf
from app.repository import AppSettingsRepository, MessageRepository

SF7 = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)
SF8 = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
CHAN = "AB" * 16


async def _msg(text: str, stamp, *, outgoing: bool = False, received_at: int = 100):
    with patch("app.radio_stamp.current_radio_stamp", return_value=stamp):
        return await MessageRepository.create(
            msg_type="CHAN",
            text=text,
            received_at=received_at,
            conversation_key=CHAN,
            sender_timestamp=received_at,
            outgoing=outgoing,
        )


class TestSettings:
    @pytest.mark.asyncio
    async def test_round_trip_keeps_valid_values(self, test_db):
        await AppSettingsRepository.update(hidden_radio_sfs=[8, 4, 0, 13, 8, 12])
        assert (await AppSettingsRepository.get()).hidden_radio_sfs == [0, 8, 12]

    @pytest.mark.asyncio
    async def test_default_empty(self, test_db):
        assert (await AppSettingsRepository.get()).hidden_radio_sfs == []

    @pytest.mark.asyncio
    async def test_router_update(self, test_db):
        from app.routers.settings import AppSettingsUpdate, update_settings

        result = await update_settings(AppSettingsUpdate(hidden_radio_sfs=[7, 99]))
        assert result.hidden_radio_sfs == [7]


class TestQueries:
    @pytest.mark.asyncio
    async def test_latest_since_hides_sf8(self, test_db):
        await _msg("a: on sf7", SF7, received_at=100)
        await _msg("b: on sf8", SF8, received_at=101)
        await _msg("c: no stamp", None, received_at=102)
        rows = await MessageRepository.get_latest_since(
            msg_type="CHAN", conversation_key=CHAN, since=0, limit=10, hidden_radio_sfs=[8]
        )
        assert [m.text for m in rows] == ["a: on sf7", "c: no stamp"]

    @pytest.mark.asyncio
    async def test_unknown_bucket_hides_null_rows(self, test_db):
        await _msg("a: on sf7", SF7, received_at=100)
        await _msg("c: no stamp", None, received_at=102)
        rows = await MessageRepository.get_latest_since(
            msg_type="CHAN", conversation_key=CHAN, since=0, limit=10, hidden_radio_sfs=[0]
        )
        assert [m.text for m in rows] == ["a: on sf7"]

    @pytest.mark.asyncio
    async def test_outgoing_never_hidden(self, test_db):
        await _msg("me: sent on sf8", SF8, outgoing=True, received_at=103)
        rows = await MessageRepository.get_latest_since(
            msg_type="CHAN", conversation_key=CHAN, since=0, limit=10, hidden_radio_sfs=[8]
        )
        assert [m.text for m in rows] == ["me: sent on sf8"]

    @pytest.mark.asyncio
    async def test_unread_counts_skip_hidden_sf(self, test_db):
        from app.repository import ChannelRepository

        await ChannelRepository.upsert(key=CHAN, name="#border")
        await _msg("a: on sf7", SF7, received_at=100)
        await _msg("b: on sf8", SF8, received_at=101)
        counts = await MessageRepository.get_unread_counts(hidden_radio_sfs=[8])
        assert counts["counts"][f"channel-{CHAN}"] == 1


class TestPushHelper:
    def test_hidden_by_sf(self):
        assert message_hidden_by_radio_sf({"sf": 8}, [8]) is True
        assert message_hidden_by_radio_sf({"sf": 7}, [8]) is False

    def test_null_stamp_only_hidden_by_unknown(self):
        assert message_hidden_by_radio_sf(None, [8]) is False
        assert message_hidden_by_radio_sf(None, [0]) is True

    def test_nothing_hidden(self):
        assert message_hidden_by_radio_sf({"sf": 8}, []) is False
