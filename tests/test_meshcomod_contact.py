"""meshcomod's built-in "Meshcomod" command contact.

The firmware lists it after every contact sync with the key "MESHCM" + zeros. A DM
to it runs on the radio and never goes out over LoRa, so RTFM-EV must not load it
into the radio's contact table, retry or reset its path, fan its chat out, or run
mesh actions against it.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

import app.services.message_send as message_send_service
from app.fanout.manager import _scope_matches_message
from app.meshcomod_contact import is_meshcomod_command_contact
from app.models import SendDirectMessageRequest
from app.push.manager import PushManager
from app.radio import radio_manager
from app.radio_sync import (
    _reapply_app_contact_permissions,
    get_radio_residency,
    should_run_full_periodic_sync,
)
from app.repository import ContactRepository
from app.routers.contacts import (
    request_contact_telemetry,
    request_path_discovery,
    request_trace,
    set_contact_remote_cli,
)
from app.routers.messages import send_direct_message
from app.routers.repeaters import send_repeater_command

MESHCOMOD_KEY = "4d455348434d" + "0" * 52
ALICE_KEY = "ab" * 32


async def _insert_contact(public_key, name, **overrides):
    data = {
        "public_key": public_key,
        "name": name,
        "type": 1,
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
    }
    data.update(overrides)
    await ContactRepository.upsert(data)


def _sent(payload):
    result = MagicMock()
    result.type = EventType.MSG_SENT
    result.payload = payload
    return result


def _make_mc():
    mc = MagicMock()
    mc.self_info = {"name": "TestNode"}
    mc.commands = MagicMock()
    mc.commands.add_contact = AsyncMock(return_value=_sent({}))
    mc.commands.reset_path = AsyncMock(return_value=MagicMock(type=EventType.OK, payload={}))
    mc.commands.set_flood_scope = AsyncMock(return_value=_sent({}))
    mc.commands.send = AsyncMock(return_value=_sent({}))
    # What meshcomod answers for its command contact: an ACK code and a 1 ms window.
    mc.commands.send_msg = AsyncMock(
        return_value=_sent({"expected_ack": b"\x00\x00\x00\x07", "suggested_timeout": 1})
    )
    mc.get_contact_by_key_prefix = MagicMock(return_value=None)
    return mc


def test_detection_matches_the_prefix_in_any_case():
    assert is_meshcomod_command_contact(MESHCOMOD_KEY)
    assert is_meshcomod_command_contact(MESHCOMOD_KEY.upper())
    assert is_meshcomod_command_contact("4d455348434d")
    assert not is_meshcomod_command_contact(ALICE_KEY)
    assert not is_meshcomod_command_contact(None)


@pytest.mark.asyncio
async def test_dm_to_meshcomod_contact_is_sent_once_without_loading_or_retrying(test_db):
    await _insert_contact(MESHCOMOD_KEY, "Meshcomod")
    mc = _make_mc()
    scheduled = []

    def schedule(coro):
        scheduled.append(coro)
        coro.close()

    with (
        patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", 3),
        patch("app.routers.messages.track_pending_ack", return_value=False),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch("app.routers.messages.broadcast_event"),
        patch("app.services.message_send.asyncio.create_task", side_effect=schedule),
    ):
        message = await send_direct_message(
            SendDirectMessageRequest(destination=MESHCOMOD_KEY, text="wifi status")
        )

    assert message.text == "wifi status"
    mc.commands.add_contact.assert_not_awaited()
    mc.commands.set_flood_scope.assert_not_awaited()
    mc.commands.reset_path.assert_not_awaited()
    assert mc.commands.send_msg.await_count == 1
    assert scheduled == []


@pytest.mark.asyncio
async def test_dm_to_a_normal_contact_still_loads_it_and_retries(test_db):
    await _insert_contact(ALICE_KEY, "Alice")
    mc = _make_mc()
    scheduled = []

    def schedule(coro):
        scheduled.append(coro)
        coro.close()

    with (
        patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", 3),
        patch("app.routers.messages.track_pending_ack", return_value=False),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch("app.routers.messages.broadcast_event"),
        patch("app.services.message_send.asyncio.create_task", side_effect=schedule),
    ):
        await send_direct_message(SendDirectMessageRequest(destination=ALICE_KEY, text="hi"))

    mc.commands.add_contact.assert_awaited_once()
    assert len(scheduled) == 1


def test_meshcomod_chat_is_never_fanned_out():
    scope = {"messages": "all"}
    assert not _scope_matches_message(
        scope, {"type": "PRIV", "conversation_key": MESHCOMOD_KEY, "txt_type": 0}
    )
    # Also when stored under the bare 6-byte prefix.
    assert not _scope_matches_message(
        scope, {"type": "PRIV", "conversation_key": "4d455348434d", "txt_type": 0}
    )
    assert _scope_matches_message(
        scope, {"type": "PRIV", "conversation_key": ALICE_KEY, "txt_type": 0}
    )


@pytest.mark.asyncio
async def test_meshcomod_replies_send_no_web_push():
    with patch(
        "app.push.manager.AppSettingsRepository.get_push_conversations", AsyncMock()
    ) as conv:
        await PushManager().dispatch_message(
            {"type": "PRIV", "conversation_key": MESHCOMOD_KEY, "txt_type": 0}
        )
    conv.assert_not_awaited()


@pytest.mark.asyncio
async def test_meshcomod_contact_is_never_selected_for_the_radio(test_db):
    await _insert_contact(MESHCOMOD_KEY, "Meshcomod")
    await ContactRepository.set_favorite(MESHCOMOD_KEY, True)
    await _insert_contact(ALICE_KEY, "Alice")
    await ContactRepository.set_favorite(ALICE_KEY, True)

    with patch(
        "app.radio_sync.AppSettingsRepository.get",
        new_callable=AsyncMock,
        return_value=MagicMock(max_radio_contacts=200, tracked_telemetry_repeaters=[]),
    ):
        residency = await get_radio_residency()

    keys = [contact.public_key for contact, _ in residency]
    assert ALICE_KEY in keys
    assert MESHCOMOD_KEY not in keys


@pytest.mark.asyncio
async def test_meshcomod_contact_does_not_count_against_radio_capacity():
    mc = MagicMock()
    payload = {f"{i:064x}": {} for i in range(9)}
    payload[MESHCOMOD_KEY] = {}
    mc.commands.get_contacts = AsyncMock(return_value=MagicMock(type=EventType.OK, payload=payload))

    with (
        patch(
            "app.radio_sync.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=MagicMock(max_radio_contacts=10),
        ),
        patch("app.radio_sync._effective_radio_capacity", return_value=10),
        patch("app.radio_sync._compute_radio_contact_limits", return_value=(8, 10)),
    ):
        assert await should_run_full_periodic_sync(mc) is False
        payload["ff" * 32] = {}
        assert await should_run_full_periodic_sync(mc) is True


@pytest.mark.asyncio
async def test_permissions_are_never_written_to_the_meshcomod_contact():
    mc = MagicMock()
    mc.commands.change_contact_flags = AsyncMock()
    app_contact = MagicMock(public_key=MESHCOMOD_KEY, telemetry_perms=0, remote_cli=True)
    with patch(
        "app.radio_sync.ContactRepository.get_with_app_permissions",
        new_callable=AsyncMock,
        return_value=[app_contact],
    ):
        await _reapply_app_contact_permissions(mc, {MESHCOMOD_KEY: {"flags": 0}})
    mc.commands.change_contact_flags.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call",
    [
        lambda: request_trace(MESHCOMOD_KEY),
        lambda: request_path_discovery(MESHCOMOD_KEY),
        lambda: request_contact_telemetry(MESHCOMOD_KEY),
        lambda: set_contact_remote_cli(MESHCOMOD_KEY, MagicMock(enabled=True)),
    ],
)
async def test_mesh_actions_on_the_meshcomod_contact_are_refused(test_db, call):
    await _insert_contact(MESHCOMOD_KEY, "Meshcomod")
    mc = _make_mc()
    with (
        patch("app.routers.contacts.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await call()
    assert exc_info.value.status_code == 409
    assert "command contact" in exc_info.value.detail
    mc.commands.add_contact.assert_not_awaited()


@pytest.mark.asyncio
async def test_remote_cli_console_refuses_the_meshcomod_contact(test_db):
    await _insert_contact(MESHCOMOD_KEY, "Meshcomod")
    with (
        patch("app.routers.repeaters.radio_manager.require_connected"),
        pytest.raises(HTTPException) as exc_info,
    ):
        await send_repeater_command(MESHCOMOD_KEY, MagicMock(command="ver"))
    assert exc_info.value.status_code == 409
