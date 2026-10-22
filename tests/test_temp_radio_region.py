"""A temporary session region overrides per-channel/per-contact scope overrides (spec 4.2)."""

from unittest.mock import patch

import pytest

from app.models import SendChannelMessageRequest, SendDirectMessageRequest
from app.radio import radio_manager
from app.repository import AppSettingsRepository, ChannelRepository, ContactRepository
from app.routers.messages import send_channel_message, send_direct_message
from app.services.temp_radio import temp_radio
from tests.test_send_messages import _insert_contact, _make_mc, _reset_radio_state  # noqa: F401


@pytest.mark.asyncio
async def test_channel_override_bypassed_during_session_region(test_db):
    mc = _make_mc(name="MyNode")
    chan_key = "e1" * 16
    await ChannelRepository.upsert(key=chan_key, name="#border")
    await ChannelRepository.update_flood_scope_override(chan_key, "Esperance")
    await AppSettingsRepository.update(flood_scope="Baseline")

    with (
        patch.object(temp_radio, "session_region", return_value="#be"),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch("app.routers.messages.broadcast_event"),
    ):
        await send_channel_message(SendChannelMessageRequest(channel_key=chan_key, text="hoi"))

    mc.commands.set_flood_scope.assert_not_awaited()


@pytest.mark.asyncio
async def test_dm_override_bypassed_during_session_region(test_db):
    mc = _make_mc()
    pub_key = "e2" * 32
    await _insert_contact(pub_key, "Alice")
    await ContactRepository.update_flood_scope_override(pub_key, "#Esperance")
    await AppSettingsRepository.update(flood_scope="Baseline")

    with (
        patch.object(temp_radio, "session_region", return_value="#be"),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch("app.routers.messages.broadcast_event"),
    ):
        await send_direct_message(SendDirectMessageRequest(destination=pub_key, text="hi"))

    mc.commands.set_flood_scope.assert_not_awaited()


@pytest.mark.asyncio
async def test_settings_flood_scope_save_not_pushed_during_session_region(test_db):
    from app.routers.settings import AppSettingsUpdate, update_settings

    mc = _make_mc()
    with (
        patch.object(temp_radio, "session_region", return_value="#be"),
        patch.object(radio_manager, "_meshcore", mc),
    ):
        result = await update_settings(AppSettingsUpdate(flood_scope="Home"))

    assert result.flood_scope == "#Home"
    mc.commands.set_flood_scope.assert_not_awaited()
