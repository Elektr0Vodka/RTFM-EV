"""Resolve stored advert paths into GPS edges (map link truth).

Pure module: it takes plain data (advert path rows + located nodes + an
optional self node) and returns resolved undirected edges. No DB, no radio,
no HTTP, so it is fully unit-testable.

Each stored path is an anchored chain:

    origin (advertiser, full pubkey => unique)
      -> hop0 -> hop1 -> ... -> hopN
      -> self (our node)

A hop hex is a prefix of a node's public key. Wide hops (2b/3b) usually match
one located node; 1b hops often match several. We resolve each path by walking
from the origin anchor inward, disambiguating a multi-match hop by choosing the
candidate nearest to the previously-resolved node. A hop matching no located
node breaks the chain there (the tail is dropped, no self edge).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

NodeKind = Literal["self", "contact", "external"]

# hop_width assigned to direct adverts (origin heard with no hops). Both
# endpoints are exactly known, so it is maximum confidence and always passes
# the confidence filter.
DIRECT_HOP_WIDTH = 3


@dataclass(frozen=True)
class LocatedNode:
    """A GPS-placed node keyed by full public key (lowercase hex)."""

    pubkey: str
    lat: float
    lon: float
    kind: NodeKind


@dataclass(frozen=True)
class AdvertPathRow:
    """One advert transmission's stored path."""

    public_key: str  # advertiser, full lowercase hex
    path_hex: str  # relay chain hex; "" for direct
    hop_width: int | None  # bytes per hop (1/2/3); None for direct
    min_path_len: int  # 0 = heard direct
    first_seen: int


@dataclass(frozen=True)
class ResolvedEdge:
    a_pubkey: str
    b_pubkey: str
    hop_width: int
    count: int
    last_seen: int
    ambiguous: bool


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def build_prefix_index(nodes: list[LocatedNode]) -> dict[str, list[LocatedNode]]:
    """Index located nodes by their 1/2/3-byte (2/4/6 hex) pubkey prefixes."""
    index: dict[str, list[LocatedNode]] = {}
    for node in nodes:
        pk = node.pubkey.lower()
        for width in (1, 2, 3):
            prefix = pk[: width * 2]
            if len(prefix) == width * 2:
                index.setdefault(prefix, []).append(node)
    return index


def _split_hops(path_hex: str, hop_width: int) -> list[str]:
    step = hop_width * 2
    if step <= 0 or not path_hex or len(path_hex) % step != 0:
        return []
    return [path_hex[i : i + step] for i in range(0, len(path_hex), step)]


def _resolve_hop(
    hop_hex: str,
    prev: LocatedNode | None,
    index: dict[str, list[LocatedNode]],
) -> tuple[LocatedNode | None, bool]:
    """Resolve a single hop prefix.

    Returns ``(node, ambiguous)``. ``node`` is None when the prefix matches no
    located node, or matches several with no prior anchor to disambiguate.
    """
    candidates = index.get(hop_hex.lower(), [])
    if not candidates:
        return None, False
    if len(candidates) == 1:
        return candidates[0], False
    if prev is None:
        return None, False
    nearest = min(candidates, key=lambda c: haversine_km(prev.lat, prev.lon, c.lat, c.lon))
    return nearest, True


def resolve_advert_edges(
    rows: list[AdvertPathRow],
    located: list[LocatedNode],
    self_node: LocatedNode | None,
) -> list[ResolvedEdge]:
    """Resolve advert paths into aggregated undirected GPS edges."""
    index = build_prefix_index(located)
    by_key: dict[tuple[str, str, int], dict] = {}

    def add_edge(a: LocatedNode, b: LocatedNode, width: int, ambiguous: bool, seen: int) -> None:
        if a.pubkey == b.pubkey:
            return
        lo, hi = sorted((a.pubkey, b.pubkey))
        key = (lo, hi, width)
        agg = by_key.get(key)
        if agg is None:
            by_key[key] = {"count": 1, "last_seen": seen, "ambiguous": ambiguous}
        else:
            agg["count"] += 1
            agg["last_seen"] = max(agg["last_seen"], seen)
            agg["ambiguous"] = agg["ambiguous"] or ambiguous

    origin_by_key = {n.pubkey: n for n in located}

    for row in rows:
        origin = origin_by_key.get(row.public_key.lower())
        width = row.hop_width or 0
        hops = _split_hops(row.path_hex, width) if width else []

        if not hops:
            # Direct advert: origin -> self (if both known).
            if origin and self_node:
                add_edge(origin, self_node, DIRECT_HOP_WIDTH, False, row.first_seen)
            continue

        # Walk the chain from the origin anchor inward.
        chain: list[tuple[LocatedNode, bool]] = []
        if origin is not None:
            chain.append((origin, False))
        prev = origin
        broke = False
        for hop in hops:
            node, ambiguous = _resolve_hop(hop, prev, index)
            if node is None:
                broke = True
                break
            chain.append((node, ambiguous))
            prev = node

        # Emit consecutive edges along the resolved chain. Each edge takes the
        # ambiguity of its newly-resolved endpoint (the earlier node is already
        # anchored, so origin's False never masks a guessed hop).
        for (a, _), (b, amb_b) in zip(chain, chain[1:], strict=False):
            add_edge(a, b, width, amb_b, row.first_seen)

        # Tail -> self only if the whole chain resolved (no break) and self known.
        if not broke and self_node is not None and chain:
            last_node, last_amb = chain[-1]
            add_edge(last_node, self_node, width, last_amb, row.first_seen)

    return [
        ResolvedEdge(
            a_pubkey=lo,
            b_pubkey=hi,
            hop_width=width,
            count=agg["count"],
            last_seen=agg["last_seen"],
            ambiguous=agg["ambiguous"],
        )
        for (lo, hi, width), agg in by_key.items()
    ]
