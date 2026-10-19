"""DB-computed Raw Packet Feed breakdowns over a historical time range.

Mirrors the label vocabulary and bucketing of the in-memory snapshot builder
(``frontend/src/utils/rawPacketStats.ts``) so the frontend can render the same
cards from persisted ``raw_packets`` columns for long ranges. Sources and
neighbors are read the way the live windows read them: the stored message of a
decrypted packet gives its sender, the packet bytes give an advert's or anon
request's public key and an undecrypted direct message's source hash.

A packet is stored once (``payload_hash`` is unique), so these count packets,
where the live windows count every time a packet was heard.
"""

from collections.abc import Iterable

from app.database import db
from app.decoder import OTHER_VERSION_PAYLOAD_TYPE

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
    OTHER_VERSION_PAYLOAD_TYPE: "OtherVersion",
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


TIMELINE_BINS = 10
NEIGHBOR_LIST_SIZE = 5
# Payload types whose packet bytes name a source when no message was stored.
_SOURCE_TYPES = ("ADVERT", "ANON_REQUEST", "TEXT_MESSAGE", "REQUEST", "RESPONSE")

# Where the payload starts in ``data`` (1-based, for substr): the header byte,
# the transport codes of a transport route, the path byte, then the path. The
# stored route and path columns come from the parser at ingest, which also
# stored ``payload_type`` only when the packet parsed.
_PAYLOAD_AT = (
    "(3 + CASE WHEN rp.route_type IN ('TransportFlood', 'TransportDirect') THEN 4 ELSE 0 END"
    " + rp.hop_count * rp.hop_byte_width)"
)

# Who sent each packet, grouped per sender. Mirrors ``getSourceInfo`` in
# ``frontend/src/utils/rawPacketStats.ts``: a stored message names its sender;
# otherwise an advert carries its public key (payload bytes 0-31, of at least
# 101), an anon request the sender's key after the destination hash, and an
# undecrypted direct message or request its source hash (payload byte 1).
# Grouping here, not in Python, keeps a month of packets fast.
_SOURCES_SQL = f"""
    SELECT key, MAX(label) AS label, COUNT(*) AS count, MAX(rssi) AS best_rssi,
           MAX(timestamp) AS last_seen
    FROM (
        SELECT rp.timestamp, rp.rssi, m.sender_name AS label,
            CASE
                WHEN m.id IS NOT NULL THEN CASE
                    WHEN m.type = 'CHAN' AND COALESCE(m.sender_key, '') <> ''
                        THEN upper(m.sender_key)
                    WHEN m.type = 'CHAN' AND COALESCE(m.sender_name, '') <> ''
                        THEN 'name:' || m.sender_name
                    WHEN m.type <> 'CHAN' AND m.conversation_key <> ''
                        THEN upper(m.conversation_key)
                END
                WHEN rp.route_type IS NULL OR rp.route_type = 'Unknown' THEN NULL
                WHEN rp.payload_type = 'ADVERT' AND length(rp.data) >= {_PAYLOAD_AT} + 100
                    THEN hex(substr(rp.data, {_PAYLOAD_AT}, 32))
                WHEN rp.payload_type = 'ANON_REQUEST' AND length(rp.data) >= {_PAYLOAD_AT} + 32
                    THEN hex(substr(rp.data, {_PAYLOAD_AT} + 1, 32))
                WHEN rp.payload_type IN ('TEXT_MESSAGE', 'REQUEST', 'RESPONSE')
                    AND length(rp.data) >= {_PAYLOAD_AT} + 1
                    THEN 'hash1:' || hex(substr(rp.data, {_PAYLOAD_AT} + 1, 1))
            END AS key
        FROM raw_packets rp LEFT JOIN messages m ON m.id = rp.message_id
        WHERE rp.timestamp >= ? AND rp.timestamp < ?
            AND (rp.message_id IS NOT NULL
                 OR rp.payload_type IN ({", ".join(f"'{t}'" for t in _SOURCE_TYPES)}))
    )
    WHERE key IS NOT NULL
    GROUP BY key
"""


def summarize_sources(rows: Iterable) -> dict:
    """Unique sources and the three neighbor lists the live windows show.

    ``rows`` are per-sender groups from ``_SOURCES_SQL``. A name is matched
    without case, as in the live windows, so groups that differ only in case
    are merged here (SQLite's ``lower`` only folds ASCII).
    """
    neighbors: dict[str, dict] = {}
    for row in rows:
        key, label = row["key"], row["label"]
        if key.startswith("name:"):
            label = key[5:]
            key = f"name:{label.lower()}"
        elif not label:
            label = key[6:] if key.startswith("hash1:") else key[:12]
        found = neighbors.get(key)
        if found is None:
            neighbors[key] = {
                "key": key,
                "label": label,
                "count": row["count"],
                "best_rssi": row["best_rssi"],
                "last_seen": row["last_seen"],
            }
            continue
        found["count"] += row["count"]
        found["last_seen"] = max(found["last_seen"], row["last_seen"])
        if row["best_rssi"] is not None and (
            found["best_rssi"] is None or row["best_rssi"] > found["best_rssi"]
        ):
            found["best_rssi"] = row["best_rssi"]
    items = list(neighbors.values())
    strongest = sorted(
        (n for n in items if n["best_rssi"] is not None),
        key=lambda n: (-n["best_rssi"], -n["count"], n["label"]),
    )
    return {
        "unique_sources": len(items),
        "strongest_neighbors": strongest[:NEIGHBOR_LIST_SIZE],
        "most_active_neighbors": sorted(
            items, key=lambda n: (-n["count"], -n["last_seen"], n["label"])
        )[:NEIGHBOR_LIST_SIZE],
        "newest_neighbors": sorted(items, key=lambda n: (-n["last_seen"], -n["count"], n["label"]))[
            :NEIGHBOR_LIST_SIZE
        ],
    }


def timeline_bin_width(start_ts: int, end_ts: int) -> float:
    """Seconds per bin; the same ten bins over at least a minute as the live chart."""
    return max(1.0, max(end_ts - start_ts, 60) / TIMELINE_BINS)


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
        median_rssi: float | None = None
        if rssi_total > 0:
            # The middle value, or the two middle values of an even count.
            async with conn.execute(
                "SELECT rssi FROM raw_packets "
                "WHERE timestamp >= ? AND timestamp < ? AND rssi IS NOT NULL "
                "ORDER BY rssi LIMIT ? OFFSET ?",
                (start_ts, end_ts, 2 - rssi_total % 2, (rssi_total - 1) // 2),
            ) as cur:
                middle = [r["rssi"] for r in await cur.fetchall()]
            if middle:
                median_rssi = sum(middle) / len(middle)

        bin_width = timeline_bin_width(start_ts, end_ts)
        timeline = [
            {"start_ts": int(start_ts + i * bin_width), "total": 0, "counts_by_type": {}}
            for i in range(TIMELINE_BINS)
        ]
        async with conn.execute(
            "SELECT CAST((timestamp - ?) / ? AS INTEGER) AS bin, payload_type, COUNT(*) AS c "
            "FROM raw_packets WHERE timestamp >= ? AND timestamp < ? "
            "GROUP BY bin, payload_type",
            (start_ts, bin_width, start_ts, end_ts),
        ) as cur:
            for r in await cur.fetchall():
                entry = timeline[max(0, min(TIMELINE_BINS - 1, int(r["bin"])))]
                label = payload_label(r["payload_type"])
                entry["total"] += r["c"]
                entry["counts_by_type"][label] = entry["counts_by_type"].get(label, 0) + r["c"]

        async with conn.execute(_SOURCES_SQL, (start_ts, end_ts)) as cur:
            source_rows = await cur.fetchall()

    sources = summarize_sources(source_rows)
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
        "median_rssi": median_rssi,
        "timeline": timeline,
        **sources,
    }
