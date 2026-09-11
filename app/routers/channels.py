import logging
from datetime import UTC, datetime
from hashlib import sha256
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.channel_constants import (
    PUBLIC_CHANNEL_KEY,
    PUBLIC_CHANNEL_NAME,
    is_public_channel_key,
    is_public_channel_name,
)
from app.decoder import parse_packet, try_decrypt_packet_with_channel_key
from app.models import Channel, ChannelDetail, ChannelMessageCounts, ChannelTopSender
from app.packet_processor import create_message_from_decrypted
from app.region_scope import UNSCOPED_OVERRIDE_MARKER, is_unscoped, normalize_region_scope
from app.repository import ChannelRepository, MessageRepository, RawPacketRepository
from app.websocket import broadcast_event, broadcast_success

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/channels", tags=["channels"])


def _broadcast_channel_update(channel: Channel) -> None:
    broadcast_event("channel", channel.model_dump())


class CreateChannelRequest(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    key: str | None = Field(
        default=None,
        description="Channel key as hex string (32 chars = 16 bytes). If omitted or name starts with #, key is derived from name hash.",
    )


class BulkCreateHashtagChannelsRequest(BaseModel):
    channel_names: list[str] = Field(
        min_length=1,
        description="List of hashtag room names. Leading # is optional per entry.",
    )
    try_historical: bool = Field(
        default=False,
        description="Attempt one background historical decrypt sweep for the newly added rooms.",
    )


class BulkCreateHashtagChannelsResponse(BaseModel):
    created_channels: list[Channel]
    existing_count: int
    invalid_names: list[str]
    decrypt_started: bool = False
    decrypt_total_packets: int = 0
    message: str


class BulkDeleteChannelsRequest(BaseModel):
    keys: list[str] = Field(description="Channel keys (hex) to delete")


class ChannelFloodScopeOverrideRequest(BaseModel):
    flood_scope_override: str = Field(
        description=(
            "Tri-state channel override. Blank clears the override (inherit the global "
            "scope); '*' forces unscoped/plain flood even when a global region is set; "
            "any other value scopes the channel to that region. Note the deliberate "
            "asymmetry vs. the send layer: here blank means 'inherit', so an explicit "
            "unscoped request must use '*'."
        )
    )


class ChannelPathHashModeOverrideRequest(BaseModel):
    path_hash_mode_override: int | None = Field(
        default=None,
        ge=0,
        le=2,
        description="Path hash mode override (0=1-byte, 1=2-byte, 2=3-byte, null = use radio default)",
    )


class ChannelImportResponse(BaseModel):
    imported_channels: list[Channel]
    duplicate_count: int
    invalid_lines: list[str]
    decrypt_started: bool = False
    decrypt_total_packets: int = 0
    message: str


def _derive_channel_identity(
    requested_name: str,
    request_key: str | None = None,
) -> tuple[str, str, bool]:
    is_hashtag = requested_name.startswith("#")

    if is_public_channel_name(requested_name):
        if request_key:
            try:
                key_bytes = bytes.fromhex(request_key)
                if len(key_bytes) != 16:
                    raise HTTPException(
                        status_code=400,
                        detail="Channel key must be exactly 16 bytes (32 hex chars)",
                    )
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid hex string for key") from None
            if key_bytes.hex().upper() != PUBLIC_CHANNEL_KEY:
                raise HTTPException(
                    status_code=400,
                    detail=f'"{PUBLIC_CHANNEL_NAME}" must use the canonical Public key',
                )
        return PUBLIC_CHANNEL_KEY, PUBLIC_CHANNEL_NAME, False

    if request_key and not is_hashtag:
        try:
            key_bytes = bytes.fromhex(request_key)
            if len(key_bytes) != 16:
                raise HTTPException(
                    status_code=400, detail="Channel key must be exactly 16 bytes (32 hex chars)"
                )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid hex string for key") from None
        key_hex = key_bytes.hex().upper()
        if is_public_channel_key(key_hex):
            raise HTTPException(
                status_code=400,
                detail=f'The canonical Public key may only be used for "{PUBLIC_CHANNEL_NAME}"',
            )
        return key_hex, requested_name, False

    key_bytes = sha256(requested_name.encode("utf-8")).digest()[:16]
    return key_bytes.hex().upper(), requested_name, is_hashtag


def _normalize_bulk_hashtag_name(name: str) -> str | None:
    trimmed = name.strip()
    if not trimmed:
        return None
    normalized = trimmed.lstrip("#").strip()
    if not normalized:
        return None
    # Hashtag channel names are hashed verbatim (matching meshcore_py / meshcore-cli /
    # meshcore.js), so any character is permitted — '&', capitals, accents, etc. all map
    # to a valid SHA256-derived key. Character normalization (lowercasing / charset
    # restriction) is a client-side display choice, applied by the caller before submit.
    # The on-radio name field holds 32 UTF-8 bytes including the leading '#', so cap there
    # to keep the stored label and the derived key in sync across clients.
    if len(f"#{normalized}".encode()) > 32:
        return None
    return f"#{normalized}"


async def _run_historical_channel_decryption_for_channels(
    channels: list[tuple[bytes, str, str]],
) -> None:
    total = await RawPacketRepository.get_undecrypted_count()
    decrypted_count = 0
    matched_channel_names: set[str] = set()

    if total == 0:
        logger.info("No undecrypted packets to process for bulk channel decrypt")
        return

    logger.info(
        "Starting bulk historical channel decryption of %d packets across %d channels",
        total,
        len(channels),
    )

    async for (
        packet_id,
        packet_data,
        packet_timestamp,
    ) in RawPacketRepository.stream_all_undecrypted():
        packet_info = parse_packet(packet_data)
        path_hex = packet_info.path.hex() if packet_info else None
        path_len = packet_info.path_length if packet_info else None

        for channel_key_bytes, channel_key_hex, channel_name in channels:
            result = try_decrypt_packet_with_channel_key(packet_data, channel_key_bytes)
            if result is None:
                continue

            msg_id = await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=channel_key_hex,
                channel_name=channel_name,
                sender=result.sender,
                message_text=result.message,
                timestamp=result.timestamp,
                received_at=packet_timestamp,
                path=path_hex,
                path_len=path_len,
                realtime=False,
            )
            if msg_id is not None:
                decrypted_count += 1
                matched_channel_names.add(channel_name)
            break

    logger.info(
        "Bulk historical channel decryption complete: %d/%d packets decrypted across %d channels",
        decrypted_count,
        total,
        len(matched_channel_names),
    )

    if decrypted_count > 0:
        broadcast_success(
            "Bulk historical decrypt complete",
            (
                f"Decrypted {decrypted_count} message{'s' if decrypted_count != 1 else ''} "
                f"across {len(matched_channel_names)} room"
                f"{'s' if len(matched_channel_names) != 1 else ''}"
            ),
        )


@router.get("", response_model=list[Channel])
async def list_channels() -> list[Channel]:
    """List all channels from the database."""
    return await ChannelRepository.get_all()


@router.get("/{key}/detail", response_model=ChannelDetail)
async def get_channel_detail(key: str) -> ChannelDetail:
    """Get comprehensive channel profile data with message statistics."""
    channel = await ChannelRepository.get_by_key(key)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    stats = await MessageRepository.get_channel_stats(channel.key)

    return ChannelDetail(
        channel=channel,
        message_counts=ChannelMessageCounts(**stats["message_counts"]),
        first_message_at=stats["first_message_at"],
        unique_sender_count=stats["unique_sender_count"],
        top_senders_24h=[ChannelTopSender(**s) for s in stats["top_senders_24h"]],
        path_hash_width_24h=stats["path_hash_width_24h"],
    )


@router.post("", response_model=Channel)
async def create_channel(request: CreateChannelRequest) -> Channel:
    """Create a channel in the database.

    Channels are NOT pushed to radio on creation. They are loaded to the radio
    automatically when sending a message (see messages.py send_channel_message).
    """
    requested_name = request.name
    key_hex, channel_name, is_hashtag = _derive_channel_identity(requested_name, request.key)

    logger.info("Creating channel %s: %s (hashtag=%s)", key_hex, channel_name, is_hashtag)

    # Store in database only - radio sync happens at send time
    await ChannelRepository.upsert(
        key=key_hex,
        name=channel_name,
        is_hashtag=is_hashtag,
        on_radio=False,
    )

    stored = await ChannelRepository.get_by_key(key_hex)
    if stored is None:
        raise HTTPException(status_code=500, detail="Channel was created but could not be reloaded")

    _broadcast_channel_update(stored)
    return stored


@router.post("/bulk-hashtag", response_model=BulkCreateHashtagChannelsResponse)
async def bulk_create_hashtag_channels(
    request: BulkCreateHashtagChannelsRequest,
    background_tasks: BackgroundTasks,
    response: Response,
) -> BulkCreateHashtagChannelsResponse:
    created_channels: list[Channel] = []
    existing_count = 0
    invalid_names: list[str] = []
    decrypt_started = False
    decrypt_total_packets = 0
    decrypt_targets: list[tuple[bytes, str, str]] = []

    for raw_name in request.channel_names:
        normalized_name = _normalize_bulk_hashtag_name(raw_name)
        if normalized_name is None:
            invalid_names.append(raw_name)
            continue

        key_hex, channel_name, is_hashtag = _derive_channel_identity(normalized_name)
        existing = await ChannelRepository.get_by_key(key_hex)
        if existing is not None:
            existing_count += 1
            continue

        await ChannelRepository.upsert(
            key=key_hex,
            name=channel_name,
            is_hashtag=is_hashtag,
            on_radio=False,
        )
        stored = await ChannelRepository.get_by_key(key_hex)
        if stored is None:
            raise HTTPException(
                status_code=500,
                detail="Channel was created but could not be reloaded",
            )

        created_channels.append(stored)
        decrypt_targets.append((bytes.fromhex(stored.key), stored.key, stored.name))
        _broadcast_channel_update(stored)

    if request.try_historical and decrypt_targets:
        decrypt_total_packets = await RawPacketRepository.get_undecrypted_count()
        if decrypt_total_packets > 0:
            background_tasks.add_task(
                _run_historical_channel_decryption_for_channels, decrypt_targets
            )
            decrypt_started = True
            response.status_code = status.HTTP_202_ACCEPTED

    message = (
        f"Created {len(created_channels)} room{'s' if len(created_channels) != 1 else ''}"
        if created_channels
        else "No new rooms were added"
    )
    if request.try_historical and decrypt_targets:
        if decrypt_started:
            message += (
                f" and started background decrypt of {decrypt_total_packets} packet"
                f"{'s' if decrypt_total_packets != 1 else ''}"
            )
        else:
            message += "; no undecrypted packets were available"

    return BulkCreateHashtagChannelsResponse(
        created_channels=created_channels,
        existing_count=existing_count,
        invalid_names=invalid_names,
        decrypt_started=decrypt_started,
        decrypt_total_packets=decrypt_total_packets,
        message=message,
    )


@router.post("/{key}/mark-read")
async def mark_channel_read(key: str) -> dict:
    """Mark a channel as read (update last_read_at timestamp)."""
    channel = await ChannelRepository.get_by_key(key)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    updated = await ChannelRepository.update_last_read_at(key)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update read state")

    return {"status": "ok", "key": channel.key}


@router.post("/{key}/flood-scope-override", response_model=Channel)
async def set_channel_flood_scope_override(
    key: str, request: ChannelFloodScopeOverrideRequest
) -> Channel:
    """Set or clear a per-channel flood-scope override."""
    channel = await ChannelRepository.get_by_key(key)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Tri-state persisted override:
    #   blank        -> None: clear the override, inherit the global scope
    #   "*" / "0"    -> canonical unscoped marker: force unscoped even over a global
    #   region name  -> "#Region": scope this channel
    # NOTE: at this (channel-override) layer blank means "clear/inherit", so we must
    # check for blank *before* is_unscoped() (which also treats "" as unscoped).
    raw_override = (request.flood_scope_override or "").strip()
    if raw_override == "":
        override: str | None = None
    elif is_unscoped(raw_override):
        override = UNSCOPED_OVERRIDE_MARKER
    else:
        override = normalize_region_scope(raw_override)
    updated = await ChannelRepository.update_flood_scope_override(channel.key, override)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update flood-scope override")

    refreshed = await ChannelRepository.get_by_key(channel.key)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Channel disappeared after update")

    broadcast_event("channel", refreshed.model_dump())
    return refreshed


@router.post("/{key}/path-hash-mode-override", response_model=Channel)
async def set_channel_path_hash_mode_override(
    key: str, request: ChannelPathHashModeOverrideRequest
) -> Channel:
    """Set or clear a per-channel path hash mode override."""
    channel = await ChannelRepository.get_by_key(key)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    updated = await ChannelRepository.update_path_hash_mode_override(
        channel.key, request.path_hash_mode_override
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update path-hash-mode override")

    refreshed = await ChannelRepository.get_by_key(channel.key)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Channel disappeared after update")

    broadcast_event("channel", refreshed.model_dump())
    return refreshed


@router.get("/export")
async def export_channels(
    mode: str = "all",
    keys: str | None = None,
) -> Response:
    """Export channels as a plain-text file in the format: #name - key.

    mode=all       exports every channel.
    mode=selected  requires a comma-separated ``keys`` parameter.
    """
    channels = await ChannelRepository.get_all()

    if mode == "selected" and keys:
        selected = {k.strip().upper() for k in keys.split(",") if k.strip()}
        channels = [c for c in channels if c.key.upper() in selected]

    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    lines: list[str] = [
        f"# MeshCore Channel Export - {date_str}",
        "# Format: #channel-name - 32-char-hex-key",
        "# Import this file in Remote Terminal for MeshCore via Channels -> Import",
        "",
    ]
    for c in channels:
        name = c.name if c.name.startswith("#") else f"#{c.name}"
        lines.append(f"{name} - {c.key.lower()}")

    content = "\n".join(lines) + "\n"
    filename = f"meshcore_channels_{date_str}.txt"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=ChannelImportResponse)
async def import_channels(
    background_tasks: BackgroundTasks,
    response: Response,
    file: Annotated[UploadFile, File()],
    try_historical: bool = False,
) -> ChannelImportResponse:
    """Import channels from a plain-text file (one '#name - key' per line).

    Skips lines that are comments (#-only), blank, or malformed.
    Skips channels whose key already exists in the database.
    Optionally triggers a background historical-packet decrypt sweep for the
    newly imported channels.
    """
    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="replace")

    imported_channels: list[Channel] = []
    duplicate_count = 0
    invalid_lines: list[str] = []
    decrypt_targets: list[tuple[bytes, str, str]] = []

    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        # Split name from key on the LAST ' - ' so channel names may themselves
        # contain ' - '. A valid entry ends in a 32-char hex key; anything else
        # that starts with '#' is a comment (this is what lets an exported file,
        # whose header comments contain ' - ', re-import cleanly).
        name_part, sep, key_candidate = stripped.rpartition(" - ")
        key_part = key_candidate.strip().lower()
        try:
            key_bytes = bytes.fromhex(key_part) if sep and len(key_part) == 32 else None
        except ValueError:
            key_bytes = None

        if key_bytes is None:
            if not stripped.startswith("#"):
                invalid_lines.append(stripped)
            continue

        name_part = name_part.strip()
        key_hex = key_bytes.hex().upper()
        channel_name = name_part if name_part.startswith("#") else f"#{name_part}"

        existing = await ChannelRepository.get_by_key(key_hex)
        if existing is not None:
            duplicate_count += 1
            continue

        # Imported channels are treated as hashtag channels.
        await ChannelRepository.upsert(
            key=key_hex,
            name=channel_name,
            is_hashtag=True,
            on_radio=False,
        )
        stored = await ChannelRepository.get_by_key(key_hex)
        if stored is None:
            invalid_lines.append(stripped)
            continue

        imported_channels.append(stored)
        decrypt_targets.append((key_bytes, key_hex, channel_name))
        _broadcast_channel_update(stored)
        logger.info("Imported channel %s (%s)", channel_name, key_hex)

    decrypt_started = False
    decrypt_total_packets = 0
    if try_historical and decrypt_targets:
        decrypt_total_packets = await RawPacketRepository.get_undecrypted_count()
        if decrypt_total_packets > 0:
            background_tasks.add_task(
                _run_historical_channel_decryption_for_channels, decrypt_targets
            )
            decrypt_started = True
            response.status_code = status.HTTP_202_ACCEPTED

    n = len(imported_channels)
    if n == 0:
        msg = "No new channels were added"
        if duplicate_count:
            msg += f" ({duplicate_count} already present)"
    else:
        msg = f"Imported {n} channel{'s' if n != 1 else ''}"
        if duplicate_count:
            msg += f", skipped {duplicate_count} duplicate{'s' if duplicate_count != 1 else ''}"
        if decrypt_started:
            msg += (
                f"; decrypting {decrypt_total_packets} historical packet"
                f"{'s' if decrypt_total_packets != 1 else ''} in background"
            )

    return ChannelImportResponse(
        imported_channels=imported_channels,
        duplicate_count=duplicate_count,
        invalid_lines=invalid_lines,
        decrypt_started=decrypt_started,
        decrypt_total_packets=decrypt_total_packets,
        message=msg,
    )


@router.post("/bulk-delete")
async def bulk_delete_channels(request: BulkDeleteChannelsRequest) -> dict:
    """Delete multiple channels from the database by key.

    DB-only (mirrors single delete): radio channel slots are managed separately
    and message history is preserved. The canonical Public channel is never
    deleted; its key is returned in ``skipped``.
    """
    deleted = 0
    skipped: list[str] = []
    for key in request.keys:
        if is_public_channel_key(key):
            skipped.append(key)
            continue
        if await ChannelRepository.get_by_key(key) is None:
            continue
        await ChannelRepository.delete(key)
        broadcast_event("channel_deleted", {"key": key})
        deleted += 1

    logger.info("Bulk deleted %d/%d channels", deleted, len(request.keys))
    return {"deleted": deleted, "skipped": skipped}


@router.delete("/{key}")
async def delete_channel(key: str) -> dict:
    """Delete a channel from the database by key.

    Note: This does not clear the channel from the radio. The radio's channel
    slots are managed separately (channels are loaded temporarily when sending).
    """
    if is_public_channel_key(key):
        raise HTTPException(
            status_code=400, detail="The canonical Public channel cannot be deleted"
        )

    logger.info("Deleting channel %s from database", key)
    await ChannelRepository.delete(key)

    broadcast_event("channel_deleted", {"key": key})

    return {"status": "ok"}
