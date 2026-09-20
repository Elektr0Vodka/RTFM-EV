"""Pure scoring + path-neighbour helpers for partial-node resolution.

A partial node is one we only hold a pubkey *prefix* for (1/2/3 bytes = 2/4/6
hex chars): a prefix-only placeholder contact, or a hop hash seen in an advert
path but never heard through a full advert. This module scores full-pubkey
candidates (drawn from the external-map cache) against such a prefix so the user
can review and confirm a soft resolution link. It is pure (plain data in, plain
data out) so it is fully unit-testable without a DB.

Scoring:
- ``width_factor = width / 3`` (a wider prefix is more specific, so a match is
  more trustworthy).
- A **unique** candidate (only one full pubkey in the cache shares the prefix)
  is unambiguous: ``confidence = 0.7 + 0.3 * width_factor`` (0.8 / 0.9 / 1.0 for
  1/2/3 bytes).
- An **ambiguous** candidate (several share the prefix) is a guess:
  ``confidence = width_factor * (1 / candidate_count) * proximity_factor``, which
  is always below the unique band. ``proximity_factor`` rewards candidates near
  the prefix's located path-neighbours (``1 / (1 + distance_km / 50)``); with no
  usable distance it is a neutral ``0.4``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from app.services.advert_links import (
    AdvertPathRow,
    LocatedNode,
    _resolve_hop,
    _split_hops,
    build_prefix_index,
    haversine_km,
)

# Distance (km) at which the proximity reward halves. Heuristic, not a config.
PROX_SCALE_KM = 50.0
# Neutral proximity when a candidate has no location or the prefix has no located
# path-neighbour to measure against.
NEUTRAL_PROXIMITY = 0.4


@dataclass(frozen=True)
class Candidate:
    """A full-pubkey node that shares the prefix being resolved."""

    pubkey: str
    name: str | None
    lat: float | None
    lon: float | None


@dataclass(frozen=True)
class ScoredCandidate:
    pubkey: str
    name: str | None
    lat: float | None
    lon: float | None
    confidence: float
    distance_km: float | None


def _width(prefix_hex: str) -> int:
    return max(1, len(prefix_hex) // 2)


def _min_distance_km(
    lat: float | None, lon: float | None, neighbour_points: list[tuple[float, float]]
) -> float | None:
    if lat is None or lon is None or not neighbour_points:
        return None
    return round(min(haversine_km(lat, lon, nlat, nlon) for nlat, nlon in neighbour_points), 1)


def rank_candidates(
    prefix_hex: str,
    candidates: list[Candidate],
    neighbour_points: list[tuple[float, float]],
) -> list[ScoredCandidate]:
    """Score and rank ``candidates`` for ``prefix_hex`` (best first).

    Ties break by distance (nearest first, unlocated last) then pubkey, so the
    ordering is deterministic.
    """
    prefix_hex = prefix_hex.lower()
    # A prefix wider than 3 bytes is at least as specific as a 3-byte one, so the
    # width factor saturates at 1.0.
    width_factor = min(_width(prefix_hex), 3) / 3
    count = len(candidates)
    scored: list[ScoredCandidate] = []
    for c in candidates:
        distance_km = _min_distance_km(c.lat, c.lon, neighbour_points)
        if count == 1:
            confidence = round(0.7 + 0.3 * width_factor, 3)
        else:
            proximity = (
                NEUTRAL_PROXIMITY
                if distance_km is None
                else 1.0 / (1.0 + distance_km / PROX_SCALE_KM)
            )
            confidence = round(width_factor * (1.0 / count) * proximity, 3)
        scored.append(
            ScoredCandidate(
                pubkey=c.pubkey.lower(),
                name=c.name,
                lat=c.lat,
                lon=c.lon,
                confidence=confidence,
                distance_km=distance_km,
            )
        )
    scored.sort(
        key=lambda s: (
            -s.confidence,
            s.distance_km if s.distance_km is not None else float("inf"),
            s.pubkey,
        )
    )
    return scored


def collect_path_prefixes(rows: list[AdvertPathRow]) -> set[str]:
    """All distinct hop-hash prefixes (lowercased) appearing in ``rows``."""
    out: set[str] = set()
    for row in rows:
        width = row.hop_width or 0
        if not width:
            continue
        for hop in _split_hops(row.path_hex, width):
            out.add(hop.lower())
    return out


def collect_path_prefix_neighbours(
    rows: list[AdvertPathRow],
    located: list[LocatedNode],
) -> dict[str, list[tuple[float, float]]]:
    """Map each hop-hash prefix seen in ``rows`` to its located upstream neighbours.

    Walks each advert path from the origin anchor inward (mirroring the
    advert-links resolver). For each hop, the most recently resolved located node
    upstream is recorded as a geographic neighbour of that hop's prefix. A hop
    that resolves to no located node breaks the chain there (no anchor remains for
    later hops), so downstream prefixes get no phantom neighbour. Direct adverts
    (no hops) contribute nothing.
    """
    index = build_prefix_index(located)
    origin_by_key = {n.pubkey: n for n in located}
    neighbours: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for row in rows:
        width = row.hop_width or 0
        hops = _split_hops(row.path_hex, width) if width else []
        if not hops:
            continue
        prev: LocatedNode | None = origin_by_key.get(row.public_key.lower())
        for hop in hops:
            hop = hop.lower()
            if prev is not None:
                neighbours[hop].append((prev.lat, prev.lon))
            node, _ambiguous = _resolve_hop(hop, prev, index)
            prev = node
    return dict(neighbours)


@dataclass(frozen=True)
class PrefixPreview:
    """A partial prefix and its ranked resolution candidates for review."""

    prefix_hex: str
    seen_as: str  # 'placeholder' | 'path' | 'both'
    candidate_count: int
    candidates: list[ScoredCandidate]


@dataclass(frozen=True)
class PreviewResult:
    resolutions: list[PrefixPreview]  # ranked, best top-confidence first
    unmatched: list[str]  # prefixes with no external-map candidate, sorted


def _external_candidates(
    prefix: str, external: list[Candidate], index: dict[str, list[Candidate]]
) -> list[Candidate]:
    """External-map candidates whose pubkey starts with ``prefix``.

    Uses the 1/2/3-byte index for the common widths; falls back to a linear
    ``startswith`` scan for any other prefix length (e.g. a longer placeholder).
    """
    if len(prefix) in (2, 4, 6):
        return index.get(prefix, [])
    return [c for c in external if c.pubkey.lower().startswith(prefix)]


def compute_preview(
    placeholder_prefixes: list[str],
    path_rows: list[AdvertPathRow],
    located: list[LocatedNode],
    external: list[Candidate],
    full_contact_pubkeys: set[str],
) -> PreviewResult:
    """Build the reviewable resolution proposals for all partial prefixes.

    ``placeholder_prefixes`` are prefix-only contact keys (always considered).
    Path hop prefixes are also considered, except those that are a known full
    contact's prefix (the advert-links resolver already identifies those). Each
    considered prefix is matched against the external-map ``external`` cache and
    its candidates ranked (:func:`rank_candidates`) using path-neighbour distance.
    Prefixes with no candidate are returned in ``unmatched``.
    """
    index: dict[str, list[Candidate]] = defaultdict(list)
    for c in external:
        pk = c.pubkey.lower()
        for w in (1, 2, 3):
            index[pk[: w * 2]].append(c)

    full_pubkeys = {pk.lower() for pk in full_contact_pubkeys}
    full_prefix_set = {pk[: w * 2] for pk in full_pubkeys for w in (1, 2, 3)}
    neighbours = collect_path_prefix_neighbours(path_rows, located)

    sources: dict[str, set[str]] = defaultdict(set)
    for p in placeholder_prefixes:
        sources[p.lower()].add("placeholder")
    for p in collect_path_prefixes(path_rows):
        if p in full_prefix_set:
            continue
        sources[p].add("path")

    resolutions: list[PrefixPreview] = []
    unmatched: list[str] = []
    for prefix, srcs in sources.items():
        cands = _external_candidates(prefix, external, index)
        if not cands:
            unmatched.append(prefix)
            continue
        ranked = rank_candidates(prefix, cands, neighbours.get(prefix, []))
        seen_as = "both" if {"placeholder", "path"} <= srcs else next(iter(srcs))
        resolutions.append(
            PrefixPreview(
                prefix_hex=prefix,
                seen_as=seen_as,
                candidate_count=len(cands),
                candidates=ranked,
            )
        )

    resolutions.sort(
        key=lambda r: (-(r.candidates[0].confidence if r.candidates else 0.0), r.prefix_hex)
    )
    unmatched.sort()
    return PreviewResult(resolutions=resolutions, unmatched=unmatched)
