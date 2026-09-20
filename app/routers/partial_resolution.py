"""Endpoints for soft resolution of partial-node identities.

Matches partial pubkey prefixes (prefix-only placeholder contacts and hop hashes
seen in paths) against the already-synced external-map cache and lets the user
review the proposals. Applying a proposal records a reversible soft link (for
provenance and advert-links map disambiguation) and promotes the node to a full
contact so its resolved name/location apply live across the app. The resolved
name/location go in the advertised fields, so a later RF advert overwrites them.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.models import ContactUpsert, PartialNodeResolution
from app.repository import ContactRepository
from app.repository.advert_links import AdvertLinksRepository
from app.repository.external_map import ExternalMapRepository
from app.repository.partial_resolution import PartialResolutionRepository
from app.routers.contacts import _broadcast_contact_resolution, _broadcast_contact_update
from app.services.contact_reconciliation import promote_prefix_contacts_for_contact
from app.services.partial_resolution import Candidate, compute_preview

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/partial-resolutions", tags=["partial-resolutions"])

# MeshCore contact types.
_CONTACT_TYPE_CLIENT = 1
_CONTACT_TYPE_REPEATER = 2
_CONTACT_TYPE_ROOM = 3
_CONTACT_TYPE_SENSOR = 4


def _role_to_contact_type(role: str) -> int:
    """Map an external-map role string to a MeshCore contact type (0 = unknown)."""
    r = (role or "").lower()
    if "repeat" in r:
        return _CONTACT_TYPE_REPEATER
    if "room" in r:
        return _CONTACT_TYPE_ROOM
    if "sensor" in r:
        return _CONTACT_TYPE_SENSOR
    if "client" in r or "companion" in r or "chat" in r:
        return _CONTACT_TYPE_CLIENT
    return 0


class PreviewCandidate(BaseModel):
    pubkey: str
    name: str | None
    lat: float | None
    lon: float | None
    confidence: float
    distance_km: float | None


class PreviewResolution(BaseModel):
    prefix_hex: str
    seen_as: str
    candidate_count: int
    candidates: list[PreviewCandidate]


class PreviewResponse(BaseModel):
    external_count: int
    reason: str | None
    resolutions: list[PreviewResolution]
    unmatched: list[str]


class ApplyItem(BaseModel):
    prefix_hex: str
    resolved_pubkey: str
    resolved_name: str | None = None
    confidence: float = 0.0
    candidate_count: int = 0


class ApplyRequest(BaseModel):
    selections: list[ApplyItem]


class ApplyResponse(BaseModel):
    applied: int
    promoted: int


class DeleteResponse(BaseModel):
    deleted: bool


@router.get("/preview", response_model=PreviewResponse)
async def preview() -> PreviewResponse:
    """Scan partial nodes and propose soft resolutions from the external map.

    Read-only: persists nothing. If the external-map cache is empty, returns no
    proposals and a ``reason`` the UI can surface.
    """
    external_ids = await ExternalMapRepository.all_identities()
    external = [
        Candidate(pubkey=pk, name=name, lat=lat, lon=lon) for pk, name, lat, lon in external_ids
    ]

    reason: str | None = None
    if not external:
        reason = "The external map cache is empty. Enable and sync the external map first."
        return PreviewResponse(external_count=0, reason=reason, resolutions=[], unmatched=[])

    placeholder_prefixes = await ContactRepository.prefix_only_keys()
    path_rows = await AdvertLinksRepository.recent_events()
    located = await AdvertLinksRepository.located_nodes()
    full_contact_pubkeys = {
        pk for pk, _name, _lat, _lon in await ContactRepository.full_key_identities()
    }

    result = compute_preview(
        placeholder_prefixes=placeholder_prefixes,
        path_rows=path_rows,
        located=located,
        external=external,
        full_contact_pubkeys=full_contact_pubkeys,
    )
    resolutions = [
        PreviewResolution(
            prefix_hex=r.prefix_hex,
            seen_as=r.seen_as,
            candidate_count=r.candidate_count,
            candidates=[
                PreviewCandidate(
                    pubkey=c.pubkey,
                    name=c.name,
                    lat=c.lat,
                    lon=c.lon,
                    confidence=c.confidence,
                    distance_km=c.distance_km,
                )
                for c in r.candidates
            ],
        )
        for r in result.resolutions
    ]
    return PreviewResponse(
        external_count=len(external),
        reason=None,
        resolutions=resolutions,
        unmatched=result.unmatched,
    )


@router.post("/apply", response_model=ApplyResponse)
async def apply(request: ApplyRequest) -> ApplyResponse:
    """Apply the user-selected resolutions.

    For each selection: record the soft link (provenance + map disambiguation),
    ensure a full contact exists for the resolved pubkey (created from the
    external-map node's name/location in the *advertised* fields, so a later RF
    advert overwrites the guess), then promote any prefix-only placeholder into
    it. Broadcasts contact updates so the change applies live without a refresh.
    """
    applied = 0
    promoted_total = 0
    for item in request.selections:
        await PartialResolutionRepository.upsert(
            prefix_hex=item.prefix_hex,
            resolved_pubkey=item.resolved_pubkey,
            resolved_name=item.resolved_name,
            confidence=item.confidence,
            candidate_count=item.candidate_count,
        )
        applied += 1

        resolved = item.resolved_pubkey.lower()
        if len(resolved) != 64:
            continue  # cannot promote without a full key

        # Create the full contact only if it does not already exist, so a real
        # advert-heard contact is never overwritten by a guessed name.
        existing = await ContactRepository.get_by_key(resolved)
        if existing is None:
            ext = await ExternalMapRepository.get(resolved)
            await ContactRepository.upsert(
                ContactUpsert(
                    public_key=resolved,
                    name=(ext.name or None) if ext else item.resolved_name,
                    type=_role_to_contact_type(ext.role) if ext else 0,
                    lat=ext.lat if ext else None,
                    lon=ext.lon if ext else None,
                    on_radio=False,
                )
            )

        promoted = await promote_prefix_contacts_for_contact(public_key=resolved, log=logger)
        promoted_total += len(promoted)

        stored = await ContactRepository.get_by_key(resolved)
        if stored is not None:
            await _broadcast_contact_update(stored)
            if promoted:
                await _broadcast_contact_resolution(promoted, stored)

    return ApplyResponse(applied=applied, promoted=promoted_total)


@router.get("", response_model=list[PartialNodeResolution])
async def list_resolutions() -> list[PartialNodeResolution]:
    """Current soft resolution links."""
    return await PartialResolutionRepository.list_all()


@router.delete("/{prefix_hex}", response_model=DeleteResponse)
async def delete_resolution(prefix_hex: str) -> DeleteResponse:
    """Clear one soft resolution link."""
    return DeleteResponse(deleted=await PartialResolutionRepository.delete(prefix_hex))
