"""Pure prefix-collision computation for the Mesh Health tab.

A hop hash in a MeshCore advert path is a prefix of a node's public key
(1/2/3 bytes = 2/4/6 hex chars). When two known contacts share the same prefix
at a given width, that prefix is ambiguous for hop resolution. This module
groups full-key contacts by prefix at each width and reports the collisions.
"""

from collections import defaultdict
from itertools import combinations

from app.services.advert_links import haversine_km

PREFIX_WIDTHS = (1, 2, 3)

# A prefix collision only matters over RF if the colliding nodes are close enough
# to be heard in the same area. Groups whose farthest-apart located pair is within
# this distance are flagged "local" (a real conflict risk); farther apart is
# "regional" (unlikely to actually collide). Heuristic threshold, not a config.
LOCAL_MAX_KM = 50.0


def _distance_assessment(nodes: list[dict]) -> tuple[float | None, int, str]:
    """Max pairwise distance (km), located-node count, and LOCAL/REGIONAL label.

    Only nodes with both coordinates count. With fewer than two located nodes the
    distance is unknown, so the assessment is ``"unknown"``.
    """
    located = [n for n in nodes if n["lat"] is not None and n["lon"] is not None]
    if len(located) < 2:
        return None, len(located), "unknown"
    max_km = max(
        haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) for a, b in combinations(located, 2)
    )
    assessment = "local" if max_km <= LOCAL_MAX_KM else "regional"
    return round(max_km, 1), len(located), assessment


def compute_prefix_collisions(
    identities: list[tuple[str, str | None, float | None, float | None]],
) -> list[dict]:
    """Group contacts by pubkey prefix at each width and report collisions.

    ``identities`` is a list of ``(public_key, name, lat, lon)``; public keys are
    assumed full-length lowercase hex and coordinates may be ``None``. Returns one
    dict per width in ``PREFIX_WIDTHS``, each with summary counts, a 256-entry
    first-byte ``matrix`` (see below), and the colliding groups (a prefix shared
    by two or more contacts), sorted by group size descending then prefix
    ascending. Nodes within a group are sorted by name (case-insensitive, ``None``
    first) then key, and each carries its ``lat``/``lon``. Each group also reports
    ``max_distance_km`` (farthest-apart located pair), ``located_count``, and an
    ``assessment`` of ``"local"``/``"regional"``/``"unknown"`` (see LOCAL_MAX_KM).

    ``matrix[b]`` (for first byte ``b`` in 0..255) is the size of the largest
    ``width``-byte prefix group among contacts whose key starts with byte ``b`` --
    the "worst collision within" that first-byte cell at this width (0 if no
    contact has that first byte). At width 1 this is just the count of contacts
    sharing the first byte. ``distinct_prefixes`` is the number of distinct
    ``width``-byte prefixes present, used against ``256**width`` for space usage.
    """
    total_nodes = len(identities)
    widths: list[dict] = []
    for width in PREFIX_WIDTHS:
        hexlen = width * 2
        buckets: dict[str, list[dict]] = defaultdict(list)
        for public_key, name, lat, lon in identities:
            # Treat exact (0, 0) "null island" coordinates as no location: they are
            # a placeholder for nodes that never advertised a position, and would
            # otherwise inflate every distance to thousands of km.
            if lat == 0.0 and lon == 0.0:
                lat, lon = None, None
            buckets[public_key[:hexlen]].append(
                {"name": name, "public_key": public_key, "lat": lat, "lon": lon}
            )
        matrix = [0] * 256
        groups: list[dict] = []
        colliding_nodes = 0
        for prefix, nodes in buckets.items():
            first_byte = int(prefix[:2], 16)
            if len(nodes) > matrix[first_byte]:
                matrix[first_byte] = len(nodes)
            if len(nodes) < 2:
                continue
            colliding_nodes += len(nodes)
            nodes_sorted = sorted(nodes, key=lambda n: ((n["name"] or "").lower(), n["public_key"]))
            max_km, located_count, assessment = _distance_assessment(nodes_sorted)
            groups.append(
                {
                    "prefix": prefix,
                    "count": len(nodes),
                    "max_distance_km": max_km,
                    "located_count": located_count,
                    "assessment": assessment,
                    "nodes": nodes_sorted,
                }
            )
        groups.sort(key=lambda g: (-g["count"], g["prefix"]))
        widths.append(
            {
                "width": width,
                "total_nodes": total_nodes,
                "distinct_prefixes": len(buckets),
                "colliding_prefixes": len(groups),
                "colliding_nodes": colliding_nodes,
                "matrix": matrix,
                "groups": groups,
            }
        )
    return widths
