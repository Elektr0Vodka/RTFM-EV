"""Companion commands the bridge carries out for a connected app (issue #388).

RTFM-EV stays the only program that talks to the radio. Each command here is
checked, then carried out by RTFM-EV itself:

- Commands that change what RTFM-EV knows (contacts, channels, radio settings,
  own name and position, private key import, advert, reboot, the radio's own
  command line) call the same RTFM-EV functions the web UI uses, so RTFM-EV's
  database and state follow the change.
- Commands that only the radio answers (requests to other nodes, statistics,
  tuning, custom vars, signing, raw packets) are sent over RTFM-EV's own
  meshcore connection while RTFM-EV's radio lock is held, and the radio's answer
  frame is handed back to the app unchanged.

Frame layouts follow ``handleCmdFrame`` in meshcore-dev/MeshCore
``examples/companion_radio/MyMesh.cpp``.

With ``MESHCORE_COMPANION_BRIDGE_ALLOW_SEND=false`` every command that changes
or transmits anything is refused with ERR_CODE_UNSUPPORTED_CMD, and so are the
commands that use the radio's private key (export and signing).
"""

import logging
import struct
from collections.abc import Awaitable, Callable

from fastapi import HTTPException
from meshcore import EventType
from pydantic import ValidationError

from app.companion_bridge import frames

logger = logging.getLogger(__name__)

# How much data one CMD_SIGN_DATA frame to the radio carries.
_SIGN_CHUNK = frames.MAX_FRAME_SIZE - 1
# RTFM-EV loads contacts onto the radio with the overwrite-oldest bit
# (radio_sync._enable_autoevict_on_radio); an app may not clear it then.
_AUTO_ADD_OVERWRITE_OLDEST = 0x01

READ = "read"
CHANGE = "change"

Handler = Callable[[object, object, bytes], Awaitable[None]]


async def handle(bridge, session, frame: bytes) -> bool:
    """Carry out ``frame`` if it is one of the extended commands; False when it is not."""
    entry = _HANDLERS.get(frame[0])
    if entry is None:
        return False
    fn, kind = entry
    if kind == CHANGE and not bridge.allow_send:
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return True
    try:
        await fn(bridge, session, frame)
    except HTTPException as exc:
        await bridge.write(session, frames.err(error_code(exc)))
    except (ValidationError, ValueError):
        await bridge.write(session, frames.err(frames.ERR_CODE_ILLEGAL_ARG))
    return True


def error_code(exc: HTTPException) -> int:
    if exc.status_code in (400, 422):
        return frames.ERR_CODE_ILLEGAL_ARG
    if exc.status_code == 404:
        return frames.ERR_CODE_NOT_FOUND
    if exc.status_code in (403, 409, 423, 503):
        return frames.ERR_CODE_BAD_STATE
    return frames.ERR_CODE_TABLE_FULL


# ── helpers ────────────────────────────────────────────────────────────────


def _key_at(frame: bytes, offset: int) -> str | None:
    raw = frame[offset : offset + frames.PUB_KEY_SIZE]
    return raw.hex() if len(raw) == frames.PUB_KEY_SIZE else None


async def _contact(key: str | None):
    if key is None:
        return None
    from app.repository import ContactRepository

    return await ContactRepository.get_by_key(key)


async def _illegal(bridge, session) -> None:
    await bridge.write(session, frames.err(frames.ERR_CODE_ILLEGAL_ARG))


async def _not_found(bridge, session) -> None:
    await bridge.write(session, frames.err(frames.ERR_CODE_NOT_FOUND))


async def _ok(bridge, session) -> None:
    await bridge.write(session, frames.ok())


def _relay(
    cmd_len: int | None,
    expect: set[int],
    *,
    min_len: int = 1,
) -> Handler:
    """A command only the radio answers: forward it (cut to ``cmd_len``), return its reply."""

    async def run(bridge, session, frame: bytes) -> None:
        if len(frame) < min_len:
            await _illegal(bridge, session)
            return
        body = frame if cmd_len is None else frame[:cmd_len]
        await bridge.radio_call(session, f"cmd_{frame[0]}", body, expect)

    return run


def _request(expect_push: set[int], *, key_offset: int = 1, min_len: int) -> Handler:
    """A request to another node: the contact goes onto the radio, the answer is a push."""

    async def run(bridge, session, frame: bytes) -> None:
        if len(frame) < min_len:
            await _illegal(bridge, session)
            return
        contact = await _contact(_key_at(frame, key_offset))
        if contact is None:
            await _not_found(bridge, session)
            return
        await bridge.radio_call(
            session,
            f"request_{frame[0]}",
            frame,
            {frames.RESP_CODE_SENT},
            hold=expect_push,
            scoped=True,
            contact=contact,
        )

    return run


async def _update_radio_config(**fields) -> None:
    from app.routers.radio import RadioConfigUpdate, update_radio_config

    await update_radio_config(RadioConfigUpdate(**fields))


# ── reads ──────────────────────────────────────────────────────────────────


async def _export_contact(bridge, session, frame: bytes) -> None:
    if len(frame) < 1 + frames.PUB_KEY_SIZE:
        # Own card: the radio builds and signs its own advert; nothing is sent.
        await bridge.radio_call(
            session, "export_self", bytes([frame[0]]), {frames.RESP_CODE_EXPORT_CONTACT}
        )
        return
    contact = await _contact(_key_at(frame, 1))
    if contact is None:
        await _not_found(bridge, session)
        return
    await bridge.radio_call(
        session,
        "export_contact",
        frame[: 1 + frames.PUB_KEY_SIZE],
        {frames.RESP_CODE_EXPORT_CONTACT},
        contact=contact,
    )


async def _get_contact_by_key(bridge, session, frame: bytes) -> None:
    contact = await _contact(_key_at(frame, 1))
    if contact is None:
        await _not_found(bridge, session)
        return
    await bridge.write(session, bridge.contact_frame(contact))


async def _telemetry(bridge, session, frame: bytes) -> None:
    if len(frame) == 4:
        # The radio's own sensors; the answer is a TELEMETRY_RESPONSE push,
        # which reaches every app through the push forwarding.
        reply = await bridge.radio_call(
            session,
            "self_telemetry",
            frame,
            {frames.PUSH_CODE_TELEMETRY_RESPONSE},
            write=False,
        )
        if reply is not None and reply[0] != frames.PUSH_CODE_TELEMETRY_RESPONSE:
            await bridge.write(session, reply)
        return
    if not bridge.allow_send:
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return
    await _request(
        {frames.PUSH_CODE_TELEMETRY_RESPONSE},
        key_offset=4,
        min_len=4 + frames.PUB_KEY_SIZE,
    )(bridge, session, frame)


async def _set_flood_scope_key(bridge, session, frame: bytes) -> None:
    """Kept for this app only and applied around its own requests (RTFM-EV owns the radio's)."""
    if len(frame) < 2 or frame[1] not in (0, 1):
        await _illegal(bridge, session)
        return
    if frame[1] == 1:
        session.scope_frame = frame[:2]
    elif len(frame) >= 2 + 16:
        session.scope_frame = frame[:18]
    else:
        session.scope_frame = None
    await _ok(bridge, session)


# ── signing (uses the private key) ─────────────────────────────────────────


async def _sign_start(bridge, session, frame: bytes) -> None:
    session.sign_buf = bytearray()
    await bridge.write(session, frames.sign_start())


async def _sign_data(bridge, session, frame: bytes) -> None:
    if session.sign_buf is None:
        await bridge.write(session, frames.err(frames.ERR_CODE_BAD_STATE))
        return
    data = frame[1:]
    if not data:
        await _illegal(bridge, session)
        return
    if len(session.sign_buf) + len(data) > frames.MAX_SIGN_DATA_LEN:
        await bridge.write(session, frames.err(frames.ERR_CODE_TABLE_FULL))
        return
    session.sign_buf.extend(data)
    await _ok(bridge, session)


async def _sign_finish(bridge, session, frame: bytes) -> None:
    data = session.sign_buf
    session.sign_buf = None
    if data is None:
        await bridge.write(session, frames.err(frames.ERR_CODE_BAD_STATE))
        return
    # The radio keeps one signing buffer, so the whole run happens under one lock.
    async with bridge.radio_session("sign") as mc:
        reply = await bridge.exchange(
            mc, bytes([frames.CMD_SIGN_START]), {frames.RESP_CODE_SIGN_START}
        )
        for start in range(0, len(data), _SIGN_CHUNK):
            if reply is None or reply[0] == frames.RESP_CODE_ERR:
                break
            chunk = bytes(data[start : start + _SIGN_CHUNK])
            reply = await bridge.exchange(
                mc, bytes([frames.CMD_SIGN_DATA]) + chunk, {frames.RESP_CODE_OK}
            )
        if reply is not None and reply[0] != frames.RESP_CODE_ERR:
            reply = await bridge.exchange(
                mc, bytes([frames.CMD_SIGN_FINISH]), {frames.RESP_CODE_SIGNATURE}
            )
    await bridge.write(session, reply or frames.err(frames.ERR_CODE_BAD_STATE))


async def _export_private_key(bridge, session, frame: bytes) -> None:
    from app.config import settings

    if not settings.enable_local_private_key_export:
        # Same switch as GET /api/radio/private-key.
        await bridge.write(session, frames.disabled())
        return
    await bridge.radio_call(
        session, "export_private_key", frame[:1], {frames.RESP_CODE_PRIVATE_KEY}
    )


# ── adverts, own settings ──────────────────────────────────────────────────


async def _self_advert(bridge, session, frame: bytes) -> None:
    from app.routers.radio import RadioAdvertiseRequest, send_advertisement

    mode = "flood" if len(frame) >= 2 and frame[1] == 1 else "zero_hop"
    await send_advertisement(RadioAdvertiseRequest(mode=mode))
    await _ok(bridge, session)


async def _set_name(bridge, session, frame: bytes) -> None:
    name = frame[1:].split(b"\0", 1)[0].decode("utf-8", "replace").strip()
    if not name:
        await _illegal(bridge, session)
        return
    await _update_radio_config(name=name)
    await _ok(bridge, session)


async def _set_latlon(bridge, session, frame: bytes) -> None:
    if len(frame) < 9:
        await _illegal(bridge, session)
        return
    lat, lon = struct.unpack_from("<ii", frame, 1)
    if not (-90_000_000 <= lat <= 90_000_000 and -180_000_000 <= lon <= 180_000_000):
        await _illegal(bridge, session)
        return
    await _update_radio_config(lat=lat / 1e6, lon=lon / 1e6)
    await _ok(bridge, session)


async def _set_radio_params(bridge, session, frame: bytes) -> None:
    from app.routers.radio import RadioSettings
    from app.services.radio_runtime import radio_runtime as radio_manager

    if len(frame) < 11:
        await _illegal(bridge, session)
        return
    freq_khz, bw_hz = struct.unpack_from("<II", frame, 1)
    sf, cr = frame[9], frame[10]
    if len(frame) > 11:
        # RTFM-EV never switches client repeat itself (see RadioConfigResponse);
        # an app may only send the value the radio already has.
        wanted = frame[11] != 0
        if wanted != bool(getattr(radio_manager, "client_repeat", None)):
            await _illegal(bridge, session)
            return
    await _update_radio_config(
        radio=RadioSettings(freq=freq_khz / 1000.0, bw=bw_hz / 1000.0, sf=sf, cr=cr)
    )
    await _ok(bridge, session)


async def _set_tx_power(bridge, session, frame: bytes) -> None:
    if len(frame) < 2:
        await _illegal(bridge, session)
        return
    await _update_radio_config(tx_power=struct.unpack_from("<b", frame, 1)[0])
    await _ok(bridge, session)


async def _set_path_hash_mode(bridge, session, frame: bytes) -> None:
    if len(frame) < 3 or frame[1] != 0:
        await _illegal(bridge, session)
        return
    await _update_radio_config(path_hash_mode=frame[2])
    await _ok(bridge, session)


async def _set_other_params(bridge, session, frame: bytes) -> None:
    from app.services.radio_runtime import radio_runtime as radio_manager

    if len(frame) < 2:
        await _illegal(bridge, session)
        return
    fields: dict = {}
    if len(frame) >= 3:
        fields["telemetry_mode_base"] = frame[2] & 0b11
        fields["telemetry_mode_loc"] = (frame[2] >> 2) & 0b11
        fields["telemetry_mode_env"] = (frame[2] >> 4) & 0b11
    if len(frame) >= 4:
        fields["advert_location_source"] = "off" if frame[3] == 0 else "current"
    if len(frame) >= 5:
        fields["multi_acks_enabled"] = frame[4] != 0
    if fields:
        await _update_radio_config(**fields)
    manual = frame[1] != 0
    info = bridge.self_info() or {}
    if manual != bool(info.get("manual_add_contacts")):
        async with radio_manager.radio_operation("companion_bridge_manual_add") as mc:
            result = await mc.commands.set_manual_add_contacts(manual)
        if result is None or result.type == EventType.ERROR:
            await _illegal(bridge, session)
            return
    await _ok(bridge, session)


async def _set_autoadd_config(bridge, session, frame: bytes) -> None:
    from app.config import settings

    if len(frame) < 2:
        await _illegal(bridge, session)
        return
    config = frame[1]
    if settings.load_with_autoevict:
        config |= _AUTO_ADD_OVERWRITE_OLDEST
    body = bytes([frame[0], config]) + frame[2:3]
    await bridge.radio_call(session, "set_autoadd", body, {frames.RESP_CODE_OK})


async def _import_private_key(bridge, session, frame: bytes) -> None:
    from app.routers.radio import PrivateKeyUpdate, set_private_key

    if len(frame) < 65:
        await _illegal(bridge, session)
        return
    await set_private_key(PrivateKeyUpdate(private_key=frame[1:65].hex()))
    await _ok(bridge, session)


async def _reboot(bridge, session, frame: bytes) -> None:
    from app.routers.radio import reboot_radio

    if frame[1:7] != b"reboot":
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return
    # Like the firmware: no answer, the link drops while the radio restarts.
    await reboot_radio()


async def _factory_reset(bridge, session, frame: bytes) -> None:
    if frame[1:6] != b"reset":
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return
    logger.warning("Companion bridge: %s asked for a factory reset of the radio", session.address)
    await bridge.radio_call(session, "factory_reset", frame[:6], {frames.RESP_CODE_OK})


async def _run_cli(bridge, session, frame: bytes) -> None:
    from app.routers.radio import RadioCliRequest, run_radio_cli

    command = frame[1:].split(b"\0", 1)[0].decode("utf-8", "replace")
    response = await run_radio_cli(RadioCliRequest(command=command))
    await bridge.write(session, frames.cli_reply(response.reply))


# ── contacts ───────────────────────────────────────────────────────────────


async def _add_update_contact(bridge, session, frame: bytes) -> None:
    from app.models import ContactUpsert
    from app.repository import ContactRepository
    from app.routers.contacts import (
        _best_effort_push_contact_to_radio,
        _broadcast_contact_update,
    )

    fields = frames.parse_contact_frame(frame)
    key = fields["public_key"]
    changes: dict = {
        "type": fields["type"],
        "flags": fields["flags"],
        "last_advert": fields["last_advert"] or None,
    }
    if fields["name"]:
        changes["name"] = fields["name"]
    if fields["lat"] is not None and (fields["lat"] or fields["lon"]):
        changes["lat"] = fields["lat"]
        changes["lon"] = fields["lon"]
    if fields["path_hops"] is None:
        changes.update(direct_path="", direct_path_len=-1, direct_path_hash_mode=-1)
    else:
        changes.update(
            direct_path=fields["path_hex"],
            direct_path_len=fields["path_hops"],
            direct_path_hash_mode=fields["path_hash_mode"],
        )
    existing = await ContactRepository.get_by_key(key)
    if existing is not None:
        upsert = ContactUpsert.from_contact(existing, **changes)
    else:
        upsert = ContactUpsert(public_key=key, on_radio=False, **changes)
    await ContactRepository.upsert(upsert)
    stored = await ContactRepository.get_by_key(key)
    if stored is None:
        await bridge.write(session, frames.err(frames.ERR_CODE_TABLE_FULL))
        return
    await _broadcast_contact_update(stored)
    await _best_effort_push_contact_to_radio(stored, "companion_bridge_add_contact")
    await _ok(bridge, session)


async def _remove_contact(bridge, session, frame: bytes) -> None:
    from app.routers.contacts import delete_contact

    contact = await _contact(_key_at(frame, 1))
    if contact is None:
        await _not_found(bridge, session)
        return
    # RTFM-EV's own delete: database and radio; its broadcast sends CONTACT_DELETED.
    await delete_contact(contact.public_key)
    await _ok(bridge, session)


async def _reset_path(bridge, session, frame: bytes) -> None:
    from app.models import ContactUpsert
    from app.repository import ContactRepository
    from app.routers.contacts import _broadcast_contact_update

    contact = await _contact(_key_at(frame, 1))
    if contact is None:
        await _not_found(bridge, session)
        return
    await ContactRepository.upsert(
        ContactUpsert.from_contact(
            contact, direct_path="", direct_path_len=-1, direct_path_hash_mode=-1
        )
    )
    stored = await ContactRepository.get_by_key(contact.public_key) or contact
    await _broadcast_contact_update(stored)
    await bridge.radio_call(
        session,
        "reset_path",
        frame[: 1 + frames.PUB_KEY_SIZE],
        {frames.RESP_CODE_OK},
        contact=stored,
    )


async def _share_contact(bridge, session, frame: bytes) -> None:
    contact = await _contact(_key_at(frame, 1))
    if contact is None:
        await _not_found(bridge, session)
        return
    await bridge.radio_call(
        session,
        "share_contact",
        frame[: 1 + frames.PUB_KEY_SIZE],
        {frames.RESP_CODE_OK},
        contact=contact,
    )


async def _import_contact(bridge, session, frame: bytes) -> None:
    from app.contact_uri import format_contact_uri
    from app.models import ContactUriImportRequest
    from app.routers.contacts import import_contact_uri

    if len(frame) <= 2 + 32 + 64:
        await _illegal(bridge, session)
        return
    await import_contact_uri(ContactUriImportRequest(uri=format_contact_uri(frame[1:])))
    await _ok(bridge, session)


async def _anon_request(bridge, session, frame: bytes) -> None:
    if len(frame) <= 1 + frames.PUB_KEY_SIZE:
        await _illegal(bridge, session)
        return
    # The firmware (ver 13+) also accepts a node that is not a contact.
    contact = await _contact(_key_at(frame, 1))
    await bridge.radio_call(
        session,
        "anon_request",
        frame,
        {frames.RESP_CODE_SENT},
        hold={frames.PUSH_CODE_BINARY_RESPONSE},
        scoped=True,
        contact=contact,
    )


async def _path_discovery(bridge, session, frame: bytes) -> None:
    if len(frame) < 2 + frames.PUB_KEY_SIZE or frame[1] != 0:
        await _illegal(bridge, session)
        return
    await _request(
        {frames.PUSH_CODE_PATH_DISCOVERY_RESPONSE}, key_offset=2, min_len=2 + frames.PUB_KEY_SIZE
    )(bridge, session, frame[: 2 + frames.PUB_KEY_SIZE])


async def remote_cli(bridge, session, frame: bytes) -> None:
    """CMD_SEND_TXT_MSG with TXT_TYPE_CLI_DATA: a command line for a repeater or room."""
    from app.repository import ContactRepository
    from app.routers.contacts import _ensure_on_radio
    from app.routers.server_control import extract_response_text, fetch_contact_cli_response

    prefix = frame[7:13].hex()
    contact = await ContactRepository.get_by_key_prefix(prefix)
    if contact is None or len(contact.public_key) < 64:
        await _not_found(bridge, session)
        return
    async with bridge.radio_session("remote_cli", pause_polling=True) as mc:
        await _ensure_on_radio(mc, contact)
        restore = await bridge.apply_session_scope(mc, session)
        try:
            reply = await bridge.exchange(mc, frame, {frames.RESP_CODE_SENT})
        finally:
            if restore:
                await bridge.restore_scope(mc)
        await bridge.write(session, reply or frames.err(frames.ERR_CODE_BAD_STATE))
        if reply is None or reply[0] != frames.RESP_CODE_SENT:
            return
        event = await fetch_contact_cli_response(
            mc, contact.public_key[:12], timeout=bridge.push_wait_seconds(reply)
        )
    if event is None:
        return
    payload = event.payload if isinstance(event.payload, dict) else {}
    bridge.queue_message(
        session,
        frames.contact_message(
            v3=session.app_ver >= 3,
            snr=payload.get("SNR") if isinstance(payload.get("SNR"), int | float) else None,
            pubkey_prefix=bytes.fromhex(contact.public_key[:12]),
            path_len=int(payload.get("path_len", frames.PATH_LEN_NONE)) & 0xFF,
            txt_type=frames.TXT_TYPE_CLI_DATA,
            sender_timestamp=int(payload.get("sender_timestamp") or 0),
            text=extract_response_text(event),
        ),
    )


# ── channels ───────────────────────────────────────────────────────────────


async def _set_channel(bridge, session, frame: bytes) -> None:
    from app.routers.channels import (
        CreateChannelRequest,
        _derive_channel_identity,
        create_channel,
        delete_channel,
    )

    if len(frame) >= 2 + 32 + 32:
        # 256-bit secrets: not supported by the firmware either.
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return
    if len(frame) < 2 + 32 + 16:
        await _illegal(bridge, session)
        return
    slot = frame[1]
    if slot >= bridge.max_channels:
        await _not_found(bridge, session)
        return
    name = frame[2:34].split(b"\0", 1)[0].decode("utf-8", "replace").strip()
    secret = frame[34:50]
    old = session.channel_by_slot.get(slot)
    old_key = str(getattr(old, "key", "")).upper() if old is not None else None
    if not any(secret):
        if old_key is not None:
            await delete_channel(old_key)
            bridge.clear_slot(session, slot)
        await _ok(bridge, session)
        return
    key_hex = secret.hex().upper()
    if name.startswith("#") and _derive_channel_identity(name, None)[0].upper() != key_hex:
        # RTFM-EV derives a #channel's key from its name and cannot keep another key.
        await _illegal(bridge, session)
        return
    if old_key is not None and old_key != key_hex:
        await delete_channel(old_key)
        bridge.clear_slot(session, slot)
    stored = await create_channel(CreateChannelRequest(name=name or key_hex[:8], key=key_hex))
    bridge.set_slot(session, slot, stored)
    await _ok(bridge, session)


async def _send_channel_data(bridge, session, frame: bytes) -> None:
    from app.services.message_send import send_channel_data_to_channel
    from app.services.radio_runtime import radio_runtime as radio_manager
    from app.websocket import broadcast_error

    if len(frame) < 5:
        await _illegal(bridge, session)
        return
    slot, path_len = frame[1], frame[2]
    if path_len != frames.PATH_LEN_NONE:
        # RTFM-EV sends channel data as flood only.
        await bridge.write(session, frames.err(frames.ERR_CODE_UNSUPPORTED_CMD))
        return
    channel = session.channel_by_slot.get(slot)
    if channel is None:
        await _not_found(bridge, session)
        return
    data_type = struct.unpack_from("<H", frame, 3)[0]
    key = str(getattr(channel, "key", ""))
    await send_channel_data_to_channel(
        channel=channel,
        channel_key_upper=key.upper(),
        key_bytes=bytes.fromhex(key),
        data_type=data_type,
        payload=frame[5:],
        radio_manager=radio_manager,
        error_broadcast_fn=broadcast_error,
        temp_radio_slot=0,
    )
    await _ok(bridge, session)


_HANDLERS: dict[int, tuple[Handler, str]] = {
    # Reads: nothing changes, nothing is transmitted.
    frames.CMD_EXPORT_CONTACT: (_export_contact, READ),
    frames.CMD_HAS_CONNECTION: (
        _relay(1 + frames.PUB_KEY_SIZE, {frames.RESP_CODE_OK}, min_len=1 + frames.PUB_KEY_SIZE),
        READ,
    ),
    frames.CMD_GET_CONTACT_BY_KEY: (_get_contact_by_key, READ),
    frames.CMD_GET_CUSTOM_VARS: (_relay(1, {frames.RESP_CODE_CUSTOM_VARS}), READ),
    frames.CMD_GET_ADVERT_PATH: (
        _relay(
            2 + frames.PUB_KEY_SIZE,
            {frames.RESP_CODE_ADVERT_PATH},
            min_len=2 + frames.PUB_KEY_SIZE,
        ),
        READ,
    ),
    frames.CMD_GET_TUNING_PARAMS: (_relay(1, {frames.RESP_CODE_TUNING_PARAMS}), READ),
    frames.CMD_GET_STATS: (_relay(2, {frames.RESP_CODE_STATS}, min_len=2), READ),
    frames.CMD_GET_AUTOADD_CONFIG: (_relay(1, {frames.RESP_CODE_AUTOADD_CONFIG}), READ),
    frames.CMD_GET_ALLOWED_REPEAT_FREQ: (_relay(1, {frames.RESP_CODE_ALLOWED_REPEAT_FREQ}), READ),
    frames.CMD_GET_DEFAULT_FLOOD_SCOPE: (_relay(1, {frames.RESP_CODE_DEFAULT_FLOOD_SCOPE}), READ),
    frames.CMD_SEND_TELEMETRY_REQ: (_telemetry, READ),  # remote requests are checked inside
    frames.CMD_SET_FLOOD_SCOPE_KEY: (_set_flood_scope_key, READ),  # this app's state only
    # The private key: refused in read-only mode as well.
    frames.CMD_SIGN_START: (_sign_start, CHANGE),
    frames.CMD_SIGN_DATA: (_sign_data, CHANGE),
    frames.CMD_SIGN_FINISH: (_sign_finish, CHANGE),
    frames.CMD_EXPORT_PRIVATE_KEY: (_export_private_key, CHANGE),
    # Transmits.
    frames.CMD_SEND_SELF_ADVERT: (_self_advert, CHANGE),
    frames.CMD_SEND_LOGIN: (
        _request(
            {frames.PUSH_CODE_LOGIN_SUCCESS, frames.PUSH_CODE_LOGIN_FAIL},
            min_len=1 + frames.PUB_KEY_SIZE,
        ),
        CHANGE,
    ),
    frames.CMD_LOGOUT: (
        _relay(1 + frames.PUB_KEY_SIZE, {frames.RESP_CODE_OK}, min_len=1 + frames.PUB_KEY_SIZE),
        CHANGE,
    ),
    frames.CMD_SEND_STATUS_REQ: (
        _request({frames.PUSH_CODE_STATUS_RESPONSE}, min_len=1 + frames.PUB_KEY_SIZE),
        CHANGE,
    ),
    frames.CMD_SEND_BINARY_REQ: (
        _request({frames.PUSH_CODE_BINARY_RESPONSE}, min_len=2 + frames.PUB_KEY_SIZE),
        CHANGE,
    ),
    frames.CMD_SEND_ANON_REQ: (_anon_request, CHANGE),
    frames.CMD_SEND_PATH_DISCOVERY_REQ: (_path_discovery, CHANGE),
    frames.CMD_SEND_TRACE_PATH: (_relay(None, {frames.RESP_CODE_SENT}, min_len=11), CHANGE),
    frames.CMD_SHARE_CONTACT: (_share_contact, CHANGE),
    frames.CMD_SEND_CONTROL_DATA: (_relay(None, {frames.RESP_CODE_OK}, min_len=2), CHANGE),
    frames.CMD_SEND_RAW_DATA: (_relay(None, {frames.RESP_CODE_OK}, min_len=6), CHANGE),
    frames.CMD_SEND_RAW_PACKET: (_relay(None, {frames.RESP_CODE_OK}, min_len=4), CHANGE),
    frames.CMD_SEND_CHANNEL_DATA: (_send_channel_data, CHANGE),
    # Changes RTFM-EV's lists.
    frames.CMD_ADD_UPDATE_CONTACT: (_add_update_contact, CHANGE),
    frames.CMD_REMOVE_CONTACT: (_remove_contact, CHANGE),
    frames.CMD_RESET_PATH: (_reset_path, CHANGE),
    frames.CMD_IMPORT_CONTACT: (_import_contact, CHANGE),
    frames.CMD_SET_CHANNEL: (_set_channel, CHANGE),
    # Changes the radio.
    frames.CMD_SET_ADVERT_NAME: (_set_name, CHANGE),
    frames.CMD_SET_ADVERT_LATLON: (_set_latlon, CHANGE),
    frames.CMD_SET_RADIO_PARAMS: (_set_radio_params, CHANGE),
    frames.CMD_SET_RADIO_TX_POWER: (_set_tx_power, CHANGE),
    frames.CMD_SET_PATH_HASH_MODE: (_set_path_hash_mode, CHANGE),
    frames.CMD_SET_OTHER_PARAMS: (_set_other_params, CHANGE),
    frames.CMD_SET_AUTOADD_CONFIG: (_set_autoadd_config, CHANGE),
    frames.CMD_SET_TUNING_PARAMS: (_relay(9, {frames.RESP_CODE_OK}, min_len=9), CHANGE),
    frames.CMD_SET_CUSTOM_VAR: (_relay(None, {frames.RESP_CODE_OK}, min_len=4), CHANGE),
    frames.CMD_SET_DEFAULT_FLOOD_SCOPE: (_relay(None, {frames.RESP_CODE_OK}), CHANGE),
    frames.CMD_RUN_CLI_COMMAND: (_run_cli, CHANGE),
    frames.CMD_IMPORT_PRIVATE_KEY: (_import_private_key, CHANGE),
    frames.CMD_REBOOT: (_reboot, CHANGE),
    frames.CMD_FACTORY_RESET: (_factory_reset, CHANGE),
}
