"""DB-computed Raw Packet Feed breakdowns over a historical time range.

Mirrors the label vocabulary and bucketing of the in-memory snapshot builder
(``frontend/src/utils/rawPacketStats.ts``) so the frontend can render the same
cards from persisted ``raw_packets`` columns for long ranges. Breakdowns that
depend on decryption (neighbor identity, decoded sender names) are intentionally
omitted; those stay live-only.
"""

from app.database import db

# Backend PayloadType.name -> frontend label (Utils.getPayloadTypeName vocabulary).
_PAYLOAD_LABELS = {
    "REQUEST": "Request",
    "RESPONSE": "Response",
    "TEXT_MESSAGE": "TextMessage",
    "ACK": "Ack",
    "ADVERT": "Advert",
    "GROUP_TEXT": "GroupText",
    "GROUP_DATA": "GroupData",
    "ANON_REQUEST": "AnonRequest",
    "PATH": "Path",
    "TRACE": "Trace",
    "MULTIPART": "Multipart",
    "CONTROL": "Control",
    "RAW_CUSTOM": "RawCustom",
}

_HOP_BYTE_WIDTH_LABELS = {
    0: "No path",
    1: "1 byte / hop",
    2: "2 bytes / hop",
    3: "3 bytes / hop",
}

# Fixed display order for the hop-count profile buckets.
_HOP_PROFILE_ORDER = ["0", "1", "2-5", "6-10", "11-15", "16-20", "21-31", "32+"]


def payload_label(backend_name: str | None) -> str:
    if not backend_name:
        return "Unknown"
    return _PAYLOAD_LABELS.get(backend_name, "Unknown")


def hop_profile_bucket(hop_count: int) -> str:
    if hop_count <= 0:
        return "0"
    if hop_count == 1:
        return "1"
    if hop_count <= 5:
        return "2-5"
    if hop_count <= 10:
        return "6-10"
    if hop_count <= 15:
        return "11-15"
    if hop_count <= 20:
        return "16-20"
    if hop_count <= 31:
        return "21-31"
    return "32+"


def hop_byte_width_label(width: int | None) -> str:
    if width is None:
        return "Unknown width"
    return _HOP_BYTE_WIDTH_LABELS.get(width, "Unknown width")


def _ranked(counts: dict[str, int], total: int) -> list[dict]:
    """Count desc, then label asc; share relative to ``total``."""
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [
        {"label": label, "count": count, "share": (count / total if total > 0 else 0.0)}
        for label, count in items
    ]


def _ordered(counts: dict[str, int], order: list[str], total: int) -> list[dict]:
    return [
        {
            "label": label,
            "count": counts.get(label, 0),
            "share": (counts.get(label, 0) / total if total > 0 else 0.0),
        }
        for label in order
    ]


async def compute_raw_feed_stats(start_ts: int, end_ts: int) -> dict:
    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN message_id IS NOT NULL THEN 1 ELSE 0 END) AS decrypted,
                SUM(CASE WHEN hop_count > 0 THEN 1 ELSE 0 END) AS path_bearing,
                COUNT(DISTINCT CASE WHEN path_signature IS NOT NULL THEN path_signature END)
                    AS distinct_paths,
                AVG(rssi) AS avg_rssi,
                MAX(rssi) AS best_rssi,
                COUNT(rssi) AS rssi_total,
                SUM(CASE WHEN rssi > -70 THEN 1 ELSE 0 END) AS rssi_strong,
                SUM(CASE WHEN rssi <= -70 AND rssi >= -85 THEN 1 ELSE 0 END) AS rssi_okay,
                SUM(CASE WHEN rssi < -85 THEN 1 ELSE 0 END) AS rssi_weak
            FROM raw_packets
            WHERE timestamp >= ? AND timestamp < ?
            """,
            (start_ts, end_ts),
        ) as cur:
            agg = await cur.fetchone()

        total = int((agg["total"] if agg else 0) or 0)
        decrypted = int((agg["decrypted"] if agg else 0) or 0)
        path_bearing = int((agg["path_bearing"] if agg else 0) or 0)
        distinct_paths = int((agg["distinct_paths"] if agg else 0) or 0)

        payload_counts: dict[str, int] = {}
        async with conn.execute(
            "SELECT payload_type, COUNT(*) AS c FROM raw_packets "
            "WHERE timestamp >= ? AND timestamp < ? GROUP BY payload_type",
            (start_ts, end_ts),
        ) as cur:
            for r in await cur.fetchall():
                label = payload_label(r["payload_type"])
                payload_counts[label] = payload_counts.get(label, 0) + r["c"]

        route_counts: dict[str, int] = {}
        async with conn.execute(
            "SELECT route_type, COUNT(*) AS c FROM raw_packets "
            "WHERE timestamp >= ? AND timestamp < ? GROUP BY route_type",
            (start_ts, end_ts),
        ) as cur:
            for r in await cur.fetchall():
                label = r["route_type"] or "Unknown"
                route_counts[label] = route_counts.get(label, 0) + r["c"]

        hop_counts: dict[str, int] = {}
        async with conn.execute(
            "SELECT hop_count, COUNT(*) AS c FROM raw_packets "
            "WHERE timestamp >= ? AND timestamp < ? GROUP BY hop_count",
            (start_ts, end_ts),
        ) as cur:
            for r in await cur.fetchall():
                bucket = hop_profile_bucket(int(r["hop_count"] or 0))
                hop_counts[bucket] = hop_counts.get(bucket, 0) + r["c"]

        width_counts: dict[str, int] = {}
        async with conn.execute(
            "SELECT hop_byte_width, COUNT(*) AS c FROM raw_packets "
            "WHERE timestamp >= ? AND timestamp < ? GROUP BY hop_byte_width",
            (start_ts, end_ts),
        ) as cur:
            for r in await cur.fetchall():
                label = hop_byte_width_label(r["hop_byte_width"])
                width_counts[label] = width_counts.get(label, 0) + r["c"]

    rssi_total = int((agg["rssi_total"] if agg else 0) or 0)
    rssi_buckets_counts = {
        "Strong (>-70 dBm)": int((agg["rssi_strong"] if agg else 0) or 0),
        "Okay (-70 to -85 dBm)": int((agg["rssi_okay"] if agg else 0) or 0),
        "Weak (<-85 dBm)": int((agg["rssi_weak"] if agg else 0) or 0),
    }

    return {
        "packet_count": total,
        "decrypted_count": decrypted,
        "undecrypted_count": total - decrypted,
        "decrypt_rate": (decrypted / total if total > 0 else 0.0),
        "path_bearing_count": path_bearing,
        "path_bearing_rate": (path_bearing / total if total > 0 else 0.0),
        "distinct_paths": distinct_paths,
        "average_rssi": (float(agg["avg_rssi"]) if agg and agg["avg_rssi"] is not None else None),
        "best_rssi": (int(agg["best_rssi"]) if agg and agg["best_rssi"] is not None else None),
        "payload_breakdown": _ranked(payload_counts, total),
        "route_breakdown": _ranked(route_counts, total),
        "hop_profile": _ordered(hop_counts, _HOP_PROFILE_ORDER, total),
        "hop_byte_width_profile": _ranked(width_counts, total),
        "rssi_buckets": _ranked(rssi_buckets_counts, rssi_total),
    }
