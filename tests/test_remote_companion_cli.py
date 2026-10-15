"""Commands to other companions (txt_type 3) and to sensors."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models import CONTACT_TYPE_CLIENT, CONTACT_TYPE_SENSOR, CommandRequest, Contact
from app.routers import server_control
from app.routers.repeaters import send_repeater_command

KEY = "cc" * 32


def test_labels():
    assert server_control.get_server_contact_label(Contact(public_key=KEY, type=1)) == "companion"
    assert server_control.get_server_contact_label(Contact(public_key=KEY, type=4)) == "sensor"


def test_destination_carries_chat_type_so_meshcore_sends_txt_type_3():
    # meshcore send_cmd picks TxtType.CLI_CMD (3) for dst type 1.
    assert server_control._cli_command_destination(Contact(public_key=KEY, type=1)) == {
        "public_key": KEY,
        "type": CONTACT_TYPE_CLIENT,
    }


@pytest.mark.asyncio
async def test_chat_contact_needs_cli_firmware():
    contact = Contact(public_key=KEY, type=CONTACT_TYPE_CLIENT)
    with (
        patch("app.routers.repeaters.radio_manager") as rm,
        patch("app.routers.repeaters._resolve_contact_or_404", AsyncMock(return_value=contact)),
        patch("app.routers.repeaters.radio_cli_supported", return_value=False),
    ):
        rm.require_connected = MagicMock()
        with pytest.raises(HTTPException) as exc:
            await send_repeater_command(KEY, CommandRequest(command="get name"))

    assert exc.value.status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("contact_type", [CONTACT_TYPE_CLIENT, CONTACT_TYPE_SENSOR])
async def test_chat_and_sensor_contacts_are_routed(contact_type):
    contact = Contact(public_key=KEY, type=contact_type)
    sent = AsyncMock(return_value=MagicMock(command="get name", response="> x"))
    with (
        patch("app.routers.repeaters.radio_manager") as rm,
        patch("app.routers.repeaters._resolve_contact_or_404", AsyncMock(return_value=contact)),
        patch("app.routers.repeaters.radio_cli_supported", return_value=True),
        patch("app.routers.repeaters.send_contact_cli_command", sent),
    ):
        rm.require_connected = MagicMock()
        await send_repeater_command(KEY, CommandRequest(command="get name"))

    sent.assert_awaited_once()


@pytest.mark.asyncio
async def test_unknown_type_still_rejected():
    contact = Contact(public_key=KEY, type=0)
    with (
        patch("app.routers.repeaters.radio_manager") as rm,
        patch("app.routers.repeaters._resolve_contact_or_404", AsyncMock(return_value=contact)),
    ):
        rm.require_connected = MagicMock()
        with pytest.raises(HTTPException) as exc:
            await send_repeater_command(KEY, CommandRequest(command="get name"))

    assert exc.value.status_code == 400


def test_no_reply_text_for_chat_contacts():
    assert "Remote CLI permission" in server_control.no_reply_text(
        Contact(public_key=KEY, type=CONTACT_TYPE_CLIENT)
    )
    assert server_control.no_reply_text(Contact(public_key=KEY, type=2)) == (
        "(no response - command may have been processed)"
    )
