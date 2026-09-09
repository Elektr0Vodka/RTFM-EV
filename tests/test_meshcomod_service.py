from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType

from app.services.meshcomod import (
    apply_meshcomod_update,
    build_set_tuning_frame,
    capture_tuning_frame,
    clamp_gps_interval,
    is_meshcomod,
    parse_tuning_response,
    read_meshcomod_settings,
)
from app.services.radio_commands import RadioCommandRejectedError


class TestTuningFrame:
    def test_build_set_tuning_frame_layout(self):
        # rx_delay raw 0, airtime raw 1000 (0x3E8), cad on
        frame = build_set_tuning_frame(0, 1000, 1)
        assert frame == bytes.fromhex("1500000000e803000001")

    def test_build_set_tuning_frame_cad_off(self):
        frame = build_set_tuning_frame(0, 1000, 0)
        assert frame[0] == 0x15
        assert frame[9] == 0

    def test_parse_tuning_response_with_cad(self):
        res = parse_tuning_response(bytes.fromhex("1700000000e803000001"))
        assert res == {"rx_delay": 0, "airtime_factor": 1000, "cad_enabled": 1}

    def test_parse_tuning_response_without_cad(self):
        res = parse_tuning_response(bytes.fromhex("1700000000e8030000"))
        assert res == {"rx_delay": 0, "airtime_factor": 1000, "cad_enabled": None}


class TestDetection:
    def test_is_meshcomod_by_ver_code(self):
        assert is_meshcomod(27, "v1.17.0.4") is True

    def test_is_meshcomod_by_version_substring(self):
        assert is_meshcomod(13, "v1.17.0.4-DMC-EV-d5") is True

    def test_not_meshcomod(self):
        assert is_meshcomod(13, "v1.17.0") is False

    def test_is_meshcomod_handles_none(self):
        assert is_meshcomod(None, None) is False


class TestClamp:
    def test_clamp_gps_interval_bounds(self):
        assert clamp_gps_interval(-5) == 0
        assert clamp_gps_interval(999999) == 86400
        assert clamp_gps_interval(600) == 600


def _event(type_=EventType.OK, payload=None):
    ev = MagicMock()
    ev.type = type_
    ev.payload = payload if payload is not None else {}
    return ev


def _mock_mc(tuning_frame_hex="1700000000e803000001", custom_vars=None):
    mc = MagicMock()
    reader = MagicMock()
    reader.handle_rx = AsyncMock()
    mc._reader = reader

    async def _get_tuning():
        # Simulate the radio pushing the 0x17 frame through the reader.
        await mc._reader.handle_rx(bytes.fromhex(tuning_frame_hex))
        return _event(EventType.TUNING_PARAMS, {"rx_delay": 0, "airtime_factor": 1000})

    mc.commands = MagicMock()
    mc.commands.get_tuning = AsyncMock(side_effect=_get_tuning)
    mc.commands.send = AsyncMock(return_value=_event(EventType.OK))
    mc.commands.get_custom_vars = AsyncMock(
        return_value=_event(EventType.CUSTOM_VARS, custom_vars if custom_vars is not None else {})
    )
    mc.commands.set_custom_var = AsyncMock(return_value=_event(EventType.OK))
    return mc


class TestReadMeshcomod:
    @pytest.mark.asyncio
    async def test_capture_tuning_frame_restores_reader(self):
        mc = _mock_mc()
        original = mc._reader.handle_rx
        frame = await capture_tuning_frame(mc)
        assert frame == bytes.fromhex("1700000000e803000001")
        assert mc._reader.handle_rx is original  # restored

    @pytest.mark.asyncio
    async def test_read_settings_cad_and_gps(self):
        mc = _mock_mc(custom_vars={"gps": "1", "gps_interval": "600"})
        data = await read_meshcomod_settings(mc)
        assert data == {
            "cad_supported": True,
            "cad_enabled": True,
            "gps_supported": True,
            "gps_enabled": True,
            "gps_interval": 600,
        }

    @pytest.mark.asyncio
    async def test_read_settings_no_cad_no_gps(self):
        mc = _mock_mc(tuning_frame_hex="1700000000e8030000", custom_vars={})
        data = await read_meshcomod_settings(mc)
        assert data["cad_supported"] is False
        assert data["cad_enabled"] is None
        assert data["gps_supported"] is False


class TestApplyMeshcomod:
    @pytest.mark.asyncio
    async def test_apply_cad_sends_raw_frame_preserving_tuning(self):
        mc = _mock_mc()
        await apply_meshcomod_update(mc, cad_enabled=False)
        sent = mc.commands.send.await_args.args[0]
        assert sent == bytes.fromhex("1500000000e803000000")  # cad byte 0

    @pytest.mark.asyncio
    async def test_apply_cad_raises_on_error(self):
        mc = _mock_mc()
        mc.commands.send = AsyncMock(return_value=_event(EventType.ERROR, {"reason": "x"}))
        with pytest.raises(RadioCommandRejectedError):
            await apply_meshcomod_update(mc, cad_enabled=True)

    @pytest.mark.asyncio
    async def test_apply_gps_sets_vars_and_clamps(self):
        mc = _mock_mc()
        await apply_meshcomod_update(mc, gps_enabled=True, gps_interval=999999)
        mc.commands.set_custom_var.assert_any_await("gps", "1")
        mc.commands.set_custom_var.assert_any_await("gps_interval", "86400")
