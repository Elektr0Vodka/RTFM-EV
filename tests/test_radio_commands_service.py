from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType

from app.routers.radio import RadioConfigUpdate, RadioSettings
from app.services.radio_commands import (
    KeystoreRefreshError,
    PathHashModeUnsupportedError,
    RadioCommandRejectedError,
    RadioRepeatFrequencyError,
    apply_radio_config_update,
    import_private_key_and_refresh_keystore,
)


def _radio_result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _mock_meshcore_with_info():
    mc = MagicMock()
    mc.self_info = {
        "adv_lat": 10.0,
        "adv_lon": 20.0,
    }
    mc.commands = MagicMock()
    mc.commands.set_name = AsyncMock()
    mc.commands.set_coords = AsyncMock()
    mc.commands.set_tx_power = AsyncMock()
    mc.commands.set_radio = AsyncMock(return_value=_radio_result())
    mc.commands.set_path_hash_mode = AsyncMock(return_value=_radio_result())
    mc.commands.set_advert_loc_policy = AsyncMock(return_value=_radio_result())
    mc.commands.set_multi_acks = AsyncMock(return_value=_radio_result())
    mc.commands.send_device_query = AsyncMock(return_value=_radio_result(payload={}))
    mc.commands.send_appstart = AsyncMock()
    mc.commands.import_private_key = AsyncMock(return_value=_radio_result())
    return mc


class TestApplyRadioConfigUpdate:
    @pytest.mark.asyncio
    async def test_updates_requested_fields_and_refreshes_info(self):
        mc = _mock_meshcore_with_info()
        sync_radio_time_fn = AsyncMock()
        set_path_hash_mode = MagicMock()
        update = RadioConfigUpdate(
            name="NodeUpdated",
            lat=1.23,
            tx_power=17,
            radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5),
            path_hash_mode=1,
        )

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=True,
            set_path_hash_mode=set_path_hash_mode,
            sync_radio_time_fn=sync_radio_time_fn,
        )

        mc.commands.set_name.assert_awaited_once_with("NodeUpdated")
        mc.commands.set_coords.assert_awaited_once_with(lat=1.23, lon=20.0)
        mc.commands.set_tx_power.assert_awaited_once_with(val=17)
        mc.commands.set_radio.assert_awaited_once_with(freq=910.525, bw=62.5, sf=7, cr=5)
        mc.commands.set_path_hash_mode.assert_awaited_once_with(1)
        set_path_hash_mode.assert_called_once_with(1)
        sync_radio_time_fn.assert_awaited_once_with(mc)
        mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_updates_advert_location_source(self):
        mc = _mock_meshcore_with_info()

        await apply_radio_config_update(
            mc,
            RadioConfigUpdate(advert_location_source="current"),
            path_hash_mode_supported=True,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
        )

        mc.commands.set_advert_loc_policy.assert_awaited_once_with(1)
        mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_updates_multi_acks_enabled(self):
        mc = _mock_meshcore_with_info()

        await apply_radio_config_update(
            mc,
            RadioConfigUpdate(multi_acks_enabled=True),
            path_hash_mode_supported=True,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
        )

        mc.commands.set_multi_acks.assert_awaited_once_with(1)
        mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_when_radio_rejects_multi_acks(self):
        mc = _mock_meshcore_with_info()
        mc.commands.set_multi_acks = AsyncMock(
            return_value=_radio_result(EventType.ERROR, {"error": "nope"})
        )

        with pytest.raises(RadioCommandRejectedError):
            await apply_radio_config_update(
                mc,
                RadioConfigUpdate(multi_acks_enabled=False),
                path_hash_mode_supported=True,
                set_path_hash_mode=MagicMock(),
                sync_radio_time_fn=AsyncMock(),
            )

        mc.commands.send_appstart.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_raises_when_radio_rejects_advert_location_source(self):
        mc = _mock_meshcore_with_info()
        mc.commands.set_advert_loc_policy = AsyncMock(
            return_value=_radio_result(EventType.ERROR, {"error": "nope"})
        )

        with pytest.raises(RadioCommandRejectedError):
            await apply_radio_config_update(
                mc,
                RadioConfigUpdate(advert_location_source="off"),
                path_hash_mode_supported=True,
                set_path_hash_mode=MagicMock(),
                sync_radio_time_fn=AsyncMock(),
            )

        mc.commands.send_appstart.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_rejects_unsupported_path_hash_mode(self):
        mc = _mock_meshcore_with_info()
        update = RadioConfigUpdate(path_hash_mode=1)

        with pytest.raises(PathHashModeUnsupportedError):
            await apply_radio_config_update(
                mc,
                update,
                path_hash_mode_supported=False,
                set_path_hash_mode=MagicMock(),
                sync_radio_time_fn=AsyncMock(),
            )

        mc.commands.set_path_hash_mode.assert_not_awaited()
        mc.commands.send_appstart.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_raises_when_radio_rejects_path_hash_mode(self):
        mc = _mock_meshcore_with_info()
        mc.commands.set_path_hash_mode = AsyncMock(
            return_value=_radio_result(EventType.ERROR, {"error": "nope"})
        )
        update = RadioConfigUpdate(path_hash_mode=1)
        set_path_hash_mode = MagicMock()

        with pytest.raises(RadioCommandRejectedError):
            await apply_radio_config_update(
                mc,
                update,
                path_hash_mode_supported=True,
                set_path_hash_mode=set_path_hash_mode,
                sync_radio_time_fn=AsyncMock(),
            )

        set_path_hash_mode.assert_not_called()
        mc.commands.send_appstart.assert_not_awaited()


class TestApplyRadioConfigUpdateRepeatByte:
    """Phase 0 bug fix: set_radio must not silently reset client repeat.

    meshcore 2.3.9.1's set_radio(freq, bw, sf, cr, repeat=None) only appends
    the wire repeat byte when repeat is not None. Stock companion firmware
    (MyMesh.cpp, CMD_SET_RADIO_PARAMS) treats a missing byte as 0 and always
    persists it via _prefs.client_repeat = repeat; savePrefs(). So every save
    without an explicit repeat= silently turns client repeat off.
    """

    @pytest.mark.asyncio
    async def test_sends_repeat_1_for_fw9_plus_when_currently_on(self):
        mc = _mock_meshcore_with_info()
        mc.commands.send_device_query = AsyncMock(
            return_value=_radio_result(payload={"repeat": True})
        )
        set_client_repeat = MagicMock()
        update = RadioConfigUpdate(radio=RadioSettings(freq=869.495, bw=62.5, sf=7, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=9,
            client_repeat=True,
            allowed_repeat_freqs=[{"min": 869495, "max": 869495}],
            set_client_repeat=set_client_repeat,
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=869.495, bw=62.5, sf=7, cr=5, repeat=1)
        mc.commands.send_device_query.assert_awaited_once()
        set_client_repeat.assert_called_once_with(True)

    @pytest.mark.asyncio
    async def test_sends_repeat_0_for_fw9_plus_when_currently_off(self):
        mc = _mock_meshcore_with_info()
        mc.commands.send_device_query = AsyncMock(
            return_value=_radio_result(payload={"repeat": False})
        )
        update = RadioConfigUpdate(radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=9,
            client_repeat=False,
            allowed_repeat_freqs=None,
            set_client_repeat=MagicMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=910.525, bw=62.5, sf=7, cr=5, repeat=0)

    @pytest.mark.asyncio
    async def test_sends_repeat_0_for_fw9_plus_when_unknown(self):
        """client_repeat=None (never read, e.g. query failed) must not default to on."""
        mc = _mock_meshcore_with_info()
        mc.commands.send_device_query = AsyncMock(return_value=_radio_result(payload={}))
        update = RadioConfigUpdate(radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=9,
            client_repeat=None,
            allowed_repeat_freqs=None,
            set_client_repeat=MagicMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=910.525, bw=62.5, sf=7, cr=5, repeat=0)

    @pytest.mark.asyncio
    async def test_omits_repeat_kwarg_below_fw9(self):
        mc = _mock_meshcore_with_info()
        update = RadioConfigUpdate(radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=8,
            client_repeat=None,
            allowed_repeat_freqs=None,
            set_client_repeat=MagicMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=910.525, bw=62.5, sf=7, cr=5)
        mc.commands.send_device_query.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_omits_repeat_kwarg_when_firmware_ver_code_unknown(self):
        """Default behavior (no firmware_ver_code passed) matches pre-fix callers."""
        mc = _mock_meshcore_with_info()
        update = RadioConfigUpdate(radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=910.525, bw=62.5, sf=7, cr=5)

    @pytest.mark.asyncio
    async def test_rejects_disallowed_frequency_when_repeat_on(self):
        mc = _mock_meshcore_with_info()
        update = RadioConfigUpdate(radio=RadioSettings(freq=869.618, bw=250.0, sf=8, cr=5))

        with pytest.raises(RadioRepeatFrequencyError):
            await apply_radio_config_update(
                mc,
                update,
                path_hash_mode_supported=False,
                set_path_hash_mode=MagicMock(),
                sync_radio_time_fn=AsyncMock(),
                firmware_ver_code=9,
                client_repeat=True,
                allowed_repeat_freqs=[
                    {"min": 433000, "max": 433000},
                    {"min": 869495, "max": 869495},
                    {"min": 918000, "max": 918000},
                ],
                set_client_repeat=MagicMock(),
            )

        mc.commands.set_radio.assert_not_awaited()
        mc.commands.send_appstart.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_allows_disallowed_frequency_change_when_repeat_off(self):
        mc = _mock_meshcore_with_info()
        mc.commands.send_device_query = AsyncMock(
            return_value=_radio_result(payload={"repeat": False})
        )
        update = RadioConfigUpdate(radio=RadioSettings(freq=869.618, bw=250.0, sf=8, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=9,
            client_repeat=False,
            allowed_repeat_freqs=[{"min": 869495, "max": 869495}],
            set_client_repeat=MagicMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=869.618, bw=250.0, sf=8, cr=5, repeat=0)

    @pytest.mark.asyncio
    async def test_does_not_block_when_allowed_freqs_unknown(self):
        """Without a queried allow-list we cannot pre-validate; let the firmware decide."""
        mc = _mock_meshcore_with_info()
        mc.commands.send_device_query = AsyncMock(
            return_value=_radio_result(payload={"repeat": True})
        )
        update = RadioConfigUpdate(radio=RadioSettings(freq=869.618, bw=250.0, sf=8, cr=5))

        await apply_radio_config_update(
            mc,
            update,
            path_hash_mode_supported=False,
            set_path_hash_mode=MagicMock(),
            sync_radio_time_fn=AsyncMock(),
            firmware_ver_code=9,
            client_repeat=True,
            allowed_repeat_freqs=None,
            set_client_repeat=MagicMock(),
        )

        mc.commands.set_radio.assert_awaited_once_with(freq=869.618, bw=250.0, sf=8, cr=5, repeat=1)

    @pytest.mark.asyncio
    async def test_raises_when_radio_rejects_set_radio(self):
        mc = _mock_meshcore_with_info()
        mc.commands.set_radio = AsyncMock(
            return_value=_radio_result(EventType.ERROR, {"error": "illegal arg"})
        )
        update = RadioConfigUpdate(radio=RadioSettings(freq=910.525, bw=62.5, sf=7, cr=5))

        with pytest.raises(RadioCommandRejectedError):
            await apply_radio_config_update(
                mc,
                update,
                path_hash_mode_supported=False,
                set_path_hash_mode=MagicMock(),
                sync_radio_time_fn=AsyncMock(),
                firmware_ver_code=9,
                client_repeat=False,
                allowed_repeat_freqs=None,
                set_client_repeat=MagicMock(),
            )

        mc.commands.send_device_query.assert_not_awaited()
        mc.commands.send_appstart.assert_not_awaited()


class TestImportPrivateKeyAndRefreshKeystore:
    @pytest.mark.asyncio
    async def test_rejects_radio_error(self):
        mc = _mock_meshcore_with_info()
        mc.commands.import_private_key = AsyncMock(
            return_value=_radio_result(EventType.ERROR, {"error": "failed"})
        )
        export_fn = AsyncMock(return_value=True)

        with pytest.raises(RadioCommandRejectedError):
            await import_private_key_and_refresh_keystore(
                mc,
                b"\xaa" * 64,
                export_and_store_private_key_fn=export_fn,
            )

        export_fn.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_retries_keystore_refresh_once(self):
        mc = _mock_meshcore_with_info()
        export_fn = AsyncMock(side_effect=[False, True])

        await import_private_key_and_refresh_keystore(
            mc,
            b"\xaa" * 64,
            export_and_store_private_key_fn=export_fn,
        )

        mc.commands.import_private_key.assert_awaited_once_with(b"\xaa" * 64)
        assert export_fn.await_count == 2

    @pytest.mark.asyncio
    async def test_raises_when_keystore_refresh_fails_twice(self):
        mc = _mock_meshcore_with_info()
        export_fn = AsyncMock(return_value=False)

        with pytest.raises(KeystoreRefreshError):
            await import_private_key_and_refresh_keystore(
                mc,
                b"\xaa" * 64,
                export_and_store_private_key_fn=export_fn,
            )

        assert export_fn.await_count == 2
