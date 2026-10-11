import logging

from fastapi import APIRouter, HTTPException
from meshcore import EventType

from app.models import (
    CONTACT_TYPE_ROOM,
    AclEntry,
    DeviceConfigHistoryEntry,
    LppSensor,
    RepeaterAclResponse,
    RepeaterLoginResponse,
    RepeaterLppTelemetryResponse,
    RepeaterStatusResponse,
    RoomLoginRequest,
)
from app.radio_sync import _evict_removed_contact_from_library_cache, poll_for_messages
from app.repository.device_config_history import DeviceConfigHistoryRepository, DeviceConfigKind
from app.routers.contacts import (
    _ensure_on_radio,
    _record_and_forward_lpp_telemetry,
    _record_and_forward_status_telemetry,
    _resolve_contact_or_404,
)
from app.routers.repeaters import _record_config_snapshot
from app.routers.server_control import (
    prepare_authenticated_contact_connection,
    require_server_capable_contact,
)
from app.services.radio_runtime import radio_runtime as radio_manager
from app.services.room_status import room_status_fields
from app.services.route_timeout import contact_timeout_seconds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacts", tags=["rooms"])


def _require_room(contact) -> None:
    require_server_capable_contact(contact, allowed_types=(CONTACT_TYPE_ROOM,))


async def _reset_room_sync_cursor(mc, contact) -> None:
    """Make the next add of this room a fresh one, which zeroes its sync cursor.

    The companion radio keeps a per-room ``sync_since`` and puts it in every
    room login (``BaseChatMesh::sendLogin``); the room server then pushes only
    posts newer than it. The radio advances that cursor when it receives a
    post over RF, before this app has read it, so a post lost between radio
    and app (a full offline queue, a radio restart) is never sent again by a
    normal login. ``CMD_ADD_UPDATE_CONTACT`` leaves the cursor of a contact the
    radio already has alone, and sets it to 0 for one it does not have. So:
    remove the room here, and the login's own add starts from 0.

    Best-effort. A radio that does not have the room refuses the removal, and
    the add that follows is a fresh one anyway.
    """
    result = await mc.commands.remove_contact(contact.public_key)
    if result is not None and result.type == EventType.ERROR:
        logger.debug(
            "Room resync: removing %s from the radio returned %s",
            contact.public_key[:12],
            result.payload,
        )
    # The library does not drop a removed contact from its own cache.
    _evict_removed_contact_from_library_cache(mc, contact.public_key)


@router.post("/{public_key}/room/login", response_model=RepeaterLoginResponse)
async def room_login(public_key: str, request: RoomLoginRequest) -> RepeaterLoginResponse:
    """Attempt room-server login and report whether auth was confirmed.

    With ``resync_history`` the room is first removed from the radio, so the
    room server sends every post it still holds again (see
    ``_reset_room_sync_cursor``).
    """
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_room(contact)

    async with radio_manager.radio_operation(
        "room_login",
        pause_polling=True,
        suspend_auto_fetch=True,
    ) as mc:
        if request.resync_history:
            logger.info("Room resync: resetting the sync cursor of %s", contact.public_key[:12])
            await _reset_room_sync_cursor(mc, contact)
        login = await prepare_authenticated_contact_connection(
            mc,
            contact,
            request.password,
            label="room server",
        )
        if login.authenticated:
            # The room server pushes the posts since our last sync as soon as
            # it accepts the login. Auto-fetch is stopped while this operation
            # holds the radio and does not look at the queue when it starts
            # again, so ask for what arrived in the meantime. This talks to
            # our own radio only; nothing goes on air.
            await poll_for_messages(mc)
        return login


@router.post("/{public_key}/room/status", response_model=RepeaterStatusResponse)
async def room_status(public_key: str) -> RepeaterStatusResponse:
    """Fetch status telemetry from a room server."""
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_room(contact)

    async with radio_manager.radio_operation(
        "room_status", pause_polling=True, suspend_auto_fetch=True
    ) as mc:
        await _ensure_on_radio(mc, contact)
        status = await mc.commands.req_status_sync(
            contact.public_key,
            timeout=contact_timeout_seconds(contact, flood_timeout=10.0),
            min_timeout=5,
        )

    if status is None:
        raise HTTPException(status_code=422, detail="No status response from room server")

    response = RepeaterStatusResponse(
        battery_volts=status.get("bat", 0) / 1000.0,
        tx_queue_len=status.get("tx_queue_len", 0),
        noise_floor_dbm=status.get("noise_floor", 0),
        last_rssi_dbm=status.get("last_rssi", 0),
        last_snr_db=status.get("last_snr", 0.0),
        packets_received=status.get("nb_recv", 0),
        packets_sent=status.get("nb_sent", 0),
        airtime_seconds=status.get("airtime", 0),
        uptime_seconds=status.get("uptime", 0),
        sent_flood=status.get("sent_flood", 0),
        sent_direct=status.get("sent_direct", 0),
        recv_flood=status.get("recv_flood", 0),
        recv_direct=status.get("recv_direct", 0),
        flood_dups=status.get("flood_dups", 0),
        direct_dups=status.get("direct_dups", 0),
        full_events=status.get("full_evts", 0),
        recv_errors=status.get("recv_errors"),
        **room_status_fields(contact.type, status),
    )

    # Persist + forward the received telemetry (telemetry only; no messages).
    await _record_and_forward_status_telemetry(contact, response)

    return response


@router.post("/{public_key}/room/lpp-telemetry", response_model=RepeaterLppTelemetryResponse)
async def room_lpp_telemetry(public_key: str) -> RepeaterLppTelemetryResponse:
    """Fetch CayenneLPP telemetry from a room server."""
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_room(contact)

    async with radio_manager.radio_operation(
        "room_lpp_telemetry", pause_polling=True, suspend_auto_fetch=True
    ) as mc:
        await _ensure_on_radio(mc, contact)
        telemetry = await mc.commands.req_telemetry_sync(
            contact.public_key,
            timeout=contact_timeout_seconds(contact, flood_timeout=10.0),
            min_timeout=5,
        )

    if telemetry is None:
        raise HTTPException(status_code=422, detail="No telemetry response from room server")

    sensors = [
        LppSensor(
            channel=entry.get("channel", 0),
            type_name=str(entry.get("type", "unknown")),
            value=entry.get("value", 0),
        )
        for entry in telemetry
    ]

    # Persist + forward the received telemetry (telemetry only; no messages).
    await _record_and_forward_lpp_telemetry(contact, sensors)

    return RepeaterLppTelemetryResponse(sensors=sensors)


@router.post("/{public_key}/room/acl", response_model=RepeaterAclResponse)
async def room_acl(public_key: str) -> RepeaterAclResponse:
    """Fetch ACL entries from a room server."""
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_room(contact)

    async with radio_manager.radio_operation(
        "room_acl", pause_polling=True, suspend_auto_fetch=True
    ) as mc:
        await _ensure_on_radio(mc, contact)
        acl_data = await mc.commands.req_acl_sync(
            contact.public_key,
            timeout=contact_timeout_seconds(contact, flood_timeout=10.0),
            min_timeout=5,
        )

    acl_entries = []
    if acl_data and isinstance(acl_data, list):
        from app.repository import ContactRepository
        from app.routers.repeaters import ACL_PERMISSION_NAMES

        for entry in acl_data:
            pubkey_prefix = entry.get("key", "")
            perm = entry.get("perm", 0)
            resolved_contact = await ContactRepository.get_by_key_prefix(pubkey_prefix)
            acl_entries.append(
                AclEntry(
                    pubkey_prefix=pubkey_prefix,
                    name=resolved_contact.name if resolved_contact else None,
                    permission=perm,
                    permission_name=ACL_PERMISSION_NAMES.get(perm, f"Unknown({perm})"),
                )
            )

    # Plan 14: store who has which permission. Resolved names and the order the
    # room lists them in are left out, so only a real ACL change is a new
    # snapshot. An empty list means no answer (timeout), not "everyone removed".
    if acl_entries:
        await _record_config_snapshot(
            contact,
            "acl",
            {
                "acl": [
                    {"pubkey_prefix": e.pubkey_prefix, "permission": e.permission}
                    for e in sorted(acl_entries, key=lambda e: e.pubkey_prefix)
                ]
            },
        )

    return RepeaterAclResponse(acl=acl_entries)


@router.get("/{public_key}/room/config-history", response_model=list[DeviceConfigHistoryEntry])
async def room_config_history(
    public_key: str, kind: DeviceConfigKind | None = None
) -> list[DeviceConfigHistoryEntry]:
    """Stored pane snapshots for a room server, newest first (plan 14; read-only)."""
    contact = await _resolve_contact_or_404(public_key)
    _require_room(contact)
    rows = await DeviceConfigHistoryRepository.get_history(contact.public_key, kind)
    return [DeviceConfigHistoryEntry(**row) for row in rows]
