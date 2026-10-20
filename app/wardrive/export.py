"""Wardrive exports from the rows a report covers: receptions and cells as
CSV, everything as GeoJSON, the tracks as GPX. Pure text builders."""

import csv
import io
import re
from datetime import UTC, datetime
from typing import Any
from xml.sax.saxutils import escape, quoteattr

from app.wardrive import hexgrid
from app.wardrive.report import heard_id

RECEPTION_COLUMNS = [
    "time_utc",
    "driver",
    "radio_key",
    "drive_id",
    "lat",
    "lon",
    "accuracy_m",
    "rssi",
    "snr",
    "packet_type",
    "route",
    "hops",
    "heard_id",
    "heard_name",
    "heard_name_guess",
    "hash",
]
CELL_COLUMNS = [
    "cell",
    "lat",
    "lon",
    "receptions",
    "rssi_best",
    "rssi_median",
    "band",
    "track_s",
    "nodes",
    "best_node_id",
    "best_node_name",
    "best_node_guess",
    "best_node_rssi",
]

_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")
# Not allowed in XML 1.0, not even escaped.
_XML_INVALID = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ufffe\uffff]")
TRUNCATED_NOTE = "Truncated: the report hit its row limit, so the oldest rows are left out."


def utc(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_cell(value: str) -> str:
    """A text a spreadsheet would run as a formula gets a leading quote; a
    plain number (a negative RSSI) is left as it is."""
    if value and value[0] in "=+-@\t\r" and not _NUMBER.match(value):
        return "'" + value
    return value


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return safe_cell(str(value))


def _csv(header: list[str], lines: list[list[Any]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    for line in lines:
        writer.writerow([_text(v) for v in line])
    return out.getvalue()


# Per heard id: (name, guessed). A guessed name came from a short id (3 bytes
# or less); the report marks it with "~".
Names = dict[str, tuple[str | None, bool]]


def _heard(row: dict[str, Any], names: Names) -> tuple[str | None, str | None, bool]:
    who = heard_id(row)
    if not who:
        return None, None, False
    name, guess = names.get(who[0], (None, False))
    return who[0], name, bool(name and guess)


def receptions_csv(obs: list[dict[str, Any]], names: Names) -> str:
    lines = []
    for o in sorted(obs, key=lambda r: r["rx_ts"]):
        ident, name, guess = _heard(o, names)
        lines.append(
            [
                utc(o["rx_ts"]),
                o.get("username"),
                o["radio_key"],
                o["drive_id"],
                o["lat"],
                o["lon"],
                o.get("accuracy"),
                o.get("rssi"),
                o.get("snr"),
                o.get("packet_type"),
                o.get("route"),
                len(o.get("path") or []),
                ident,
                name,
                "yes" if guess else "no",
                o.get("hash"),
            ]
        )
    return _csv(RECEPTION_COLUMNS, lines)


def cells_csv(report: dict[str, Any]) -> str:
    lines = []
    for c in report["cells"]:
        best = c["best_node"] or {}
        lines.append(
            [
                c["id"],
                round(c["lat"], 6),
                round(c["lon"], 6),
                c["receptions"],
                c["rssi_best"],
                c["rssi_median"],
                c["band"],
                c["track_s"],
                c["nodes"],
                best.get("id"),
                best.get("name"),
                ("yes" if best.get("guess") else "no") if best else None,
                best.get("rssi"),
            ]
        )
    return _csv(CELL_COLUMNS, lines)


def geojson(
    obs: list[dict[str, Any]],
    tracks: list[dict[str, Any]],
    report: dict[str, Any],
    names: Names,
    drive_names: dict[int, str | None],
    truncated: bool = False,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for o in sorted(obs, key=lambda r: r["rx_ts"]):
        ident, name, guess = _heard(o, names)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [o["lon"], o["lat"]]},
                "properties": {
                    "kind": "reception",
                    "time_utc": utc(o["rx_ts"]),
                    "driver": o.get("username"),
                    "radio_key": o["radio_key"],
                    "drive_id": o["drive_id"],
                    "accuracy_m": o.get("accuracy"),
                    "rssi": o.get("rssi"),
                    "snr": o.get("snr"),
                    "packet_type": o.get("packet_type"),
                    "route": o.get("route"),
                    "hops": len(o.get("path") or []),
                    "heard_id": ident,
                    "heard_name": name,
                    "heard_name_guess": guess,
                    "hash": o.get("hash"),
                },
            }
        )
    by_drive: dict[int, list[dict[str, Any]]] = {}
    for t in sorted(tracks, key=lambda r: r["t0_ts"]):
        by_drive.setdefault(t["drive_id"], []).append(t)
    for drive_id, points in sorted(by_drive.items()):
        if len(points) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[p["lon"], p["lat"]] for p in points],
                },
                "properties": {
                    "kind": "track",
                    "drive_id": drive_id,
                    "name": drive_names.get(drive_id),
                    "start_utc": utc(points[0]["t0_ts"]),
                    "end_utc": utc(points[-1]["t1_ts"] or points[-1]["t0_ts"]),
                },
            }
        )
    for c in report["cells"]:
        ring = hexgrid.cell_ring(c["id"])
        if ring is None:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring]]},
                "properties": {
                    "kind": "cell",
                    **{k: v for k, v in c.items() if k != "id"},
                    "cell": c["id"],
                },
            }
        )
    out: dict[str, Any] = {"type": "FeatureCollection", "features": features}
    if truncated:
        out["truncated"] = True
    return out


def gpx(
    tracks: list[dict[str, Any]], drive_names: dict[int, str | None], truncated: bool = False
) -> str:
    """GPX 1.1: one track per drive, its points in time order. A point's time
    is its fix's (``t1``: a track row's position is where it ended)."""
    by_drive: dict[int, list[dict[str, Any]]] = {}
    for t in sorted(tracks, key=lambda r: r["t0_ts"]):
        by_drive.setdefault(t["drive_id"], []).append(t)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="RTFM-EV" xmlns="http://www.topografix.com/GPX/1/1">',
    ]
    if truncated:
        parts.append(f"<metadata><desc>{escape(TRUNCATED_NOTE)}</desc></metadata>")
    for drive_id, points in sorted(by_drive.items()):
        name = _XML_INVALID.sub("", drive_names.get(drive_id) or "") or utc(points[0]["t0_ts"])
        parts.append(f"<trk><name>{escape(name)}</name><trkseg>")
        for p in points:
            parts.append(
                f"<trkpt lat={quoteattr(str(p['lat']))} lon={quoteattr(str(p['lon']))}>"
                f"<time>{utc(p.get('t1_ts') or p['t0_ts'])}</time></trkpt>"
            )
        parts.append("</trkseg></trk>")
    parts.append("</gpx>")
    return "\n".join(parts) + "\n"
