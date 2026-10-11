"""Node clocks from advert timestamps: readings, the mesh check and the sync decision."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import Contact
from app.repository import AdvertEventRepository, AppSettingsRepository, ContactRepository
from app.routers.settings import (
    TrackedTelemetryRequest,
    toggle_clock_sync_repeater,
    toggle_tracked_telemetry,
)
from app.services.clock_drift import (
    CONSENSUS_MIN_NODES,
    clock_reading,
    clock_set_confirmed,
    mesh_median_offset,
    plan_clock_sync,
)

KEY = "aa" * 32
NOW = 1_800_000_000


def _mesh(offset: int = -3, count: int = CONSENSUS_MIN_NODES) -> list[tuple[str, int, int]]:
    """``count`` other nodes that all read ``offset`` seconds off our clock."""
    return [(f"{i:064x}", NOW + offset, NOW) for i in range(1, count + 1)]


class TestClockReading:
    def test_a_few_seconds_behind_is_in_sync(self):
        # A relayed advert is built a little before it is heard.
        reading = clock_reading(NOW - 8, NOW)

        assert reading.offset_seconds == -8
        assert reading.measured_at == NOW
        assert reading.state == "in_sync"

    def test_a_clock_still_at_the_firmware_default_reads_far_behind(self):
        reading = clock_reading(1715770351, NOW)

        assert reading.state == "behind"
        assert reading.offset_seconds == 1715770351 - NOW

    def test_a_clock_in_the_future_reads_ahead(self):
        assert clock_reading(NOW + 86400, NOW).state == "ahead"

    @pytest.mark.parametrize(
        ("offset", "state"), [(120, "in_sync"), (121, "ahead"), (-121, "behind")]
    )
    def test_the_boundary(self, offset, state):
        assert clock_reading(NOW + offset, NOW).state == state


class TestMeshMedianOffset:
    def test_needs_enough_other_nodes(self):
        assert mesh_median_offset(_mesh(count=CONSENSUS_MIN_NODES - 1), exclude=KEY) is None
        assert mesh_median_offset(_mesh(), exclude=KEY) == -3

    def test_the_node_being_set_does_not_vote(self):
        readings = _mesh(count=CONSENSUS_MIN_NODES - 1) + [(KEY, NOW - 9_000_000, NOW)]

        assert mesh_median_offset(readings, exclude=KEY.upper()) is None

    def test_a_few_wrong_clocks_do_not_move_the_median(self):
        readings = _mesh(offset=-2, count=7) + [
            ("f1" * 32, 1715770351, NOW),
            ("f2" * 32, NOW + 86400, NOW),
        ]

        assert mesh_median_offset(readings, exclude=KEY) == -2


class TestPlanClockSync:
    def _plan(self, **overrides):
        args = {
            "reading": (NOW - 3600, NOW),
            "last_sync_at": None,
            "mesh_readings": _mesh(),
            "public_key": KEY,
        }
        args.update(overrides)
        return plan_clock_sync(**args)

    def test_syncs_a_repeater_that_is_behind_when_the_mesh_agrees_with_us(self):
        assert self._plan() == "sync"

    def test_no_reading_means_nothing_to_go_on(self):
        assert self._plan(reading=None) == "no_reading"

    def test_a_small_offset_is_left_alone(self):
        assert self._plan(reading=(NOW - 60, NOW)) == "not_behind"
        # Exactly at the in-sync edge is still in sync; one second more is not.
        assert self._plan(reading=(NOW - 120, NOW)) == "not_behind"
        assert self._plan(reading=(NOW - 121, NOW)) == "sync"

    def test_a_clock_that_is_ahead_cannot_be_fixed_by_time(self):
        assert self._plan(reading=(NOW + 3600, NOW)) == "ahead"

    def test_a_reading_from_before_the_last_attempt_is_not_acted_on_again(self):
        assert self._plan(last_sync_at=NOW + 10) == "already_synced"
        # A newer advert that is still behind is a new reason.
        assert self._plan(reading=(NOW - 3600, NOW + 20), last_sync_at=NOW + 10) == "sync"

    def test_too_few_other_nodes_leaves_the_host_clock_unverified(self):
        assert self._plan(mesh_readings=_mesh(count=2)) == "host_clock_unverified"

    def test_a_host_that_disagrees_with_the_mesh_sends_nothing(self):
        # Our clock jumped a day ahead: every node now reads a day behind.
        assert self._plan(mesh_readings=_mesh(offset=-86400)) == "host_clock_disagrees"


class TestClockSetConfirmed:
    @pytest.mark.parametrize(
        ("reply", "confirmed"),
        [
            ("OK - clock set: 12:30 - 10/10/2026 UTC", True),
            ("> OK - clock set: 12:30 - 10/10/2026 UTC", True),
            ("(ERR: clock cannot go backwards)", False),
            ("", False),
            (None, False),
        ],
    )
    def test_reads_the_firmware_reply(self, reply, confirmed):
        assert clock_set_confirmed(reply) is confirmed


async def _add_repeater(key: str = KEY) -> None:
    await ContactRepository.upsert(
        {
            "public_key": key,
            "name": "Repeater",
            "type": 2,
            "flags": 0,
            "direct_path": None,
            "direct_path_len": -1,
            "direct_path_hash_mode": -1,
            "last_advert": None,
            "lat": None,
            "lon": None,
            "last_seen": None,
            "on_radio": False,
            "last_contacted": None,
            "first_seen": None,
        }
    )


class TestAdvertClockStorage:
    @pytest.mark.asyncio
    async def test_keeps_the_sender_timestamp_and_returns_the_newest(self, test_db):
        await AdvertEventRepository.record(1, KEY, NOW, 0, "", sender_timestamp=NOW - 500)
        await AdvertEventRepository.record(2, KEY, NOW + 100, 0, "", sender_timestamp=NOW + 97)

        assert await AdvertEventRepository.latest_clock_reading(KEY.upper()) == (
            NOW + 97,
            NOW + 100,
        )

    @pytest.mark.asyncio
    async def test_a_later_copy_of_the_same_advert_changes_nothing(self, test_db):
        await AdvertEventRepository.record(1, KEY, NOW, 2, "aabb", sender_timestamp=NOW - 5)
        await AdvertEventRepository.record(1, KEY, NOW + 3, 0, "", sender_timestamp=NOW - 5)

        assert await AdvertEventRepository.latest_clock_reading(KEY) == (NOW - 5, NOW)

    @pytest.mark.asyncio
    async def test_adverts_without_a_timestamp_give_no_reading(self, test_db):
        await AdvertEventRepository.record(1, KEY, NOW, 0, "")

        assert await AdvertEventRepository.latest_clock_reading(KEY) is None

    @pytest.mark.asyncio
    async def test_readings_since_are_one_per_node_inside_the_window(self, test_db):
        other = "bb" * 32
        await AdvertEventRepository.record(1, KEY, NOW - 5000, 0, "", sender_timestamp=1)
        await AdvertEventRepository.record(2, KEY, NOW - 10, 0, "", sender_timestamp=NOW - 12)
        await AdvertEventRepository.record(3, KEY, NOW - 100, 0, "", sender_timestamp=NOW - 103)
        await AdvertEventRepository.record(4, other, NOW - 9000, 0, "", sender_timestamp=5)

        readings = await AdvertEventRepository.latest_clock_readings_since(NOW - 1000)

        assert readings == [(KEY, NOW - 12, NOW - 10)]


class TestClockSyncSetting:
    @pytest.mark.asyncio
    async def test_only_a_tracked_repeater_can_be_opted_in(self, test_db):
        from fastapi import HTTPException

        await _add_repeater()

        with pytest.raises(HTTPException) as exc:
            await toggle_clock_sync_repeater(TrackedTelemetryRequest(public_key=KEY))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_toggles_on_and_off_and_persists(self, test_db):
        await _add_repeater()
        await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=KEY))

        on = await toggle_clock_sync_repeater(TrackedTelemetryRequest(public_key=KEY.upper()))
        assert on.clock_sync_repeaters == [KEY]
        assert (await AppSettingsRepository.get()).clock_sync_repeaters == [KEY]

        off = await toggle_clock_sync_repeater(TrackedTelemetryRequest(public_key=KEY))
        assert off.clock_sync_repeaters == []
        assert (await AppSettingsRepository.get()).clock_sync_repeaters == []

    @pytest.mark.asyncio
    async def test_ends_when_telemetry_tracking_is_turned_off(self, test_db):
        await _add_repeater()
        await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=KEY))
        await toggle_clock_sync_repeater(TrackedTelemetryRequest(public_key=KEY))

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=KEY))

        assert result.tracked_telemetry_repeaters == []
        assert result.clock_sync_repeaters == []
        assert (await AppSettingsRepository.get()).clock_sync_repeaters == []

    @pytest.mark.asyncio
    async def test_empty_by_default(self, test_db):
        assert (await AppSettingsRepository.get()).clock_sync_repeaters == []


class TestTelemetryCycleClockSync:
    """Which repeaters of a telemetry cycle reach the clock step."""

    @staticmethod
    async def _run(collect_result: bool, clock_sync: list[str]) -> list[str]:
        from app.models import AppSettings
        from app.radio_sync import _run_telemetry_cycle

        other = "bb" * 32
        contacts = {
            KEY: Contact(public_key=KEY, name="Opted in", type=2),
            other: Contact(public_key=other, name="Tracked only", type=2),
        }
        settings = AppSettings(
            tracked_telemetry_repeaters=[KEY, other], clock_sync_repeaters=clock_sync
        )
        synced: list[str] = []

        async def fake_sync(mc, contact):
            synced.append(contact.public_key)
            return "set"

        class FakeRadioOp:
            async def __aenter__(self):
                return MagicMock()

            async def __aexit__(self, *args):
                pass

        radio = MagicMock()
        radio.is_connected = True
        radio.radio_operation.return_value = FakeRadioOp()

        with (
            patch("app.radio_sync.AppSettingsRepository.get", AsyncMock(return_value=settings)),
            patch(
                "app.radio_sync.ContactRepository.get_by_key",
                AsyncMock(side_effect=lambda key: contacts.get(key)),
            ),
            patch(
                "app.radio_sync._collect_repeater_telemetry",
                AsyncMock(return_value=collect_result),
            ),
            patch("app.radio_sync._collect_repeater_neighbor_signal", AsyncMock()),
            patch("app.radio_sync._maybe_sync_repeater_clock", new=fake_sync),
            patch("app.radio_sync.radio_manager", radio),
        ):
            await _run_telemetry_cycle()
        return synced

    @pytest.mark.asyncio
    async def test_only_opted_in_repeaters_are_considered(self):
        assert await self._run(True, [KEY.upper()]) == [KEY]

    @pytest.mark.asyncio
    async def test_nothing_without_opt_in(self):
        assert await self._run(True, []) == []

    @pytest.mark.asyncio
    async def test_not_when_the_repeater_did_not_answer_the_status_request(self):
        assert await self._run(False, [KEY]) == []


class TestContactClockInAnalytics:
    @pytest.mark.asyncio
    async def test_the_contact_analytics_carry_the_newest_reading(self, test_db, client):
        await _add_repeater()
        await AdvertEventRepository.record(1, KEY, NOW, 0, "", sender_timestamp=NOW - 7200)

        response = await client.get("/api/contacts/analytics", params={"public_key": KEY})

        assert response.status_code == 200
        assert response.json()["clock"] == {
            "offset_seconds": -7200,
            "measured_at": NOW,
            "state": "behind",
        }

    @pytest.mark.asyncio
    async def test_no_reading_is_null(self, test_db, client):
        await _add_repeater()

        response = await client.get("/api/contacts/analytics", params={"public_key": KEY})

        assert response.json()["clock"] is None


class TestMaybeSyncRepeaterClock:
    """The step inside the telemetry cycle. The radio is a mock: nothing is sent."""

    @pytest.fixture(autouse=True)
    def _fresh_attempts(self):
        from app import radio_sync

        radio_sync._clock_sync_attempted_at.clear()
        yield
        radio_sync._clock_sync_attempted_at.clear()

    @staticmethod
    def _patch_readings(reading, mesh):
        return (
            patch.object(
                AdvertEventRepository, "latest_clock_reading", AsyncMock(return_value=reading)
            ),
            patch.object(
                AdvertEventRepository,
                "latest_clock_readings_since",
                AsyncMock(return_value=mesh),
            ),
        )

    @staticmethod
    def _recent(offset: int) -> tuple[int, int]:
        """A reading heard a minute ago, ``offset`` seconds off."""
        import time

        seen = int(time.time()) - 60
        return seen + offset, seen

    @staticmethod
    def _recent_mesh(offset: int = -3) -> list[tuple[str, int, int]]:
        import time

        seen = int(time.time()) - 300
        return [(f"{i:064x}", seen + offset, seen) for i in range(1, CONSENSUS_MIN_NODES + 1)]

    @pytest.mark.asyncio
    async def test_sends_time_and_reports_set_when_the_firmware_confirms(self):
        from app.radio_sync import _maybe_sync_repeater_clock

        contact = Contact(public_key=KEY, name="Far", type=2)
        send = AsyncMock(return_value="OK - clock set: 12:30 - 10/10/2026 UTC")
        reading, mesh = self._patch_readings(self._recent(-7200), self._recent_mesh())
        with reading, mesh, patch("app.routers.server_control.send_cli_on_held_radio", send):
            outcome = await _maybe_sync_repeater_clock(MagicMock(), contact)

        assert outcome == "set"
        send.assert_awaited_once()
        command = send.await_args.args[2]
        assert command.startswith("time ")
        assert abs(int(command.split()[1]) - self._recent(0)[1]) < 120

    @pytest.mark.asyncio
    async def test_does_not_send_twice_for_the_same_advert(self):
        from app.radio_sync import _maybe_sync_repeater_clock

        contact = Contact(public_key=KEY, name="Far", type=2)
        send = AsyncMock(return_value=None)
        stale = self._recent(-7200)
        reading, mesh = self._patch_readings(stale, self._recent_mesh())
        with reading, mesh, patch("app.routers.server_control.send_cli_on_held_radio", send):
            first = await _maybe_sync_repeater_clock(MagicMock(), contact)
            second = await _maybe_sync_repeater_clock(MagicMock(), contact)

        assert (first, second) == ("no_reply", "already_synced")
        send.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reports_a_refusal(self):
        from app.radio_sync import _maybe_sync_repeater_clock

        contact = Contact(public_key=KEY, name="Far", type=2)
        send = AsyncMock(return_value="(ERR: clock cannot go backwards)")
        reading, mesh = self._patch_readings(self._recent(-7200), self._recent_mesh())
        with reading, mesh, patch("app.routers.server_control.send_cli_on_held_radio", send):
            assert await _maybe_sync_repeater_clock(MagicMock(), contact) == "refused"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("offset", "mesh_offset", "decision"),
        [
            (-30, -3, "not_behind"),
            (7200, -3, "ahead"),
            (-7200, -86400, "host_clock_disagrees"),
        ],
    )
    async def test_sends_nothing_otherwise(self, offset, mesh_offset, decision):
        from app.radio_sync import _maybe_sync_repeater_clock

        contact = Contact(public_key=KEY, name="Far", type=2)
        send = AsyncMock()
        reading, mesh = self._patch_readings(self._recent(offset), self._recent_mesh(mesh_offset))
        with reading, mesh, patch("app.routers.server_control.send_cli_on_held_radio", send):
            assert await _maybe_sync_repeater_clock(MagicMock(), contact) == decision

        send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failure_never_escapes_into_the_telemetry_cycle(self):
        from app.radio_sync import _maybe_sync_repeater_clock

        contact = Contact(public_key=KEY, name="Far", type=2)
        with patch.object(
            AdvertEventRepository, "latest_clock_reading", AsyncMock(side_effect=RuntimeError("db"))
        ):
            assert await _maybe_sync_repeater_clock(MagicMock(), contact) == "error"


class TestSendCliOnHeldRadio:
    """The collector's CLI send puts a command on air the same way the console does."""

    @staticmethod
    async def _sent(command: str) -> tuple[str, str | None]:
        """The text handed to the radio for ``command`` and the reply tag waited for."""
        from meshcore import EventType

        from app.routers import server_control

        mc = MagicMock()
        mc.commands.send_cmd = AsyncMock(return_value=MagicMock(type=EventType.OK))
        fetch = AsyncMock(return_value=None)
        with (
            patch.object(server_control, "_flush_pending_messages", AsyncMock()),
            patch.object(server_control, "fetch_contact_cli_response", fetch),
        ):
            reply = await server_control.send_cli_on_held_radio(
                mc, Contact(public_key=KEY, name="Far", type=2), command
            )

        assert reply is None
        return mc.commands.send_cmd.await_args.args[1], fetch.await_args.kwargs["expected_tag"]

    @pytest.mark.asyncio
    async def test_the_time_command_carries_a_reply_tag(self):
        text, tag = await self._sent("time 1800000000")

        assert text[2] == "|"
        assert text[3:] == "time 1800000000"
        assert tag == text[:3]

    @pytest.mark.asyncio
    async def test_an_empty_command_goes_out_as_one_space(self):
        """The companion firmware refuses a text frame without a text byte."""
        assert await self._sent("") == (" ", None)

    @pytest.mark.asyncio
    async def test_a_line_starting_with_a_space_goes_out_as_typed_without_a_tag(self):
        assert await self._sent("  nl-nh") == ("  nl-nh", None)
