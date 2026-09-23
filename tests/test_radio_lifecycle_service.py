from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.radio_lifecycle import (
    prepare_connected_radio,
    reconnect_and_prepare_radio,
    run_post_connect_setup,
)


class TestPrepareConnectedRadio:
    @pytest.mark.asyncio
    async def test_runs_setup_then_broadcasts_health(self):
        radio_manager = MagicMock()
        radio_manager._last_connected = False
        radio_manager.connection_info = "TCP: test:4000"

        call_order: list[str] = []

        async def _setup():
            call_order.append("setup")

        radio_manager.post_connect_setup = AsyncMock(side_effect=_setup)

        with patch("app.websocket.broadcast_health") as mock_broadcast:
            await prepare_connected_radio(radio_manager, broadcast_on_success=True)

        assert call_order == ["setup"]
        assert radio_manager._last_connected is True
        mock_broadcast.assert_called_once_with(True, "TCP: test:4000")

    @pytest.mark.asyncio
    async def test_can_skip_broadcast(self):
        radio_manager = MagicMock()
        radio_manager._last_connected = False
        radio_manager.connection_info = "TCP: test:4000"
        radio_manager.post_connect_setup = AsyncMock()

        with patch("app.websocket.broadcast_health") as mock_broadcast:
            await prepare_connected_radio(radio_manager, broadcast_on_success=False)

        assert radio_manager._last_connected is True
        mock_broadcast.assert_not_called()


class TestReconnectAndPrepareRadio:
    @pytest.mark.asyncio
    async def test_reconnects_without_early_health_broadcast(self):
        radio_manager = MagicMock()
        radio_manager._last_connected = False
        radio_manager.connection_info = "Serial: /dev/ttyUSB0"

        reconnect_calls: list[bool] = []
        call_order: list[str] = []

        async def _reconnect(*, broadcast_on_success: bool):
            reconnect_calls.append(broadcast_on_success)
            call_order.append("reconnect")
            return True

        async def _setup():
            call_order.append("setup")

        radio_manager.reconnect = AsyncMock(side_effect=_reconnect)
        radio_manager.post_connect_setup = AsyncMock(side_effect=_setup)

        with patch("app.websocket.broadcast_health") as mock_broadcast:
            result = await reconnect_and_prepare_radio(radio_manager, broadcast_on_success=True)

        assert result is True
        assert reconnect_calls == [False]
        assert call_order == ["reconnect", "setup"]
        assert radio_manager._last_connected is True
        mock_broadcast.assert_called_once_with(True, "Serial: /dev/ttyUSB0")

    @pytest.mark.asyncio
    async def test_returns_false_without_running_setup_when_reconnect_fails(self):
        radio_manager = MagicMock()
        radio_manager.reconnect = AsyncMock(return_value=False)
        radio_manager.post_connect_setup = AsyncMock()

        with patch("app.websocket.broadcast_health") as mock_broadcast:
            result = await reconnect_and_prepare_radio(radio_manager, broadcast_on_success=True)

        assert result is False
        radio_manager.post_connect_setup.assert_not_awaited()
        mock_broadcast.assert_not_called()


class TestRunPostConnectSetup:
    @pytest.mark.asyncio
    async def test_uses_current_meshcore_after_waiting_for_operation_lock(self):
        initial_mc = MagicMock()
        initial_mc.commands.send_device_query = AsyncMock(return_value=None)
        initial_mc.commands.set_flood_scope = AsyncMock(return_value=None)
        initial_mc.commands.send = AsyncMock(return_value=None)
        initial_mc._reader = MagicMock()
        initial_mc._reader.handle_rx = AsyncMock()
        initial_mc.start_auto_message_fetching = AsyncMock()

        replacement_mc = MagicMock()
        replacement_mc.commands.send_device_query = AsyncMock(
            return_value=MagicMock(payload={"max_channels": 8})
        )
        replacement_mc.commands.set_flood_scope = AsyncMock(return_value=None)
        replacement_mc.commands.send = AsyncMock(return_value=None)
        replacement_mc._reader = MagicMock()
        replacement_mc._reader.handle_rx = AsyncMock()
        replacement_mc.start_auto_message_fetching = AsyncMock()

        radio_manager = MagicMock()
        radio_manager.meshcore = initial_mc
        radio_manager._setup_lock = None
        radio_manager._setup_in_progress = False
        radio_manager._setup_complete = False
        radio_manager.device_info_loaded = False
        radio_manager.max_contacts = None
        radio_manager.device_model = None
        radio_manager.firmware_build = None
        radio_manager.firmware_version = None
        radio_manager.max_channels = 40
        radio_manager.path_hash_mode = 0
        radio_manager.path_hash_mode_supported = False

        async def _acquire(*args, **kwargs):
            radio_manager.meshcore = replacement_mc

        radio_manager._acquire_operation_lock = AsyncMock(side_effect=_acquire)
        radio_manager._release_operation_lock = MagicMock()

        with (
            patch("app.event_handlers.register_event_handlers") as mock_register_handlers,
            patch("app.keystore.export_and_store_private_key", new=AsyncMock()) as mock_export_key,
            patch("app.radio_sync.sync_radio_time", new=AsyncMock()) as mock_sync_time,
            patch(
                "app.repository.AppSettingsRepository.get",
                new=AsyncMock(return_value=MagicMock(flood_scope=None)),
            ),
            patch("app.radio_sync.sync_and_offload_all", new=AsyncMock(return_value={"synced": 0})),
            patch("app.radio_sync.send_advertisement", new=AsyncMock(return_value=False)),
            patch("app.radio_sync.drain_pending_messages", new=AsyncMock(return_value=0)),
            patch("app.radio_sync.start_periodic_sync"),
            patch("app.radio_sync.start_periodic_advert"),
            patch("app.radio_sync.start_message_polling"),
        ):
            await run_post_connect_setup(radio_manager)

        mock_register_handlers.assert_called_once_with(replacement_mc)
        mock_export_key.assert_awaited_once_with(replacement_mc)
        mock_sync_time.assert_awaited_once_with(replacement_mc)
        replacement_mc.start_auto_message_fetching.assert_awaited_once()
        initial_mc.start_auto_message_fetching.assert_not_called()
        assert radio_manager.max_channels == 8

    @pytest.mark.asyncio
    async def test_caches_device_info_metadata_from_device_query(self):
        mc = MagicMock()
        mc.commands.send_device_query = AsyncMock(
            return_value=MagicMock(
                payload={
                    "fw ver": 10,
                    "max_contacts": 350,
                    "max_channels": 64,
                    "model": "T-Echo",
                    "fw_build": "2025-02-01",
                    "ver": "1.2.3",
                    "path_hash_mode": 2,
                }
            )
        )
        mc.commands.set_flood_scope = AsyncMock(return_value=None)
        mc.commands.send = AsyncMock(return_value=None)
        mc._reader = MagicMock()
        mc._reader.handle_rx = AsyncMock()
        mc.start_auto_message_fetching = AsyncMock()

        radio_manager = MagicMock()
        radio_manager.meshcore = mc
        radio_manager._setup_lock = None
        radio_manager._setup_in_progress = False
        radio_manager._setup_complete = False
        radio_manager.device_info_loaded = False
        radio_manager.max_contacts = None
        radio_manager.device_model = None
        radio_manager.firmware_build = None
        radio_manager.firmware_version = None
        radio_manager.max_channels = 40
        radio_manager.path_hash_mode = 0
        radio_manager.path_hash_mode_supported = False
        radio_manager._acquire_operation_lock = AsyncMock()
        radio_manager._release_operation_lock = MagicMock()

        with (
            patch("app.event_handlers.register_event_handlers"),
            patch("app.keystore.export_and_store_private_key", new=AsyncMock()),
            patch("app.radio_sync.sync_radio_time", new=AsyncMock()),
            patch(
                "app.repository.AppSettingsRepository.get",
                new=AsyncMock(return_value=MagicMock(flood_scope=None)),
            ),
            patch("app.radio_sync.sync_and_offload_all", new=AsyncMock(return_value={"synced": 0})),
            patch("app.radio_sync.send_advertisement", new=AsyncMock(return_value=False)),
            patch("app.radio_sync.drain_pending_messages", new=AsyncMock(return_value=0)),
            patch("app.radio_sync.start_periodic_sync"),
            patch("app.radio_sync.start_periodic_advert"),
            patch("app.radio_sync.start_message_polling"),
        ):
            await run_post_connect_setup(radio_manager)

        assert radio_manager.device_info_loaded is True
        assert radio_manager.max_contacts == 350
        assert radio_manager.max_channels == 64
        assert radio_manager.device_model == "T-Echo"
        assert radio_manager.firmware_build == "2025-02-01"
        assert radio_manager.firmware_version == "1.2.3"
        assert radio_manager.path_hash_mode == 2
        assert radio_manager.path_hash_mode_supported is True

    def _base_radio_manager(self, mc) -> MagicMock:
        radio_manager = MagicMock()
        radio_manager.meshcore = mc
        radio_manager._setup_lock = None
        radio_manager._setup_in_progress = False
        radio_manager._setup_complete = False
        radio_manager.device_info_loaded = False
        radio_manager.max_contacts = None
        radio_manager.device_model = None
        radio_manager.firmware_build = None
        radio_manager.firmware_version = None
        radio_manager.max_channels = 40
        radio_manager.path_hash_mode = 0
        radio_manager.path_hash_mode_supported = False
        radio_manager.client_repeat = None
        radio_manager.allowed_repeat_freqs = None
        radio_manager._acquire_operation_lock = AsyncMock()
        radio_manager._release_operation_lock = MagicMock()
        return radio_manager

    def _patched_setup(self):
        return (
            patch("app.event_handlers.register_event_handlers"),
            patch("app.keystore.export_and_store_private_key", new=AsyncMock()),
            patch("app.radio_sync.sync_radio_time", new=AsyncMock()),
            patch(
                "app.repository.AppSettingsRepository.get",
                new=AsyncMock(return_value=MagicMock(flood_scope=None)),
            ),
            patch("app.radio_sync.sync_and_offload_all", new=AsyncMock(return_value={"synced": 0})),
            patch("app.radio_sync.send_advertisement", new=AsyncMock(return_value=False)),
            patch("app.radio_sync.drain_pending_messages", new=AsyncMock(return_value=0)),
            patch("app.radio_sync.start_periodic_sync"),
            patch("app.radio_sync.start_periodic_advert"),
            patch("app.radio_sync.start_message_polling"),
        )

    @pytest.mark.asyncio
    async def test_reads_client_repeat_and_allowed_freqs_when_fw9_plus(self):
        """Phase 0: connect must learn the device's current repeat state (fw >= 9)
        so a later radio-config save can preserve it instead of resetting it."""
        mc = MagicMock()
        mc.commands.send_device_query = AsyncMock(
            return_value=MagicMock(payload={"fw ver": 9, "repeat": True})
        )
        mc.commands.get_allowed_repeat_freq = AsyncMock(
            return_value=MagicMock(
                payload={"freqs": [{"min": 433000, "max": 433000}, {"min": 869495, "max": 869495}]}
            )
        )
        mc.commands.set_flood_scope = AsyncMock(return_value=None)
        mc.commands.send = AsyncMock(return_value=None)
        mc._reader = MagicMock()
        mc._reader.handle_rx = AsyncMock()
        mc.start_auto_message_fetching = AsyncMock()

        radio_manager = self._base_radio_manager(mc)

        with ExitStack() as stack:
            for context_manager in self._patched_setup():
                stack.enter_context(context_manager)
            await run_post_connect_setup(radio_manager)

        assert radio_manager.client_repeat is True
        assert radio_manager.allowed_repeat_freqs == [
            {"min": 433000, "max": 433000},
            {"min": 869495, "max": 869495},
        ]
        mc.commands.get_allowed_repeat_freq.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_client_repeat_none_and_no_freq_query_below_fw9(self):
        mc = MagicMock()
        mc.commands.send_device_query = AsyncMock(return_value=MagicMock(payload={"fw ver": 8}))
        mc.commands.get_allowed_repeat_freq = AsyncMock()
        mc.commands.set_flood_scope = AsyncMock(return_value=None)
        mc.commands.send = AsyncMock(return_value=None)
        mc._reader = MagicMock()
        mc._reader.handle_rx = AsyncMock()
        mc.start_auto_message_fetching = AsyncMock()

        radio_manager = self._base_radio_manager(mc)

        with ExitStack() as stack:
            for context_manager in self._patched_setup():
                stack.enter_context(context_manager)
            await run_post_connect_setup(radio_manager)

        assert radio_manager.client_repeat is None
        assert radio_manager.allowed_repeat_freqs is None
        mc.commands.get_allowed_repeat_freq.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_client_repeat_from_raw_frame_fallback(self):
        """Older meshcore_py builds may not parse 'repeat' into the payload dict;
        RTFM-EV must fall back to raw byte 80 of the DEVICE_INFO frame."""
        raw = bytearray(81)
        raw[0] = 13  # PacketType.DEVICE_INFO
        raw[1] = 9  # fw_ver
        raw[2] = 10  # max_contacts / 2
        raw[3] = 8  # max_channels
        raw[80] = 1  # repeat = on
        raw_bytes = bytes(raw)

        mc = MagicMock()
        mc._reader = MagicMock()

        async def _send_device_query_side_effect():
            # Simulate the reader dispatching the raw DEVICE_INFO frame to the
            # (patched) handle_rx before the command's own event resolves,
            # exactly as the real reader does.
            await mc._reader.handle_rx(bytearray(raw_bytes))
            return MagicMock(payload={"fw ver": 9})  # no "repeat" key: stale payload

        mc.commands.send_device_query = AsyncMock(side_effect=_send_device_query_side_effect)
        mc.commands.get_allowed_repeat_freq = AsyncMock(
            return_value=MagicMock(payload={"freqs": []})
        )
        mc.commands.set_flood_scope = AsyncMock(return_value=None)
        mc.commands.send = AsyncMock(return_value=None)
        mc._reader.handle_rx = AsyncMock()
        mc.start_auto_message_fetching = AsyncMock()

        radio_manager = self._base_radio_manager(mc)

        with ExitStack() as stack:
            for context_manager in self._patched_setup():
                stack.enter_context(context_manager)
            await run_post_connect_setup(radio_manager)

        assert radio_manager.client_repeat is True
