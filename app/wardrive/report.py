"""Wardrive reports from the local copy, for three readers: a driver looking
back on their own drives, an organisation asking how well its area is
covered, and someone asking for a node who needs the evidence (where
coverage is weak or missing, which nodes are heard where and how well).

One pure builder over the rows in scope; the report endpoint and the exports
both use it. Cells are CoreScope's hex grid (``hexgrid``)."""

import math
import statistics
from collections.abc import Iterable
from typing import Any, Literal

from app.decoder import parse_advertisement, parse_packet, verify_advert_signature
from app.wardrive import hexgrid

REPORT_MAX_ROWS = 200000
MAX_POINTS = 5000
MAX_TRACK_POINTS = 2000
MAX_TOTAL_TRACK_POINTS = 20000
MAX_REPORT_CELLS = 20000
MAX_WEAK_CELLS = 200
TOP_CELLS = 5
NEARBY_NODES = 3
# A 1-byte id is named only by a node with that prefix this close to where
# it was heard (the page's reach cap at 868 MHz).
REACH_CAP_M = 15000
ADVERT = 4
TRACE = 9

Band = Literal["strong", "fair", "weak", "none"]


def trim_to_common_window(
    obs: list[dict[str, Any]], tracks: list[dict[str, Any]], limit: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int | None]:
    """Receptions and track rows are each cut to their newest ``limit`` on
    their own, so after a cut they can cover different time ranges, and cells
    driven before the oldest kept reception would read as gaps. When a list
    hit the limit, keep only the time both cover. Returns (obs, tracks, the
    cut in unix seconds or None)."""
    floors = []
    if len(obs) >= limit and obs:
        floors.append(min(o["rx_ts"] for o in obs))
    if len(tracks) >= limit and tracks:
        floors.append(min(t["t0_ts"] for t in tracks))
    if not floors:
        return obs, tracks, None
    cut = max(floors)
    return (
        [o for o in obs if o["rx_ts"] >= cut],
        [t for t in tracks if t["t0_ts"] >= cut],
        cut,
    )


def band(rssi: float | None) -> Band:
    """The page's signal tiers folded in three: strong is hot and warm
    (-90 dBm and up), fair is mid and cool (-110 to -90), weak is below."""
    if rssi is None:
        return "none"
    if rssi >= -90:
        return "strong"
    if rssi >= -110:
        return "fair"
    return "weak"


def heard_id(row: dict[str, Any]) -> tuple[str, bool] | None:
    """Who a reception heard, as rx attributes it: the last relay of a flood
    with hops, or the signer of a zero-hop advert with a valid signature.
    Returns (id lower hex, is a full key), or None (not attributed)."""
    path = row.get("path") or []
    if row.get("packet_type") == TRACE:
        return None
    if path:
        return (path[-1].lower(), False) if row.get("route") == "F" else None
    if row.get("packet_type") != ADVERT or not row.get("raw"):
        return None
    try:
        raw = bytes.fromhex(row["raw"])
    except ValueError:
        return None
    packet = parse_packet(raw)
    if packet is None or packet.path_length != 0:
        return None
    advert = parse_advertisement(packet.payload, raw)
    if advert is None or not verify_advert_signature(packet.payload):
        return None
    return advert.public_key.lower(), True


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(h))


def _median(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return round(statistics.median(vals), 1) if vals else None


def _sample(items: list[Any], limit: int) -> list[Any]:
    """At most ``limit`` items evenly spread, first and last kept."""
    if len(items) <= limit:
        return items
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


class _Names:
    """Names for heard ids from RTFM-EV's nodes (phase 2's rules): a full key
    by its node; a prefix only when every node with it has one name, marked
    as a guess at 3 bytes or shorter; a 1-byte id only through one node with
    that prefix within reach of where it was heard."""

    def __init__(self, nodes: list[dict[str, Any]]):
        self.by_key = {n["public_key"].lower(): n for n in nodes}
        self.nodes = list(self.by_key.values())

    def resolve(
        self, ident: str, full: bool, at: tuple[float, float] | None
    ) -> tuple[dict[str, Any] | None, str | None, bool]:
        """(node when one is known for sure, name, guess)."""
        if full:
            node = self.by_key.get(ident)
            return node, (node or {}).get("name"), False
        matches = [n for n in self.nodes if n["public_key"].startswith(ident)]
        if len(ident) <= 2:
            if at is None:
                return None, None, False
            matches = [
                n
                for n in matches
                if n.get("lat") is not None
                and _haversine_m(at[0], at[1], n["lat"], n["lon"]) <= REACH_CAP_M
            ]
            if len(matches) != 1:
                return None, None, False
            return matches[0], matches[0].get("name"), True
        names = {(n.get("name") or "").strip() for n in matches} - {""}
        if len(names) != 1:
            return None, None, False
        node = matches[0] if len(matches) == 1 else None
        return node, names.pop(), len(ident) <= 6


def _cell_out(
    cell_id: str, c: dict[str, Any], names: dict[str, tuple[str | None, bool]]
) -> dict[str, Any]:
    center = hexgrid.cell_center(cell_id) or (0.0, 0.0)
    best = c["best_node"]
    name, guess = names.get(best, (None, False)) if best else (None, False)
    return {
        "id": cell_id,
        "lat": center[0],
        "lon": center[1],
        "receptions": len(c["rssi"]),
        "rssi_best": c["rssi_best"],
        "rssi_median": _median(c["rssi"]),
        "band": band(c["rssi_best"]) if c["rssi"] else "none",
        "track_s": c["track_s"],
        "nodes": len(c["nodes"]),
        # The node heard best here, with its own best signal (not the cell's,
        # which may come from a reception tied to no node).
        "best_node": (
            {"id": best, "name": name, "guess": guess, "rssi": c["best_node_rssi"]}
            if best
            else None
        ),
        "first_ts": c["first_ts"],
    }


def build_report(
    obs: list[dict[str, Any]],
    tracks: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    res: int,
    truncated: bool,
    all_cells: bool = False,
) -> dict[str, Any]:
    """The report over these rows. The cells list is capped at
    ``MAX_REPORT_CELLS`` for the map and the cards; ``all_cells`` (the
    exports) keeps every cell."""
    obs = sorted(obs, key=lambda o: o["rx_ts"])
    tracks = sorted(tracks, key=lambda t: t["t0_ts"])

    # Summary: drives, people, time and distance.
    spans: dict[int, list[int]] = {}
    for o in obs:
        s = spans.setdefault(o["drive_id"], [o["rx_ts"], o["rx_ts"]])
        s[0], s[1] = min(s[0], o["rx_ts"]), max(s[1], o["rx_ts"])
    for t in tracks:
        end = t.get("t1_ts") or t["t0_ts"]
        s = spans.setdefault(t["drive_id"], [t["t0_ts"], end])
        s[0], s[1] = min(s[0], t["t0_ts"]), max(s[1], end)
    distance = 0.0
    by_drive: dict[int, list[dict[str, Any]]] = {}
    for t in tracks:
        by_drive.setdefault(t["drive_id"], []).append(t)
    for points in by_drive.values():
        for a, b in zip(points, points[1:], strict=False):
            distance += _haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])

    # Cells and nodes.
    cells: dict[str, dict[str, Any]] = {}

    def cell(lat: float, lon: float, ts: int) -> dict[str, Any]:
        cid = hexgrid.cell_at(lat, lon, res)
        c = cells.get(cid)
        if c is None:
            c = cells[cid] = {
                "rssi": [],
                "rssi_best": None,
                "best_node": None,
                "best_node_rssi": None,
                "track_s": 0,
                "nodes": set(),
                "first_ts": ts,
            }
        return c

    names = _Names(nodes)
    heard: dict[str, dict[str, Any]] = {}
    attributed = 0
    for o in obs:
        c = cell(o["lat"], o["lon"], o["rx_ts"])
        rssi = o.get("rssi")
        c["rssi"].append(rssi)
        if rssi is not None and (c["rssi_best"] is None or rssi > c["rssi_best"]):
            c["rssi_best"] = rssi
        who = heard_id(o)
        if who is None:
            continue
        attributed += 1
        ident, full = who
        c["nodes"].add(ident)
        if rssi is not None and (c["best_node_rssi"] is None or rssi > c["best_node_rssi"]):
            c["best_node"], c["best_node_rssi"] = ident, rssi
        h = heard.setdefault(
            ident, {"full": full, "rssi": [], "snr": [], "cells": set(), "at": [], "ts": []}
        )
        h["rssi"].append(rssi)
        h["snr"].append(o.get("snr"))
        h["cells"].add(hexgrid.cell_at(o["lat"], o["lon"], res))
        h["at"].append((o["lat"], o["lon"]))
        h["ts"].append(o["rx_ts"])
    for t in tracks:
        c = cell(t["lat"], t["lon"], t["t0_ts"])
        c["track_s"] += max(0, (t.get("t1_ts") or t["t0_ts"]) - t["t0_ts"])

    node_out: list[dict[str, Any]] = []
    shown_names: dict[str, tuple[str | None, bool]] = {}
    for ident, h in heard.items():
        mid = (
            statistics.median(a[0] for a in h["at"]),
            statistics.median(a[1] for a in h["at"]),
        )
        node, name, guess = names.resolve(ident, h["full"], mid)
        shown_names[ident] = (name, bool(guess and name))
        lat = node.get("lat") if node else None
        lon = node.get("lon") if node else None
        farthest = (
            round(max(_haversine_m(lat, lon, a[0], a[1]) for a in h["at"]))
            if lat is not None and lon is not None
            else None
        )
        rssi = [v for v in h["rssi"] if v is not None]
        node_out.append(
            {
                "id": ident,
                "full_key": h["full"],
                "name": name,
                "guess": guess if name else False,
                "role": node.get("role") if node else None,
                "receptions": len(h["rssi"]),
                "rssi_best": max(rssi) if rssi else None,
                "rssi_median": _median(rssi),
                "rssi_worst": min(rssi) if rssi else None,
                "snr_median": _median(h["snr"]),
                "cells": len(h["cells"]),
                "first_ts": min(h["ts"]),
                "last_ts": max(h["ts"]),
                "lat": lat,
                "lon": lon,
                "farthest_m": farthest,
            }
        )
    node_out.sort(key=lambda n: (-n["receptions"], n["id"]))

    cell_out = {cid: _cell_out(cid, c, shown_names) for cid, c in cells.items()}
    covered = [c for c in cell_out.values() if c["receptions"] > 0]
    ranked = [c for c in covered if c["rssi_best"] is not None]
    cell_bands = {"strong": 0, "fair": 0, "weak": 0}
    for c in ranked:
        cell_bands[c["band"]] += 1

    weak_cells = [c for c in cell_out.values() if c["receptions"] == 0 or c["band"] == "weak"]
    weak_cells.sort(key=lambda c: (-c["track_s"], c["id"]))
    weak_out = []
    for c in weak_cells[:MAX_WEAK_CELLS]:
        near: dict[str, dict[str, Any]] = {}
        for nb in hexgrid.neighbours(c["id"]):
            other = cell_out.get(nb)
            best = other["best_node"] if other else None
            if best is None or best["rssi"] is None:
                continue
            ident = best["id"]
            if ident not in near or best["rssi"] > near[ident]["rssi_best"]:
                near[ident] = {
                    "id": ident,
                    "name": best["name"],
                    "guess": best["guess"],
                    "rssi_best": best["rssi"],
                }
        nearby = sorted(near.values(), key=lambda n: (-n["rssi_best"], n["id"]))
        weak_out.append({**c, "nearby": nearby[:NEARBY_NODES]})

    # Track points per drive within one total, so many drives stay drawable.
    per_drive = max(2, min(MAX_TRACK_POINTS, MAX_TOTAL_TRACK_POINTS // max(1, len(by_drive))))
    rssi_all = [o["rssi"] for o in obs if o.get("rssi") is not None]
    bands = {"strong": 0, "fair": 0, "weak": 0, "none": 0}
    for o in obs:
        bands[band(o.get("rssi"))] += 1
    times = [o["rx_ts"] for o in obs] + [t["t0_ts"] for t in tracks]
    times += [t.get("t1_ts") or t["t0_ts"] for t in tracks]

    return {
        "truncated": truncated,
        "summary": {
            "drives": len(spans),
            "drivers": len({r["user_id"] for r in [*obs, *tracks]}),
            "radios": len({r["radio_key"] for r in [*obs, *tracks]}),
            "first_ts": min(times) if times else None,
            "last_ts": max(times) if times else None,
            "drive_seconds": sum(e - s for s, e in spans.values()),
            "distance_m": round(distance),
            "receptions": len(obs),
            "attributed": attributed,
            "nodes_heard": len(heard),
            "rssi_best": max(rssi_all) if rssi_all else None,
            "rssi_median": _median(rssi_all),
            "rssi_worst": min(rssi_all) if rssi_all else None,
            "snr_median": _median(o.get("snr") for o in obs),
            "bands": bands,
        },
        "coverage": {
            "cells_driven": len(cell_out),
            "cells_covered": len(covered),
            "covered_share": len(covered) / len(cell_out) if cell_out else None,
            "cell_bands": cell_bands,
            "strongest": sorted(ranked, key=lambda c: (-c["rssi_best"], c["id"]))[:TOP_CELLS],
            "weakest": sorted(ranked, key=lambda c: (c["rssi_best"], c["id"]))[:TOP_CELLS],
        },
        "weak_spots": {
            "gaps": sum(1 for c in cell_out.values() if c["receptions"] == 0),
            "weak": sum(1 for c in covered if c["band"] == "weak"),
            "total": len(weak_cells),
            "cells": weak_out,
        },
        "nodes": node_out,
        # For the map and the cards; the cells export lists them all.
        "cells": sorted(cell_out.values(), key=lambda c: (c["first_ts"], c["id"]))[
            : None if all_cells else MAX_REPORT_CELLS
        ],
        "tracks": [
            {
                "drive_id": drive_id,
                "points": _sample([[t["lon"], t["lat"], t["t0_ts"]] for t in pts], per_drive),
            }
            for drive_id, pts in sorted(by_drive.items())
        ],
        "points": _sample(
            [
                {"lat": o["lat"], "lon": o["lon"], "rssi": o.get("rssi"), "ts": o["rx_ts"]}
                for o in obs
            ],
            MAX_POINTS,
        ),
    }
