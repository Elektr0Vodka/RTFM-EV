"""Per-link history from the edge log (link detail page)."""

import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    LinkEndpoint,
    LinkPacketRow,
    LinkSignalPoint,
    LinkSummary,
    LinkTimeseries,
    LinkTrafficPoint,
)
from app.repository.link_edges import LinkEdgesRepository
from app.services.advert_links import haversine_km
from app.services.link_edges import current_self_node
from app.services.traffic_links import KnownNode

router = APIRouter(prefix="/links", tags=["links"])

_KEY = re.compile(r"^[0-9a-f]{2,64}$")
_BUCKETS = {"hour": 3600, "day": 86400}

Since = Annotated[int | None, Query(ge=0, description="Window start (unix seconds)")]
Until = Annotated[int | None, Query(ge=0, description="Window end (unix seconds)")]


def _pair(a: str, b: str) -> tuple[str, str]:
    a, b = a.lower(), b.lower()
    if not _KEY.match(a) or not _KEY.match(b) or a == b:
        raise HTTPException(status_code=422, detail="Invalid link endpoints")
    lo, hi = sorted((a, b))
    return lo, hi


async def _endpoint(pubkey: str, me: KnownNode | None) -> LinkEndpoint:
    name, kind, lat, lon = await LinkEdgesRepository.endpoint_info(pubkey)
    if me is not None and pubkey == me.pubkey:
        return LinkEndpoint(
            pubkey=pubkey,
            name=name,
            kind="self",
            lat=me.lat if me.lat is not None else lat,
            lon=me.lon if me.lon is not None else lon,
        )
    return LinkEndpoint(pubkey=pubkey, name=name, kind=kind, lat=lat, lon=lon)


@router.get("/{a}/{b}/summary", response_model=LinkSummary)
async def get_link_summary(a: str, b: str, since: Since = None, until: Until = None) -> LinkSummary:
    """Endpoints, distance and packet breakdowns for one link in the window."""
    lo, hi = _pair(a, b)
    me = current_self_node()
    ea, eb = await _endpoint(lo, me), await _endpoint(hi, me)
    counts = await LinkEdgesRepository.summary_counts(lo, hi, since, until)
    distance: float | None = None
    if ea.lat is not None and ea.lon is not None and eb.lat is not None and eb.lon is not None:
        distance = haversine_km(ea.lat, ea.lon, eb.lat, eb.lon)
    return LinkSummary(
        a=ea,
        b=eb,
        distance_km=distance,
        involves_self=me is not None and me.pubkey in (lo, hi),
        total_packets=counts["total"],
        first_seen=counts["first_seen"],
        last_seen=counts["last_seen"],
        by_hop_width=counts["by_hop_width"],
        by_confidence=counts["by_confidence"],
        by_payload_type=counts["by_payload_type"],
    )


@router.get("/{a}/{b}/timeseries", response_model=LinkTimeseries)
async def get_link_timeseries(
    a: str,
    b: str,
    since: Since = None,
    until: Until = None,
    bucket: Literal["hour", "day"] = "day",
) -> LinkTimeseries:
    """Packets per bucket and payload type, plus signal per bucket."""
    lo, hi = _pair(a, b)
    seconds = _BUCKETS[bucket]
    traffic, signal = await LinkEdgesRepository.timeseries(lo, hi, since, until, seconds)
    return LinkTimeseries(
        bucket_seconds=seconds,
        traffic=[LinkTrafficPoint(**t) for t in traffic],
        signal=[LinkSignalPoint(**s) for s in signal],
    )


@router.get("/{a}/{b}/packets", response_model=list[LinkPacketRow])
async def get_link_packets(
    a: str,
    b: str,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    before: Annotated[int | None, Query(ge=0, description="Only packets before this ts")] = None,
) -> list[LinkPacketRow]:
    """Most recent packets that used this link, newest first."""
    lo, hi = _pair(a, b)
    return [LinkPacketRow(**r) for r in await LinkEdgesRepository.packets(lo, hi, limit, before)]
