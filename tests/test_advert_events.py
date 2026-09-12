"""Tests for AdvertEventRepository: dedup, direct/flood aggregation, prune."""

import pytest

from app.repository.advert_events import AdvertEventRepository


class TestAdvertEventRecord:
    @pytest.mark.asyncio
    async def test_dedup_and_min_path_len_refinement(self, test_db):
        pk = "aa" * 32
        # Flood copy first (path_len 2), then a direct copy of the SAME transmission.
        await AdvertEventRepository.record(
            transmission_id=1, public_key=pk, timestamp=100, path_len=2, path_hex="bbbbcccc"
        )
        await AdvertEventRepository.record(
            transmission_id=1, public_key=pk, timestamp=101, path_len=0, path_hex=""
        )
        rows = await AdvertEventRepository.mesh_health_rows(0, 1000)
        assert len(rows) == 1
        assert rows[0]["public_key"] == pk
        assert rows[0]["direct_count"] == 1  # refined to direct
        assert rows[0]["flood_count"] == 0

    @pytest.mark.asyncio
    async def test_direct_and_flood_counted_separately(self, test_db):
        pk = "bb" * 32
        # Two distinct direct transmissions, one flood-only transmission.
        await AdvertEventRepository.record(
            transmission_id=10, public_key=pk, timestamp=100, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=11, public_key=pk, timestamp=150, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=12, public_key=pk, timestamp=200, path_len=1, path_hex="cccc"
        )
        rows = await AdvertEventRepository.mesh_health_rows(0, 1000)
        assert rows[0]["direct_count"] == 2
        assert rows[0]["flood_count"] == 1
        assert rows[0]["min_path_len"] == 0

    @pytest.mark.asyncio
    async def test_window_filtering(self, test_db):
        pk = "cc" * 32
        await AdvertEventRepository.record(
            transmission_id=20, public_key=pk, timestamp=50, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=21, public_key=pk, timestamp=500, path_len=0, path_hex=""
        )
        rows = await AdvertEventRepository.mesh_health_rows(100, 1000)
        assert rows[0]["direct_count"] == 1  # only the ts=500 event is in-window

    @pytest.mark.asyncio
    async def test_prune_older_than(self, test_db):
        pk = "dd" * 32
        await AdvertEventRepository.record(
            transmission_id=30, public_key=pk, timestamp=1000, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=31, public_key=pk, timestamp=5000, path_len=0, path_hex=""
        )
        deleted = await AdvertEventRepository.prune_older_than(cutoff_ts=4000)
        assert deleted == 1
        rows = await AdvertEventRepository.mesh_health_rows(0, 10000)
        assert rows[0]["direct_count"] == 1


class TestAdvertEventIngest:
    @pytest.mark.asyncio
    async def test_process_advertisement_records_direct_and_flood(
        self, test_db, captured_broadcasts
    ):
        """A real advert passed through _process_advertisement records an event.

        A flooded copy (path_len 2) and a direct copy (path_len 0) of two distinct
        transmissions yield flood_count 1 and direct_count 1 for the contact.
        """
        from unittest.mock import MagicMock, patch

        from app.decoder import ParsedAdvertisement
        from app.packet_processor import _process_advertisement

        pk = "12" * 32
        _, mock_broadcast = captured_broadcasts

        def make_info(path_hex: str, path_len: int) -> MagicMock:
            info = MagicMock()
            info.path_length = path_len
            info.path = bytes.fromhex(path_hex) if path_hex else b""
            info.payload = b""
            return info

        async def process(path_hex: str, path_len: int, ts: int, txid: int) -> None:
            with patch("app.packet_processor.broadcast_event", mock_broadcast):
                with (
                    patch("app.packet_processor.parse_advertisement") as mock_parse,
                    patch("app.packet_processor.verify_advert_signature", return_value=True),
                ):
                    mock_parse.return_value = ParsedAdvertisement(
                        public_key=pk,
                        name="TestNode",
                        timestamp=ts,
                        lat=None,
                        lon=None,
                        device_role=1,
                    )
                    await _process_advertisement(
                        b"",
                        timestamp=ts,
                        packet_info=make_info(path_hex, path_len),
                        packet_id=txid,
                    )

        await process("bbbbcccc", 2, 1000, 1)  # flooded transmission
        await process("", 0, 1005, 2)  # direct transmission

        rows = await AdvertEventRepository.mesh_health_rows(0, 10000)
        assert len(rows) == 1
        assert rows[0]["public_key"] == pk
        assert rows[0]["direct_count"] == 1
        assert rows[0]["flood_count"] == 1


class TestAdvertPruner:
    @pytest.mark.asyncio
    async def test_prune_once_uses_setting(self, test_db):
        import time as _time

        from app.services import advert_pruner

        pk = "ee" * 32
        now = int(_time.time())
        await AdvertEventRepository.record(
            transmission_id=100, public_key=pk, timestamp=now - 40 * 86400, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=101, public_key=pk, timestamp=now - 1 * 86400, path_len=0, path_hex=""
        )

        # Retention default is 30 days -> the 40-day-old event is pruned.
        deleted = await advert_pruner.prune_once()
        assert deleted == 1
        rows = await AdvertEventRepository.mesh_health_rows(0, now + 10)
        assert rows[0]["direct_count"] == 1
