"""Request-traffic aggregation for the Mesh Health "Requests" panel.

Single-node view: this aggregates REQUEST / ANON_REQUEST / RESPONSE packets this
node has actually heard over RF. It makes no answered/unanswered judgment, because
a RESPONSE routed back along a path this node is not on is never heard here.

The DB query is kept in ``RequestTrafficRepository``; the aggregation is a pure
function (``aggregate_request_traffic``) so it can be unit-tested without packets.
"""

from dataclasses import dataclass

from app.database import db
from app.decoder import PayloadType, RouteType, parse_packet


@dataclass
class ParsedRequestPacket:
    """A heard REQUEST/ANON_REQUEST/RESPONSE packet reduced to what the panel needs."""

    ts: int
    kind: str  # "request" | "anon_request" | "response"
    route: str | None  # "flood" | "direct" | None (unclassifiable)
    src_hash: str | None  # 1-byte hex; None for anon (ephemeral sender) and responses w/o payload
    dest_hash: str | None  # 1-byte hex


def _classify_route(route_type: RouteType) -> str | None:
    if route_type in (RouteType.FLOOD, RouteType.TRANSPORT_FLOOD):
        return "flood"
    if route_type in (RouteType.DIRECT, RouteType.TRANSPORT_DIRECT):
        return "direct"
    return None


def parse_request_row(timestamp: int, data: bytes) -> ParsedRequestPacket | None:
    """Parse a raw packet into a ParsedRequestPacket, or None if not a request/response.

    For REQUEST/RESPONSE the payload starts with dest_hash (byte 0) and src_hash
    (byte 1), each a 1-byte peer hash. ANON_REQUEST has an ephemeral sender, so
    byte 1 is not a stable peer hash and src_hash is left None.
    """
    info = parse_packet(data)
    if info is None:
        return None

    pt = info.payload_type
    if pt == PayloadType.REQUEST:
        kind = "request"
    elif pt == PayloadType.ANON_REQUEST:
        kind = "anon_request"
    elif pt == PayloadType.RESPONSE:
        kind = "response"
    else:
        return None

    route = _classify_route(info.route_type)
    payload = info.payload
    dest_hash: str | None = None
    src_hash: str | None = None
    if len(payload) >= 1:
        dest_hash = format(payload[0], "02x")
    if len(payload) >= 2 and kind != "anon_request":
        src_hash = format(payload[1], "02x")

    return ParsedRequestPacket(
        ts=timestamp, kind=kind, route=route, src_hash=src_hash, dest_hash=dest_hash
    )


def aggregate_request_traffic(
    packets: list[ParsedRequestPacket],
    start_ts: int,
    end_ts: int,
    bucket_count: int = 32,
    pair_limit: int = 20,
) -> dict:
    """Fold parsed packets into totals, a time-bucketed series, and top src->dest pairs.

    ``requests`` counts REQUEST + ANON_REQUEST; flood/direct splits apply to those
    requests. The pairs table covers standard REQUEST only (anon has no stable src
    hash), and a pair needs both hashes present.
    """
    requests = anon_requests = responses = flood_requests = direct_requests = 0

    span = max(end_ts - start_ts, 1)
    width = span / bucket_count
    buckets = [{"flood": 0, "direct": 0, "responses": 0} for _ in range(bucket_count)]

    pairs: dict[tuple[str, str], dict] = {}

    for p in packets:
        idx = int((p.ts - start_ts) / width) if width > 0 else 0
        if idx < 0:
            idx = 0
        elif idx >= bucket_count:
            idx = bucket_count - 1

        if p.kind == "response":
            responses += 1
            buckets[idx]["responses"] += 1
            continue

        # request or anon_request
        requests += 1
        if p.kind == "anon_request":
            anon_requests += 1
        if p.route == "flood":
            flood_requests += 1
            buckets[idx]["flood"] += 1
        elif p.route == "direct":
            direct_requests += 1
            buckets[idx]["direct"] += 1

        if p.kind == "request" and p.src_hash is not None and p.dest_hash is not None:
            key = (p.src_hash, p.dest_hash)
            rec = pairs.get(key)
            if rec is None:
                rec = {
                    "src_hash": p.src_hash,
                    "dest_hash": p.dest_hash,
                    "requests": 0,
                    "flood": 0,
                    "direct": 0,
                    "last_ts": 0,
                }
                pairs[key] = rec
            rec["requests"] += 1
            if p.route == "flood":
                rec["flood"] += 1
            elif p.route == "direct":
                rec["direct"] += 1
            if p.ts > rec["last_ts"]:
                rec["last_ts"] = p.ts

    series = [
        {
            "bucket_ts": int(start_ts + i * width),
            "flood": b["flood"],
            "direct": b["direct"],
            "responses": b["responses"],
        }
        for i, b in enumerate(buckets)
    ]

    top_pairs = sorted(pairs.values(), key=lambda r: r["requests"], reverse=True)[:pair_limit]

    return {
        "totals": {
            "requests": requests,
            "anon_requests": anon_requests,
            "responses": responses,
            "flood_requests": flood_requests,
            "direct_requests": direct_requests,
        },
        "series": series,
        "pairs": top_pairs,
    }


class RequestTrafficRepository:
    @staticmethod
    async def window_packets(start_ts: int, end_ts: int) -> list[ParsedRequestPacket]:
        """Fetch and parse REQUEST/ANON_REQUEST/RESPONSE packets heard in the window."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT timestamp, data FROM raw_packets
                WHERE payload_type IN ('REQUEST', 'ANON_REQUEST', 'RESPONSE')
                  AND timestamp >= :start_ts AND timestamp <= :end_ts
                ORDER BY timestamp ASC
                """,
                {"start_ts": start_ts, "end_ts": end_ts},
            ) as cur:
                rows = await cur.fetchall()

        out: list[ParsedRequestPacket] = []
        for row in rows:
            parsed = parse_request_row(int(row["timestamp"]), bytes(row["data"]))
            if parsed is not None:
                out.append(parsed)
        return out
