"""Endpoints for soft resolution of partial-node identities.

Matches partial pubkey prefixes (prefix-only placeholder contacts and hop hashes
seen in paths) against the already-synced external-map cache, lets the user
review the proposals, and persists reversible soft resolution links. Never
writes into the authoritative ``contacts`` table.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.models import PartialNodeResolution
from app.repository import ContactRepository
from app.repository.advert_links import AdvertLinksRepository
from app.repository.external_map import ExternalMapRepository
from app.repository.partial_resolution import PartialResolutionRepository
from app.services.partial_resolution import Candidate, compute_preview

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/partial-resolutions", tags=["partial-resolutions"])


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
    """Persist the user-selected soft resolution links."""
    applied = 0
    for item in request.selections:
        await PartialResolutionRepository.upsert(
            prefix_hex=item.prefix_hex,
            resolved_pubkey=item.resolved_pubkey,
            resolved_name=item.resolved_name,
            confidence=item.confidence,
            candidate_count=item.candidate_count,
        )
        applied += 1
    return ApplyResponse(applied=applied)


@router.get("", response_model=list[PartialNodeResolution])
async def list_resolutions() -> list[PartialNodeResolution]:
    """Current soft resolution links."""
    return await PartialResolutionRepository.list_all()


@router.delete("/{prefix_hex}", response_model=DeleteResponse)
async def delete_resolution(prefix_hex: str) -> DeleteResponse:
    """Clear one soft resolution link."""
    return DeleteResponse(deleted=await PartialResolutionRepository.delete(prefix_hex))
