"""Communities: join by QR JSON, add community hashtag channels, export.

Keys come from ``app/communities.py`` (meshcore-open derivation). Channels are
created in the database only, exactly like ``POST /channels``; they are loaded
onto the radio at send time. Nothing here transmits.

The community secret is stored (``communities.secret``) so hashtag channels can
be added later. It is returned only by ``GET /communities/{id}/export`` and is
never logged.
"""

import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.communities import (
    CommunityError,
    community_id,
    derive_hashtag_channel_key,
    derive_public_channel_key,
    format_qr_payload,
    hashtag_channel_name,
    hashtag_display,
    normalize_hashtag,
    parse_qr_payload,
    public_channel_name,
)
from app.models import Channel
from app.repository import ChannelRepository, RawPacketRepository
from app.repository.communities import CommunityRepository, StoredCommunity
from app.routers.channels import (
    _broadcast_channel_update,
    _run_historical_channel_decryption_for_channels,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/communities", tags=["communities"])

_NO_STORE = {"Cache-Control": "no-store"}


class CommunityChannel(BaseModel):
    key: str = Field(description="Channel key (32-char hex)")
    name: str
    kind: Literal["public", "hashtag"]


class CommunitySummary(BaseModel):
    id: str = Field(description='Community ID: hex SHA256("community:v1" || secret)')
    short_id: str = Field(description="First 8 hex chars of the community ID")
    name: str
    created_at: int
    public_channel_key: str = Field(description="Derived public channel key (32-char hex)")
    channels: list[CommunityChannel] = Field(
        default_factory=list,
        description="Stored channels whose key derives from this community's secret",
    )


class JoinCommunityRequest(BaseModel):
    payload: str = Field(
        min_length=1,
        max_length=4096,
        description='QR JSON: {"v":1,"type":"meshcore_community","name":...,"k":<base64url>}',
    )
    add_public_channel: bool = Field(
        default=True, description='Also create the "<name> Public" channel'
    )
    try_historical: bool = Field(
        default=False,
        description="Attempt one background historical decrypt sweep for new channels",
    )


class JoinCommunityResponse(BaseModel):
    community: CommunitySummary
    already_joined: bool
    created_channels: list[Channel]
    decrypt_started: bool = False
    decrypt_total_packets: int = 0


class AddHashtagRequest(BaseModel):
    hashtag: str = Field(min_length=1, max_length=64, description="Tag, leading # optional")
    try_historical: bool = False


class AddHashtagResponse(BaseModel):
    channel: Channel
    created: bool
    community: CommunitySummary
    decrypt_started: bool = False
    decrypt_total_packets: int = 0


class CommunityExport(BaseModel):
    id: str
    name: str
    payload: str = Field(description="QR JSON including the secret; treat as a password")


def _member_channels(community: StoredCommunity, channels: list[Channel]) -> list[CommunityChannel]:
    public_key = derive_public_channel_key(community.secret).hex().upper()
    prefix = f"{community.name} #"
    members: list[CommunityChannel] = []
    for channel in channels:
        if channel.key.upper() == public_key:
            members.append(CommunityChannel(key=channel.key, name=channel.name, kind="public"))
            continue
        if not channel.name.startswith(prefix):
            continue
        tag = channel.name[len(prefix) :]
        if not normalize_hashtag(tag):
            continue
        if derive_hashtag_channel_key(community.secret, tag).hex().upper() == channel.key.upper():
            members.append(CommunityChannel(key=channel.key, name=channel.name, kind="hashtag"))
    return members


def _summary(community: StoredCommunity, channels: list[Channel]) -> CommunitySummary:
    return CommunitySummary(
        id=community.id,
        short_id=community.id[:8],
        name=community.name,
        created_at=community.created_at,
        public_channel_key=derive_public_channel_key(community.secret).hex().upper(),
        channels=_member_channels(community, channels),
    )


async def _get_or_404(cid: str) -> StoredCommunity:
    community = await CommunityRepository.get(cid)
    if community is None:
        raise HTTPException(status_code=404, detail="Community not found")
    return community


async def _create_channel(key_hex: str, name: str) -> tuple[Channel, bool]:
    """Create a DB-only channel; an existing key is left untouched."""
    existing = await ChannelRepository.get_by_key(key_hex)
    if existing is not None:
        return existing, False
    await ChannelRepository.upsert(key=key_hex, name=name, is_hashtag=False, on_radio=False)
    stored = await ChannelRepository.get_by_key(key_hex)
    if stored is None:
        raise HTTPException(status_code=500, detail="Channel was created but could not be reloaded")
    _broadcast_channel_update(stored)
    return stored, True


async def _maybe_decrypt(
    try_historical: bool,
    created: list[Channel],
    background_tasks: BackgroundTasks,
    response: Response,
) -> tuple[bool, int]:
    if not try_historical or not created:
        return False, 0
    total = await RawPacketRepository.get_undecrypted_count()
    if total == 0:
        return False, 0
    targets = [(bytes.fromhex(c.key), c.key, c.name) for c in created]
    background_tasks.add_task(_run_historical_channel_decryption_for_channels, targets)
    response.status_code = status.HTTP_202_ACCEPTED
    return True, total


@router.get("", response_model=list[CommunitySummary])
async def list_communities() -> list[CommunitySummary]:
    """List joined communities (never includes the secret)."""
    communities = await CommunityRepository.get_all()
    channels = await ChannelRepository.get_all()
    return [_summary(c, channels) for c in communities]


@router.post("/join", response_model=JoinCommunityResponse)
async def join_community(
    request: JoinCommunityRequest,
    background_tasks: BackgroundTasks,
    response: Response,
) -> JoinCommunityResponse:
    """Join a community from its QR JSON and optionally create its public channel."""
    try:
        payload = parse_qr_payload(request.payload)
    except CommunityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    cid = community_id(payload.secret)
    inserted = await CommunityRepository.insert(cid, payload.name, payload.secret)
    community = await _get_or_404(cid)
    logger.info(
        "%s community %s (%s)", "Joined" if inserted else "Rejoined", community.name, cid[:8]
    )

    created: list[Channel] = []
    if request.add_public_channel:
        key_hex = derive_public_channel_key(community.secret).hex().upper()
        channel, was_created = await _create_channel(key_hex, public_channel_name(community.name))
        if was_created:
            created.append(channel)

    decrypt_started, decrypt_total = await _maybe_decrypt(
        request.try_historical, created, background_tasks, response
    )
    return JoinCommunityResponse(
        community=_summary(community, await ChannelRepository.get_all()),
        already_joined=not inserted,
        created_channels=created,
        decrypt_started=decrypt_started,
        decrypt_total_packets=decrypt_total,
    )


@router.post("/{cid}/hashtags", response_model=AddHashtagResponse)
async def add_community_hashtag(
    cid: str,
    request: AddHashtagRequest,
    background_tasks: BackgroundTasks,
    response: Response,
) -> AddHashtagResponse:
    """Create the "<name> #<tag>" channel with the community-derived key."""
    community = await _get_or_404(cid)
    tag = hashtag_display(request.hashtag)
    try:
        name = hashtag_channel_name(community.name, request.hashtag)
        key_hex = derive_hashtag_channel_key(community.secret, tag).hex().upper()
    except CommunityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    channel, created = await _create_channel(key_hex, name)
    if created:
        logger.info("Added community channel %s (%s)", name, community.id[:8])
    decrypt_started, decrypt_total = await _maybe_decrypt(
        request.try_historical, [channel] if created else [], background_tasks, response
    )
    return AddHashtagResponse(
        channel=channel,
        created=created,
        community=_summary(community, await ChannelRepository.get_all()),
        decrypt_started=decrypt_started,
        decrypt_total_packets=decrypt_total,
    )


@router.get("/{cid}/export", response_model=CommunityExport)
async def export_community(cid: str, response: Response) -> CommunityExport:
    """Return the community QR JSON, secret included. The only endpoint that does."""
    community = await _get_or_404(cid)
    response.headers.update(_NO_STORE)
    return CommunityExport(
        id=community.id,
        name=community.name,
        payload=format_qr_payload(community.name, community.secret),
    )


@router.delete("/{cid}")
async def delete_community(cid: str) -> dict:
    """Forget a community and its stored secret. Its channels are kept."""
    if not await CommunityRepository.delete(cid):
        raise HTTPException(status_code=404, detail="Community not found")
    logger.info("Removed community %s", cid[:8])
    return {"status": "ok"}
