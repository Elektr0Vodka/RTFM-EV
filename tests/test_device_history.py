"""Tests for plan 14: contact location history and repeater config snapshots."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.repository import ContactRepository
from app.repository.contacts import ContactLocationHistoryRepository, round_location
from app.repository.device_config_history import DeviceConfigHistoryRepository
from app.services.contact_reconciliation import record_contact_location

KEY_A = "aa" * 32
KEY_B = "bb" * 32


async def _contact(key: str, name: str = "Node", contact_type: int = 1) -> None:
    await ContactRepository.upsert({"public_key": key, "name": name, "type": contact_type})


class TestRoundLocation:
    def test_rounds_to_four_decimals(self):
        assert round_location(52.1234567, 4.9876543) == (52.1235, 4.9877)

    def test_rejects_missing_or_zero_sentinel(self):
        assert round_location(None, 4.0) is None
        assert round_location(52.0, None) is None
        assert round_location(0.0, 0.0) is None
        assert round_location(0, 0) is None

    def test_keeps_a_zero_on_one_axis(self):
        assert round_location(0.0, 4.5) == (0.0, 4.5)


class TestContactLocationHistoryRepository:
    @pytest.mark.asyncio
    async def test_records_distinct_positions_and_bumps_last_seen(self, test_db):
        await _contact(KEY_A)
        assert await ContactLocationHistoryRepository.record_location(KEY_A, 52.1, 4.3, 1000)
        # GPS jitter within the 4th decimal collapses into the same row.
        assert not await ContactLocationHistoryRepository.record_location(
            KEY_A, 52.10004, 4.30001, 2000
        )
        assert await ContactLocationHistoryRepository.record_location(KEY_A, 52.2, 4.3, 3000)

        history = await ContactLocationHistoryRepository.get_history(KEY_A)
        assert [(h.lat, h.lon, h.first_seen, h.last_seen) for h in history] == [
            (52.2, 4.3, 3000, 3000),
            (52.1, 4.3, 1000, 2000),
        ]

    @pytest.mark.asyncio
    async def test_sentinel_and_missing_positions_are_ignored(self, test_db):
        await _contact(KEY_A)
        assert not await ContactLocationHistoryRepository.record_location(KEY_A, 0.0, 0.0, 1000)
        assert not await ContactLocationHistoryRepository.record_location(KEY_A, None, 4.3, 1000)
        assert await ContactLocationHistoryRepository.get_history(KEY_A) == []

    @pytest.mark.asyncio
    async def test_service_wrapper_lowercases_key(self, test_db):
        await _contact(KEY_A)
        assert await record_contact_location(
            public_key=KEY_A.upper(), lat=52.1, lon=4.3, timestamp=10
        )
        assert len(await ContactLocationHistoryRepository.get_history(KEY_A)) == 1


class TestDeviceConfigHistoryRepository:
    @pytest.mark.asyncio
    async def test_append_on_change_only(self, test_db):
        await _contact(KEY_A, contact_type=2)
        snap = {"name": "R1", "lat": "52.1", "lon": "4.3"}
        assert await DeviceConfigHistoryRepository.record(KEY_A, "node_info", 1000, snap)
        # Same content, different key order: not a change.
        assert not await DeviceConfigHistoryRepository.record(
            KEY_A, "node_info", 2000, {"lon": "4.3", "lat": "52.1", "name": "R1"}
        )
        assert await DeviceConfigHistoryRepository.record(
            KEY_A, "node_info", 3000, {**snap, "name": "R1-renamed"}
        )
        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "node_info")
        assert [h["timestamp"] for h in history] == [3000, 1000]
        assert history[0]["data"]["name"] == "R1-renamed"

    @pytest.mark.asyncio
    async def test_missing_field_keeps_the_last_known_value(self, test_db):
        # A None field means the repeater did not answer that one command
        # (partial CLI timeout), not that the setting was cleared.
        await _contact(KEY_A, contact_type=2)
        snap = {"name": "R1", "lat": "52.1", "lon": "4.3"}
        assert await DeviceConfigHistoryRepository.record(KEY_A, "node_info", 1000, snap)
        assert not await DeviceConfigHistoryRepository.record(
            KEY_A, "node_info", 2000, {**snap, "lat": None}
        )
        # A real change in another field is stored with the last known lat.
        assert await DeviceConfigHistoryRepository.record(
            KEY_A, "node_info", 3000, {**snap, "lat": None, "name": "R1-renamed"}
        )
        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "node_info")
        assert [h["timestamp"] for h in history] == [3000, 1000]
        assert history[0]["data"] == {"name": "R1-renamed", "lat": "52.1", "lon": "4.3"}

    @pytest.mark.asyncio
    async def test_field_never_answered_stays_empty(self, test_db):
        await _contact(KEY_A, contact_type=2)
        await DeviceConfigHistoryRepository.record(
            KEY_A, "radio_settings", 1000, {"tx_power": "20", "airtime_factor": None}
        )
        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "radio_settings")
        assert history[0]["data"] == {"tx_power": "20", "airtime_factor": None}

    @pytest.mark.asyncio
    async def test_kinds_are_independent_and_filterable(self, test_db):
        await _contact(KEY_A, contact_type=2)
        await DeviceConfigHistoryRepository.record(KEY_A, "node_info", 1000, {"name": "R1"})
        await DeviceConfigHistoryRepository.record(
            KEY_A, "radio_settings", 1001, {"tx_power": "20"}
        )
        assert len(await DeviceConfigHistoryRepository.get_history(KEY_A)) == 2
        radio = await DeviceConfigHistoryRepository.get_history(KEY_A, "radio_settings")
        assert len(radio) == 1 and radio[0]["kind"] == "radio_settings"

    @pytest.mark.asyncio
    async def test_cap_keeps_newest_per_kind(self, test_db):
        await _contact(KEY_A, contact_type=2)
        for i in range(5):
            await DeviceConfigHistoryRepository.record(
                KEY_A, "regions", 1000 + i, {"n": i}, max_rows=3
            )
        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "regions")
        assert [h["data"]["n"] for h in history] == [4, 3, 2]

    @pytest.mark.asyncio
    async def test_unknown_kind_is_rejected(self, test_db):
        with pytest.raises(ValueError):
            await DeviceConfigHistoryRepository.record(KEY_A, "bogus", 1, {})


class TestAdvertCapture:
    @pytest.mark.asyncio
    async def test_advert_with_position_records_location(self, test_db, captured_broadcasts):
        from app.decoder import ParsedAdvertisement
        from app.packet_processor import _process_advertisement

        _, mock_broadcast = captured_broadcasts
        info = MagicMock()
        info.path_length = 0
        info.path = b""
        info.payload = b""

        async def process(ts: int, lat: float | None, lon: float | None) -> None:
            with (
                patch("app.packet_processor.broadcast_event", mock_broadcast),
                patch("app.packet_processor.parse_advertisement") as mock_parse,
                patch("app.packet_processor.verify_advert_signature", return_value=True),
            ):
                mock_parse.return_value = ParsedAdvertisement(
                    public_key=KEY_A,
                    name="TestNode",
                    timestamp=ts,
                    lat=lat,
                    lon=lon,
                    device_role=1,
                )
                await _process_advertisement(b"", timestamp=ts, packet_info=info, packet_id=ts)

        await process(1000, 52.12346, 4.98766)
        await process(1001, 52.12346, 4.98766)  # repeat: same row, last_seen bumped
        await process(1002, None, None)  # no position: nothing recorded
        await process(1003, 52.2, 4.9)

        history = await ContactLocationHistoryRepository.get_history(KEY_A)
        assert [(h.lat, h.lon, h.first_seen, h.last_seen) for h in history] == [
            (52.2, 4.9, 1003, 1003),
            (52.1235, 4.9877, 1000, 1001),
        ]


def _radio_result(event_type, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _mock_mc():
    mc = MagicMock()
    mc.commands.send_cmd = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.commands.send_login = AsyncMock(return_value=_radio_result(EventType.LOGIN_SUCCESS))
    mc.stop_auto_message_fetching = AsyncMock()
    mc.start_auto_message_fetching = AsyncMock()
    mc.commands.get_msg = AsyncMock(return_value=_radio_result(EventType.NO_MORE_MSGS))
    return mc


class TestPaneCapture:
    @pytest.mark.asyncio
    async def test_node_info_snapshot_ignores_the_clock(self, test_db):
        from app.routers import repeaters as repeaters_router
        from app.routers.repeaters import repeater_node_info

        await _contact(KEY_A, name="Repeater", contact_type=2)
        mc = _mock_mc()
        batches = iter(
            [
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:00"},
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:05"},
                {"name": "R1-new", "lat": "52.1", "lon": "4.3", "clock_utc": "10:10"},
            ]
        )
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(
                repeaters_router,
                "_batch_cli_fetch",
                AsyncMock(side_effect=lambda *a, **k: next(batches)),
            ),
        ):
            for _ in range(3):
                await repeater_node_info(KEY_A)

        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "node_info")
        assert [h["data"]["name"] for h in history] == ["R1-new", "R1"]
        assert "clock_utc" not in history[0]["data"]

    @pytest.mark.asyncio
    async def test_unanswered_fetch_is_not_a_snapshot(self, test_db):
        # CLI timeout: every field comes back None. Storing it would record a
        # fake change now and another one when the repeater answers again.
        from app.routers import repeaters as repeaters_router
        from app.routers.repeaters import repeater_node_info

        await _contact(KEY_A, name="Repeater", contact_type=2)
        mc = _mock_mc()
        batches = iter(
            [
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:00"},
                {"name": None, "lat": None, "lon": None, "clock_utc": None},
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:10"},
            ]
        )
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(
                repeaters_router,
                "_batch_cli_fetch",
                AsyncMock(side_effect=lambda *a, **k: next(batches)),
            ),
        ):
            for _ in range(3):
                await repeater_node_info(KEY_A)

        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "node_info")
        assert [h["data"]["name"] for h in history] == ["R1"]

    @pytest.mark.asyncio
    async def test_partially_answered_fetch_is_not_a_change(self, test_db):
        # Only `get lat` timed out: the pane shows lat empty, but the history
        # must not record "lat cleared" now and "lat set" on the next full fetch.
        from app.routers import repeaters as repeaters_router
        from app.routers.repeaters import repeater_node_info

        await _contact(KEY_A, name="Repeater", contact_type=2)
        mc = _mock_mc()
        batches = iter(
            [
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:00"},
                {"name": "R1", "lat": None, "lon": "4.3", "clock_utc": "10:05"},
                {"name": "R1", "lat": "52.1", "lon": "4.3", "clock_utc": "10:10"},
            ]
        )
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(
                repeaters_router,
                "_batch_cli_fetch",
                AsyncMock(side_effect=lambda *a, **k: next(batches)),
            ),
        ):
            responses = [await repeater_node_info(KEY_A) for _ in range(3)]

        assert responses[1].lat is None  # the pane still shows what came back
        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "node_info")
        assert [h["data"] for h in history] == [{"name": "R1", "lat": "52.1", "lon": "4.3"}]

    @pytest.mark.asyncio
    async def test_radio_settings_and_advert_intervals_snapshots(self, test_db):
        from app.routers import repeaters as repeaters_router
        from app.routers.repeaters import repeater_advert_intervals, repeater_radio_settings

        await _contact(KEY_A, name="Repeater", contact_type=2)
        mc = _mock_mc()
        radio = {
            "firmware_version": "v1.9",
            "radio": "869.525,250,11,5",
            "tx_power": "20",
            "airtime_factor": "1.0",
            "duty_cycle_limit": None,
            "repeat_enabled": "1",
            "flood_max": "64",
        }
        intervals = {"advert_interval": "240", "flood_advert_interval": "3"}
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(repeaters_router, "_batch_cli_fetch", AsyncMock(return_value=radio)),
        ):
            await repeater_radio_settings(KEY_A)
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(repeaters_router, "_batch_cli_fetch", AsyncMock(return_value=intervals)),
        ):
            await repeater_advert_intervals(KEY_A)

        kinds = {h["kind"] for h in await DeviceConfigHistoryRepository.get_history(KEY_A)}
        assert kinds == {"radio_settings", "advert_intervals"}

    @pytest.mark.asyncio
    async def test_snapshot_failure_does_not_break_the_pane(self, test_db):
        from app.routers import repeaters as repeaters_router
        from app.routers.repeaters import repeater_advert_intervals

        await _contact(KEY_A, name="Repeater", contact_type=2)
        mc = _mock_mc()
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(
                repeaters_router,
                "_batch_cli_fetch",
                AsyncMock(return_value={"advert_interval": "1", "flood_advert_interval": "2"}),
            ),
            patch(
                "app.routers.repeaters.DeviceConfigHistoryRepository.record",
                AsyncMock(side_effect=RuntimeError("disk")),
            ),
        ):
            response = await repeater_advert_intervals(KEY_A)
        assert response.advert_interval == "1"


class TestEndpoints:
    @pytest.mark.asyncio
    async def test_location_history_endpoint(self, test_db, client):
        await _contact(KEY_A)
        await ContactLocationHistoryRepository.record_location(KEY_A, 52.1, 4.3, 1000)
        await ContactLocationHistoryRepository.record_location(KEY_A, 52.2, 4.3, 2000)

        resp = await client.get(f"/api/contacts/{KEY_A}/location-history")

        assert resp.status_code == 200
        assert resp.json() == [
            {"lat": 52.2, "lon": 4.3, "first_seen": 2000, "last_seen": 2000},
            {"lat": 52.1, "lon": 4.3, "first_seen": 1000, "last_seen": 1000},
        ]

    @pytest.mark.asyncio
    async def test_location_history_unknown_contact_is_404(self, test_db, client):
        resp = await client.get(f"/api/contacts/{KEY_B}/location-history")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_config_history_endpoint_filters_by_kind(self, test_db, client):
        await _contact(KEY_A, name="Repeater", contact_type=2)
        await DeviceConfigHistoryRepository.record(KEY_A, "node_info", 1000, {"name": "R1"})
        await DeviceConfigHistoryRepository.record(KEY_A, "regions", 1001, {"regions": []})

        both = await client.get(f"/api/contacts/{KEY_A}/repeater/config-history")
        assert both.status_code == 200 and len(both.json()) == 2

        only = await client.get(f"/api/contacts/{KEY_A}/repeater/config-history?kind=node_info")
        assert only.status_code == 200
        assert only.json() == [{"kind": "node_info", "timestamp": 1000, "data": {"name": "R1"}}]

        bad = await client.get(f"/api/contacts/{KEY_A}/repeater/config-history?kind=bogus")
        assert bad.status_code == 422

    @pytest.mark.asyncio
    async def test_config_history_requires_a_repeater(self, test_db, client):
        await _contact(KEY_A, contact_type=1)
        resp = await client.get(f"/api/contacts/{KEY_A}/repeater/config-history")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_room_config_history_endpoint(self, test_db, client):
        await _contact(KEY_A, name="Room", contact_type=3)
        await DeviceConfigHistoryRepository.record(
            KEY_A, "acl", 1000, {"acl": [{"pubkey_prefix": "aabbccddeeff", "permission": 3}]}
        )
        resp = await client.get(f"/api/contacts/{KEY_A}/room/config-history")
        assert resp.status_code == 200
        assert resp.json()[0]["kind"] == "acl"

        await _contact(KEY_B, name="Repeater", contact_type=2)
        wrong = await client.get(f"/api/contacts/{KEY_B}/room/config-history")
        assert wrong.status_code == 400


class TestRoomAclCapture:
    @staticmethod
    async def _fetch(acl_data):
        from app.radio import radio_manager
        from app.routers.rooms import room_acl

        mc = _mock_mc()
        mc.commands.add_contact = AsyncMock(return_value=_radio_result(EventType.OK))
        mc.commands.req_acl_sync = AsyncMock(return_value=acl_data)
        with (
            patch("app.routers.rooms.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
        ):
            return await room_acl(KEY_A)

    @pytest.mark.asyncio
    async def test_acl_snapshot_is_sorted_and_name_free(self, test_db):
        await _contact(KEY_A, name="Room", contact_type=3)
        await self._fetch([{"key": "ffffffffffff", "perm": 0}, {"key": "bbbbbbbbbbbb", "perm": 3}])
        # Same members in another order, and one now resolves to a named contact:
        # neither is an ACL change.
        await _contact("bbbbbbbbbbbb" + "00" * 26, name="Now Named", contact_type=1)
        await self._fetch([{"key": "bbbbbbbbbbbb", "perm": 3}, {"key": "ffffffffffff", "perm": 0}])

        history = await DeviceConfigHistoryRepository.get_history(KEY_A, "acl")
        assert [h["data"] for h in history] == [
            {
                "acl": [
                    {"pubkey_prefix": "bbbbbbbbbbbb", "permission": 3},
                    {"pubkey_prefix": "ffffffffffff", "permission": 0},
                ]
            }
        ]

    @pytest.mark.asyncio
    async def test_empty_or_unanswered_acl_is_not_a_snapshot(self, test_db):
        await _contact(KEY_A, name="Room", contact_type=3)
        await self._fetch(None)
        await self._fetch([])
        assert await DeviceConfigHistoryRepository.get_history(KEY_A, "acl") == []


class TestDeviceHistoryRetention:
    @pytest.mark.asyncio
    async def test_prunes_both_tables_by_age_and_zero_keeps(self, test_db):
        from app.repository import AppSettingsRepository
        from app.services import retention_pruner

        day = 86400
        now = 100 * day
        await _contact(KEY_A, contact_type=2)
        s = await AppSettingsRepository.get()
        assert s.device_history_retention_days == 0

        await DeviceConfigHistoryRepository.record(KEY_A, "node_info", now - 40 * day, {"n": 1})
        await DeviceConfigHistoryRepository.record(KEY_A, "node_info", now - 5 * day, {"n": 2})
        # Location rows age by last_seen: a position still being reported stays.
        await ContactLocationHistoryRepository.record_location(KEY_A, 52.1, 4.3, now - 60 * day)
        await ContactLocationHistoryRepository.record_location(KEY_A, 52.2, 4.3, now - 50 * day)
        await ContactLocationHistoryRepository.record_location(KEY_A, 52.2, 4.3, now - 1 * day)

        result = await retention_pruner.prune_once(now)
        assert "device_config" not in result and "contact_locations" not in result

        await AppSettingsRepository.update(device_history_retention_days=30)
        result = await retention_pruner.prune_once(now)
        assert result.get("device_config") == 1
        assert result.get("contact_locations") == 1
        config = await DeviceConfigHistoryRepository.get_history(KEY_A)
        assert [h["data"] for h in config] == [{"n": 2}]
        positions = await ContactLocationHistoryRepository.get_history(KEY_A)
        assert [(p.lat, p.lon) for p in positions] == [(52.2, 4.3)]
