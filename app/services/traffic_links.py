"""Resolve one received packet's travelled path into undirected link edges.

Pure module: plain data in (packet header info, known nodes, our own node,
confirmed soft resolutions), edges out. No DB, radio or HTTP.

MeshCore flood forwarding appends each forwarder's hash to the path, so a
received flood path reads origin -> path[0] -> ... -> path[n-1] -> us. Direct
routing instead consumes the path (each hop removes itself) and TRACE stores
SNR bytes in the path, so neither describes hops travelled.

Only known nodes (the caller passes contacts, never analyzer-only nodes) can
be link endpoints. Hops are resolved outward from our own node (always known),
and inward from the origin when the packet names a known one (adverts carry
the full origin pubkey). A hop is accepted only when it is certain enough:

1. a user-confirmed soft resolution for the prefix is among the candidates;
2. exactly one known node matches the prefix;
3. every candidate and the neighbour are located and the second-nearest
   candidate is at least NEAREST_RATIO times farther than the nearest.

Anything else leaves the hop unresolved and no edge crosses it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.decoder import PacketInfo, PayloadType, RouteType
from app.services.advert_links import DIRECT_HOP_WIDTH, haversine_km

Confidence = Literal["unique", "confirmed", "nearest"]

# Higher = more certain. An edge takes the weaker confidence of its two ends.
_RANK: dict[str, int] = {"nearest": 0, "confirmed": 1, "unique": 2}

# Second-nearest candidate must be at least this many times farther away.
NEAREST_RATIO = 2.0

_FLOOD_ROUTES = frozenset({RouteType.FLOOD, RouteType.TRANSPORT_FLOOD})


@dataclass(frozen=True)
class KnownNode:
    """A node known by full public key (lowercase hex), location optional."""

    pubkey: str
    lat: float | None
    lon: float | None


@dataclass(frozen=True)
class EdgeObservation:
    """One undirected edge seen on one packet copy (a_pubkey < b_pubkey)."""

    a_pubkey: str
    b_pubkey: str
    hop_width: int
    confidence: Confidence
    measured: bool  # final hop into our node: this copy's SNR/RSSI belongs to it


Resolved = tuple[KnownNode, Confidence]


def build_known_index(nodes: list[KnownNode]) -> dict[str, list[KnownNode]]:
    """Index nodes by their 1/2/3-byte (2/4/6 hex) pubkey prefixes."""
    index: dict[str, list[KnownNode]] = {}
    for node in nodes:
        pk = node.pubkey.lower()
        for width in (1, 2, 3):
            prefix = pk[: width * 2]
            if len(prefix) == width * 2:
                index.setdefault(prefix, []).append(node)
    return index


def split_hops(path_hex: str, hop_width: int) -> list[str]:
    step = hop_width * 2
    if step <= 0 or not path_hex or len(path_hex) % step != 0:
        return []
    return [path_hex[i : i + step] for i in range(0, len(path_hex), step)]


def pick_hop(
    hop_hex: str,
    neighbour: KnownNode,
    index: dict[str, list[KnownNode]],
    confirmed: dict[str, str],
) -> Resolved | None:
    """Resolve one hop prefix next to an already-known neighbour, or None."""
    hop = hop_hex.lower()
    candidates = index.get(hop, [])
    if not candidates:
        return None
    want = confirmed.get(hop)
    if want is not None:
        match = next((c for c in candidates if c.pubkey == want), None)
        if match is not None:
            return match, "confirmed"
    if len(candidates) == 1:
        return candidates[0], "unique"
    if neighbour.lat is None or neighbour.lon is None:
        return None
    dists: list[tuple[float, KnownNode]] = []
    for c in candidates:
        if c.lat is None or c.lon is None:
            return None  # an unlocated candidate could be the real hop
        dists.append((haversine_km(neighbour.lat, neighbour.lon, c.lat, c.lon), c))
    dists.sort(key=lambda d: d[0])
    (d1, best), (d2, _) = dists[0], dists[1]
    if d2 > 0 and d2 >= NEAREST_RATIO * d1:
        return best, "nearest"
    return None


def _edges_from_sequence(seq: list[Resolved | None], hop_width: int) -> list[EdgeObservation]:
    """Edges between adjacent resolved positions. The last pair ends at self."""
    out: dict[tuple[str, str], EdgeObservation] = {}
    last = len(seq) - 2
    for i, (left, right) in enumerate(zip(seq, seq[1:], strict=False)):
        if left is None or right is None:
            continue
        (a, ca), (b, cb) = left, right
        if a.pubkey == b.pubkey:
            continue
        conf: Confidence = ca if _RANK[ca] <= _RANK[cb] else cb
        lo, hi = sorted((a.pubkey, b.pubkey))
        measured = i == last
        prev = out.get((lo, hi))
        if prev is not None:
            if _RANK[prev.confidence] > _RANK[conf]:
                conf = prev.confidence
            measured = measured or prev.measured
        out[(lo, hi)] = EdgeObservation(lo, hi, hop_width, conf, measured)
    return list(out.values())


def resolve_chain(
    hops: list[str],
    hop_width: int,
    origin: KnownNode | None,
    self_node: KnownNode,
    index: dict[str, list[KnownNode]],
    confirmed: dict[str, str],
) -> list[EdgeObservation]:
    n = len(hops)
    resolved: list[Resolved | None] = [None] * n

    # Backward from our own node.
    right = self_node
    lowest = n
    for i in range(n - 1, -1, -1):
        hit = pick_hop(hops[i], right, index, confirmed)
        if hit is None:
            break
        resolved[i] = hit
        right = hit[0]
        lowest = i

    # Forward from the origin, up to where the backward walk stopped.
    if origin is not None:
        left = origin
        for i in range(lowest):
            hit = pick_hop(hops[i], left, index, confirmed)
            if hit is None:
                break
            resolved[i] = hit
            left = hit[0]

    seq: list[Resolved | None] = [(origin, "unique") if origin is not None else None]
    seq.extend(resolved)
    seq.append((self_node, "unique"))
    return _edges_from_sequence(seq, hop_width)


def advert_origin_pubkey(info: PacketInfo) -> str | None:
    """Full origin pubkey for adverts (first 32 payload bytes), else None."""
    if info.payload_type != PayloadType.ADVERT or len(info.payload) < 32:
        return None
    return info.payload[:32].hex()


def edges_for_packet(
    info: PacketInfo | None,
    self_node: KnownNode,
    index: dict[str, list[KnownNode]],
    by_pubkey: dict[str, KnownNode],
    confirmed: dict[str, str],
) -> list[EdgeObservation]:
    """Edges one received copy proves (possibly none)."""
    if info is None or info.payload_type == PayloadType.TRACE:
        return []
    # The advert names its origin, but only a known node (a contact) may be a
    # link endpoint; other origins leave the chain anchored at self only.
    origin_pk = advert_origin_pubkey(info)
    origin = by_pubkey.get(origin_pk) if origin_pk is not None else None

    if info.path_length == 0:
        # Heard straight from the transmitter. Only adverts name it, and an
        # advert with an empty path is a zero-hop send (never direct-routed).
        if origin is None:
            return []
        return _edges_from_sequence([(origin, "unique"), (self_node, "unique")], DIRECT_HOP_WIDTH)

    if info.route_type not in _FLOOD_ROUTES:
        return []
    width = info.path_hash_size
    hops = split_hops(info.path.hex(), width)
    if not hops:
        return []
    return resolve_chain(hops, width, origin, self_node, index, confirmed)
