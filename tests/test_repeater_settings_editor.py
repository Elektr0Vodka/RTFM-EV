"""Structured repeater settings editor: allow-list, validation, set + read-back.

Every test drives a MagicMock radio (no transport). Nothing here can reach RF.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.models import RepeaterSettingSetRequest, RepeaterSettingsReadRequest
from app.radio import radio_manager
from app.repository import ContactRepository
from app.routers.repeaters import repeater_settings_read, repeater_settings_set
from app.services import repeater_settings as rs

KEY_A = "aa" * 32
_MONOTONIC = "app.routers.server_control._monotonic"


@pytest.fixture(autouse=True)
def _reset_radio_state():
    prev = radio_manager._meshcore
    prev_lock = radio_manager._operation_lock
    yield
    radio_manager._meshcore = prev
    radio_manager._operation_lock = prev_lock


@pytest.fixture(autouse=True)
def _no_op_pre_send_flush():
    with patch("app.routers.server_control._flush_pending_messages", new_callable=AsyncMock):
        yield


@pytest.fixture(autouse=True)
def _fast_sleep():
    # batch_cli_fetch settles 1 s after add_contact and 0.25 s between commands.
    with patch("app.routers.server_control.asyncio.sleep", new_callable=AsyncMock):
        yield


def _radio_result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _cli_reply(text: str):
    return _radio_result(
        EventType.CONTACT_MSG_RECV, {"pubkey_prefix": KEY_A[:12], "text": text, "txt_type": 1}
    )


def _mock_mc():
    mc = MagicMock()
    mc.commands = MagicMock()
    mc.commands.send_cmd = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.commands.get_msg = AsyncMock()
    mc.commands.add_contact = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.subscribe = MagicMock(return_value=MagicMock(unsubscribe=MagicMock()))
    mc.stop_auto_message_fetching = AsyncMock()
    mc.start_auto_message_fetching = AsyncMock()
    return mc


async def _insert_repeater():
    await ContactRepository.upsert(
        {
            "public_key": KEY_A,
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


def _sent_commands(mc) -> list[str]:
    """CLI text of every send_cmd call, with the XX| echo tag stripped."""
    out = []
    for call in mc.commands.send_cmd.await_args_list:
        text = call.args[1]
        if len(text) > 3 and text[2] == "|":
            text = text[3:]
        out.append(text)
    return out


# --- allow-list + validation (pure) ----------------------------------------


class TestAllowList:
    @pytest.mark.parametrize(
        "setting",
        ["prv.key", "password", "freq", "af", "rxdelay", "bridge.secret", "", "tx ", "TX"],
    )
    def test_rejects_non_allow_listed(self, setting):
        with pytest.raises(rs.SettingValidationError):
            rs.build_set_command(setting, "1")

    def test_prv_key_is_not_in_allow_list(self):
        assert "prv.key" not in rs.SETTINGS
        assert all(spec.verb != "prv.key" for spec in rs.SETTINGS.values())

    def test_allow_list_contents(self):
        assert set(rs.SETTINGS) == {
            "name",
            "lat",
            "lon",
            "owner.info",
            "guest.password",
            "radio",
            "tx",
            "dutycycle",
            "radio.rxgain",
            "int.thresh",
            "agc.reset.interval",
            "repeat",
            "allow.read.only",
            "flood.max",
            "multi.acks",
            "loop.detect",
            "path.hash.mode",
            "txdelay",
            "direct.txdelay",
            "advert.interval",
            "flood.advert.interval",
        }

    def test_only_radio_needs_reboot_and_strong_confirm(self):
        assert [k for k, s in rs.SETTINGS.items() if s.reboot_required] == ["radio"]
        assert [k for k, s in rs.SETTINGS.items() if s.strong_confirm] == ["radio"]


class TestValidation:
    @pytest.mark.parametrize(
        ("setting", "value", "expected_cmd"),
        [
            ("tx", "20", "set tx 20"),
            ("tx", "-9", "set tx -9"),
            ("tx", "30", "set tx 30"),
            ("lat", "52.123456", "set lat 52.123456"),
            ("lon", "-4.5", "set lon -4.5"),
            ("repeat", "OFF", "set repeat off"),
            ("allow.read.only", "on", "set allow.read.only on"),
            ("radio.rxgain", "on", "set radio.rxgain on"),
            ("multi.acks", "1", "set multi.acks 1"),
            ("loop.detect", "moderate", "set loop.detect moderate"),
            ("path.hash.mode", "2", "set path.hash.mode 2"),
            ("flood.max", "64", "set flood.max 64"),
            ("flood.max", "0", "set flood.max 0"),
            ("dutycycle", "33.3", "set dutycycle 33.3"),
            ("txdelay", "0.500", "set txdelay 0.5"),
            ("direct.txdelay", "2", "set direct.txdelay 2"),
            ("int.thresh", "14", "set int.thresh 14"),
            ("agc.reset.interval", "120", "set agc.reset.interval 120"),
            ("advert.interval", "0", "set advert.interval 0"),
            ("advert.interval", "120", "set advert.interval 120"),
            ("flood.advert.interval", "12", "set flood.advert.interval 12"),
            ("flood.advert.interval", "0", "set flood.advert.interval 0"),
            ("name", "My Repeater 1", "set name My Repeater 1"),
            ("guest.password", "hello", "set guest.password hello"),
            ("owner.info", "line one\nline two", "set owner.info line one|line two"),
            ("radio", "869.525,250,11,5", "set radio 869.525,250,11,5"),
            ("radio", " 869.618 , 62.5 , 8 , 8 ", "set radio 869.618,62.5,8,8"),
            ("radio", "915,7.8,12,5", "set radio 915,7.8,12,5"),
        ],
    )
    def test_accepts_valid(self, setting, value, expected_cmd):
        _spec, _normalized, cmd = rs.build_set_command(setting, value)
        assert cmd == expected_cmd

    @pytest.mark.parametrize(
        ("setting", "value"),
        [
            ("tx", "31"),
            ("tx", "-10"),
            ("tx", "20.5"),
            ("tx", "abc"),
            ("lat", "90.1"),
            ("lat", "1e2"),
            ("lat", "nan"),
            ("lon", "-180.5"),
            ("lat", "52.1234567"),  # more than 6 decimals
            ("repeat", "yes"),
            ("multi.acks", "2"),
            ("loop.detect", "aggressive"),
            ("path.hash.mode", "3"),
            ("flood.max", "65"),
            ("flood.max", "-1"),
            ("dutycycle", "0.5"),
            ("dutycycle", "101"),
            ("dutycycle", "33.33"),
            ("txdelay", "2.1"),
            ("txdelay", "-0.1"),
            ("int.thresh", "256"),
            ("agc.reset.interval", "1024"),
            ("agc.reset.interval", "10"),  # not a multiple of 4 (firmware rounds)
            ("advert.interval", "30"),  # firmware minimum is 60
            ("advert.interval", "241"),
            ("advert.interval", "61"),  # stored as mins/2, odd would read back changed
            ("flood.advert.interval", "2"),
            ("flood.advert.interval", "169"),
            ("name", ""),
            ("name", "bad,name"),
            ("name", "a:b"),
            ("name", "x" * 32),
            ("name", " leading"),
            ("name", "line\nbreak"),
            ("guest.password", "x" * 16),
            ("guest.password", ""),
            ("owner.info", "x" * 120),
            ("owner.info", "tab\there"),
            ("radio", "869.525,250,11"),
            ("radio", "869.525,250,11,5,1"),
            ("radio", "100,250,11,5"),  # freq below 150
            ("radio", "2600,250,11,5"),
            ("radio", "869.525,200,11,5"),  # non-standard bandwidth
            ("radio", "869.525,250,4,5"),
            ("radio", "869.525,250,13,5"),
            ("radio", "869.525,250,11,4"),
            ("radio", "869.525,250,11,9"),
            ("radio", "869.5255,250,11,5"),  # more than 3 decimals
        ],
    )
    def test_rejects_invalid(self, setting, value):
        with pytest.raises(rs.SettingValidationError):
            rs.build_set_command(setting, value)


class TestClassify:
    def test_float_readback_tolerates_float32_printing(self):
        spec = rs.get_spec("lat")
        assert rs.classify_result(spec, "52.123456", "OK", "52.1234550") == "ok"

    def test_radio_readback_matches_firmware_format(self):
        spec = rs.get_spec("radio")
        assert (
            rs.classify_result(
                spec, "869.525,250,11,5", "OK - reboot to apply", "869.5250244,250.0,11,5"
            )
            == "ok"
        )

    def test_radio_readback_mismatch_on_sf(self):
        spec = rs.get_spec("radio")
        assert rs.classify_result(spec, "869.525,250,11,5", "OK", "869.525,250,10,5") == "mismatch"

    def test_dutycycle_readback_percent(self):
        spec = rs.get_spec("dutycycle")
        assert rs.classify_result(spec, "33.3", "OK - 33.3%", "33.3%") == "ok"
        assert rs.classify_result(spec, "50", "OK - 50.0%", "25.0%") == "mismatch"

    def test_error_reply_is_rejected(self):
        spec = rs.get_spec("radio.rxgain")
        assert rs.classify_result(spec, "on", "Error: unsupported", "off") == "rejected"
        spec = rs.get_spec("dutycycle")
        assert rs.classify_result(spec, "50", "unknown config: dutycycle 50", None) == "rejected"

    def test_missing_readback_is_unverified(self):
        spec = rs.get_spec("tx")
        assert rs.classify_result(spec, "20", "OK", None) == "unverified"
        assert rs.classify_result(spec, "20", None, None) == "unverified"

    def test_missed_set_reply_but_matching_readback_is_ok(self):
        spec = rs.get_spec("tx")
        assert rs.classify_result(spec, "20", None, "20") == "ok"


# --- set endpoint (stubbed radio) ------------------------------------------


class TestSetEndpoint:
    @pytest.mark.asyncio
    async def test_invalid_setting_rejected_before_any_radio_access(self, test_db):
        mc = _mock_mc()
        require = MagicMock(return_value=mc)
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", require),
            patch.object(radio_manager, "_meshcore", mc),
        ):
            with pytest.raises(HTTPException) as exc:
                await repeater_settings_set(
                    KEY_A, RepeaterSettingSetRequest(setting="prv.key", value="00" * 64)
                )
        assert exc.value.status_code == 400
        require.assert_not_called()
        mc.commands.send_cmd.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_out_of_range_value_rejected_before_any_radio_access(self, test_db):
        mc = _mock_mc()
        require = MagicMock(return_value=mc)
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", require),
            patch.object(radio_manager, "_meshcore", mc),
        ):
            with pytest.raises(HTTPException) as exc:
                await repeater_settings_set(
                    KEY_A, RepeaterSettingSetRequest(setting="tx", value="99")
                )
        assert exc.value.status_code == 400
        require.assert_not_called()
        mc.commands.send_cmd.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_success_sends_set_then_get_and_returns_readback(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(side_effect=[_cli_reply("OK"), _cli_reply("> 20")])

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_set(
                KEY_A, RepeaterSettingSetRequest(setting="tx", value="20")
            )

        assert _sent_commands(mc) == ["set tx 20", "get tx"]
        assert response.status == "ok"
        assert response.value == "20"
        assert response.set_reply == "OK"
        assert response.readback == "20"
        assert response.reboot_required is False

    @pytest.mark.asyncio
    async def test_mismatch_is_reported(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(side_effect=[_cli_reply("OK"), _cli_reply("> 60")])

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_set(
                KEY_A, RepeaterSettingSetRequest(setting="advert.interval", value="120")
            )

        assert response.status == "mismatch"
        assert response.readback == "60"

    @pytest.mark.asyncio
    async def test_firmware_error_reply_is_rejected_and_still_read_back(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(
            side_effect=[_cli_reply("Error: unsupported"), _cli_reply("> off")]
        )

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_set(
                KEY_A, RepeaterSettingSetRequest(setting="radio.rxgain", value="on")
            )

        assert _sent_commands(mc) == ["set radio.rxgain on", "get radio.rxgain"]
        assert response.status == "rejected"
        assert response.readback == "off"

    @pytest.mark.asyncio
    async def test_timeout_on_both_is_unverified(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(return_value=_radio_result(EventType.NO_MORE_MSGS))
        # Advance 6 s per clock read so each 10 s fetch window expires quickly.
        clock = {"t": 0.0}

        def _tick():
            clock["t"] += 6.0
            return clock["t"]

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=_tick),
        ):
            response = await repeater_settings_set(
                KEY_A, RepeaterSettingSetRequest(setting="flood.max", value="8")
            )

        assert _sent_commands(mc) == ["set flood.max 8", "get flood.max"]
        assert response.status == "unverified"
        assert response.set_reply is None
        assert response.readback is None

    @pytest.mark.asyncio
    async def test_radio_is_one_command_and_flags_reboot(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(
            side_effect=[
                _cli_reply("OK - reboot to apply"),
                _cli_reply("> 869.5250244,62.5,8,8"),
            ]
        )

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_set(
                KEY_A, RepeaterSettingSetRequest(setting="radio", value="869.525,62.5,8,8")
            )

        assert _sent_commands(mc) == ["set radio 869.525,62.5,8,8", "get radio"]
        assert response.status == "ok"
        assert response.reboot_required is True

    @pytest.mark.asyncio
    async def test_not_a_repeater_is_400(self, test_db):
        mc = _mock_mc()
        await ContactRepository.upsert(
            {"public_key": KEY_A, "name": "Client", "type": 1, "flags": 0}
        )
        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
        ):
            with pytest.raises(HTTPException) as exc:
                await repeater_settings_set(
                    KEY_A, RepeaterSettingSetRequest(setting="tx", value="20")
                )
        assert exc.value.status_code == 400
        mc.commands.send_cmd.assert_not_awaited()


class TestReadEndpoint:
    @pytest.mark.asyncio
    async def test_rejects_non_allow_listed_key(self, test_db):
        mc = _mock_mc()
        require = MagicMock(return_value=mc)
        with patch("app.routers.repeaters.radio_manager.require_connected", require):
            with pytest.raises(HTTPException) as exc:
                await repeater_settings_read(
                    KEY_A, RepeaterSettingsReadRequest(settings=["prv.key"])
                )
        assert exc.value.status_code == 400
        require.assert_not_called()

    @pytest.mark.asyncio
    async def test_reads_requested_keys_and_nulls_error_sentinels(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(
            side_effect=[_cli_reply("> strict"), _cli_reply("unknown config: int.thresh")]
        )

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_read(
                KEY_A, RepeaterSettingsReadRequest(settings=["loop.detect", "int.thresh"])
            )

        assert _sent_commands(mc) == ["get loop.detect", "get int.thresh"]
        assert all(cmd.startswith("get ") for cmd in _sent_commands(mc))
        assert response.values == {"loop.detect": "strict", "int.thresh": None}

    @pytest.mark.asyncio
    async def test_default_reads_every_allow_listed_key_with_get_only(self, test_db):
        mc = _mock_mc()
        await _insert_repeater()
        mc.commands.get_msg = AsyncMock(side_effect=[_cli_reply("> x")] * len(rs.SETTINGS))

        with (
            patch("app.routers.repeaters.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(_MONOTONIC, side_effect=lambda: 0.0),
        ):
            response = await repeater_settings_read(KEY_A, RepeaterSettingsReadRequest())

        sent = _sent_commands(mc)
        assert sent == [f"get {spec.verb}" for spec in rs.SETTINGS.values()]
        assert set(response.values) == set(rs.SETTINGS)
