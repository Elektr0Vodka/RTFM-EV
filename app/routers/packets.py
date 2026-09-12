import logging
import time
from hashlib import sha256
from sqlite3 import OperationalError

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.database import db
from app.decoder import parse_packet, try_decrypt_packet_with_channel_key
from app.models import RawPacketDecryptedInfo, RawPacketDetail
from app.packet_processor import create_message_from_decrypted, run_historical_dm_decryption
from app.region_resolver import resolve_region
from app.repository import (
    AdvertEventRepository,
    AppSettingsRepository,
    ChannelRepository,
    ContactRepository,
    MessageRepository,
    RawPacketRepository,
)
from app.services.messages import backfill_message_regions
from app.websocket import broadcast_success

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/packets", tags=["packets"])


class DecryptRequest(BaseModel):
    key_type: str = Field(description="Type of key: 'channel' or 'contact'")
    channel_key: str | None = Field(
        default=None, description="Channel key as hex (16 bytes = 32 chars)"
    )
    channel_name: str | None = Field(
        default=None, description="Channel name (for hashtag channels, key derived from name)"
    )
    # Fields for contact (DM) decryption
    private_key: str | None = Field(
        default=None,
        description="Our private key as hex (64 bytes = 128 chars, Ed25519 seed + pubkey)",
    )
    contact_public_key: str | None = Field(
        default=None, description="Contact's public key as hex (32 bytes = 64 chars)"
    )


class DecryptResult(BaseModel):
    started: bool
    total_packets: int
    message: str


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _run_historical_channel_decryption(
    channel_key_bytes: bytes, channel_key_hex: str, display_name: str | None = None
) -> None:
    """Background task to decrypt historical packets with a channel key."""
    total = await RawPacketRepository.get_undecrypted_count()
    decrypted_count = 0

    if total == 0:
        logger.info("No undecrypted packets to process")
        return

    logger.info("Starting historical channel decryption of %d packets", total)

    known_regions = (await AppSettingsRepository.get()).known_regions

    async for (
        packet_id,
        packet_data,
        packet_timestamp,
    ) in RawPacketRepository.stream_all_undecrypted():
        result = try_decrypt_packet_with_channel_key(packet_data, channel_key_bytes)

        if result is not None:
            # Extract path from the raw packet for storage
            packet_info = parse_packet(packet_data)
            path_hex = packet_info.path.hex() if packet_info else None

            # Resolve regional flood-scope if this is a transport-routed packet.
            transport_code: int | None = None
            region: str | None = None
            if packet_info is not None and packet_info.transport_codes is not None:
                transport_code = packet_info.transport_codes[0]
                region = resolve_region(
                    int(packet_info.payload_type),
                    packet_info.payload,
                    transport_code,
                    known_regions,
                )

            msg_id = await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key=channel_key_hex,
                channel_name=display_name,
                sender=result.sender,
                message_text=result.message,
                timestamp=result.timestamp,
                received_at=packet_timestamp,
                path=path_hex,
                path_len=packet_info.path_length if packet_info else None,
                realtime=False,  # Historical decryption should not trigger fanout
                transport_code=transport_code,
                region=region,
            )

            if msg_id is not None:
                decrypted_count += 1

    logger.info(
        "Historical channel decryption complete: %d/%d packets decrypted", decrypted_count, total
    )

    # Notify frontend
    if decrypted_count > 0:
        name = display_name or channel_key_hex[:12]
        broadcast_success(
            f"Historical decrypt complete for {name}",
            f"Decrypted {decrypted_count} message{'s' if decrypted_count != 1 else ''}",
        )


@router.get("/undecrypted/count")
async def get_undecrypted_count() -> dict:
    """Get the count of undecrypted packets."""
    count = await RawPacketRepository.get_undecrypted_count()
    return {"count": count}


@router.post("/region-backfill")
async def backfill_regions() -> dict:
    """Re-resolve region scope for stored channel messages that still have a raw packet.

    Region tagging normally happens at ingest, so messages stored before the feature
    (or before a region name was added to ``known_regions``) have no region. This
    recomputes them. Messages whose raw packet was already purged cannot be
    re-evaluated. Clients should refetch the conversation to see updated badges.
    """
    known_regions = (await AppSettingsRepository.get()).known_regions
    return await backfill_message_regions(known_regions)


# NOTE: literal-path GET routes (/recent, /timeseries, /historical-stats,
# /undecrypted/count) MUST be declared before the "/{packet_id}" route below,
# or FastAPI matches them as a packet_id and returns 422.


@router.get("/recent")
async def get_recent_packets(
    limit: int = 500,
    after_ts: int | None = None,
    before_ts: int | None = None,
) -> list[dict]:
    """Return recent raw packets, oldest-first, in the raw_packet broadcast shape.

    Lets the frontend seed the packet feed on mount / after reconnect without
    losing history.

    - limit: max packets to return (1-5000, default 500)
    - after_ts / before_ts: optional inclusive Unix-second bounds on timestamp
    """
    limit = min(max(1, limit), 5000)

    conditions: list[str] = []
    params: list[int] = []
    if after_ts is not None:
        conditions.append("timestamp >= ?")
        params.append(after_ts)
    if before_ts is not None:
        conditions.append("timestamp <= ?")
        params.append(before_ts)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    query = f"""
        SELECT id, timestamp, data, message_id, rssi, snr, payload_type
        FROM raw_packets
        {where}
        ORDER BY id DESC
        LIMIT ?
    """

    async with db.readonly() as conn:
        async with conn.execute(query, (*params, limit)) as cursor:
            rows = await cursor.fetchall()

    # Reverse so oldest-first for natural append order on the frontend.
    packets = []
    for row in reversed(list(rows)):
        packets.append(
            {
                "id": row["id"],
                # observation_id is not meaningful for historical rows — use id.
                "observation_id": row["id"],
                "timestamp": row["timestamp"],
                "data": bytes(row["data"]).hex(),
                "payload_type": row["payload_type"] or "Unknown",
                "snr": row["snr"],
                "rssi": row["rssi"],
                "decrypted": row["message_id"] is not None,
                "decrypted_info": None,
            }
        )

    return packets


class TimeseriesBin(BaseModel):
    start_ts: int
    packet_count: int
    byte_count: int
    avg_rssi: float | None = None
    avg_snr: float | None = None
    type_counts: dict[str, int] = Field(default_factory=dict)


class TimeseriesResponse(BaseModel):
    bins: list[TimeseriesBin]
    total_packets: int
    total_bytes: int
    start_ts: int
    end_ts: int
    bin_seconds: int
    has_signal_data: bool
    has_type_data: bool


@router.get("/timeseries", response_model=TimeseriesResponse)
async def get_packet_timeseries(
    start_ts: int,
    end_ts: int,
    bin_count: int = 40,
) -> TimeseriesResponse:
    """Return time-binned packet counts, byte totals, signal averages, and type
    breakdowns from raw_packets, for historical chart ranges.

    - start_ts / end_ts: Unix-second bounds (half-open ``[start_ts, end_ts)``)
    - bin_count: number of bars (1-200, default 40)
    """
    if end_ts <= start_ts:
        raise HTTPException(status_code=400, detail="end_ts must be greater than start_ts")
    if bin_count < 1 or bin_count > 200:
        raise HTTPException(status_code=400, detail="bin_count must be 1-200")

    bin_seconds = max(1, (end_ts - start_ts) // bin_count)

    async with db.readonly() as conn:
        # Group by bin AND payload_type to get type breakdown + signal averages.
        async with conn.execute(
            """
            SELECT
                (:start_ts + (timestamp - :start_ts) / :bin_seconds * :bin_seconds) AS bin_start,
                payload_type,
                COUNT(*) AS packet_count,
                SUM(LENGTH(data)) AS byte_count,
                AVG(rssi) AS avg_rssi,
                AVG(snr) AS avg_snr
            FROM raw_packets
            WHERE timestamp >= :start_ts AND timestamp < :end_ts
            GROUP BY bin_start, payload_type
            ORDER BY bin_start
            """,
            {"start_ts": start_ts, "end_ts": end_ts, "bin_seconds": bin_seconds},
        ) as cursor:
            rows = await cursor.fetchall()

    # Aggregate rows into bins (multiple rows per bin when grouped by payload_type).
    bin_map: dict[int, dict] = {}
    for row in rows:
        t = int(row["bin_start"])
        ptype = row["payload_type"]
        count = int(row["packet_count"])
        nbytes = int(row["byte_count"]) if row["byte_count"] else 0
        avg_rssi = float(row["avg_rssi"]) if row["avg_rssi"] is not None else None
        avg_snr = float(row["avg_snr"]) if row["avg_snr"] is not None else None

        b = bin_map.setdefault(
            t,
            {
                "packet_count": 0,
                "byte_count": 0,
                "rssi_sum": 0.0,
                "rssi_count": 0,
                "snr_sum": 0.0,
                "snr_count": 0,
                "type_counts": {},
            },
        )
        b["packet_count"] += count
        b["byte_count"] += nbytes
        if avg_rssi is not None:
            b["rssi_sum"] += avg_rssi * count
            b["rssi_count"] += count
        if avg_snr is not None:
            b["snr_sum"] += avg_snr * count
            b["snr_count"] += count
        if ptype:
            b["type_counts"][ptype] = b["type_counts"].get(ptype, 0) + count

    bins: list[TimeseriesBin] = []
    total_packets = 0
    total_bytes = 0
    has_signal_data = False
    has_type_data = False

    for i in range(bin_count):
        t = start_ts + i * bin_seconds
        b = bin_map.get(t)
        if b is None:
            bins.append(TimeseriesBin(start_ts=t, packet_count=0, byte_count=0))
            continue

        avg_rssi_out = b["rssi_sum"] / b["rssi_count"] if b["rssi_count"] else None
        avg_snr_out = b["snr_sum"] / b["snr_count"] if b["snr_count"] else None
        if avg_rssi_out is not None or avg_snr_out is not None:
            has_signal_data = True
        if b["type_counts"]:
            has_type_data = True

        bins.append(
            TimeseriesBin(
                start_ts=t,
                packet_count=b["packet_count"],
                byte_count=b["byte_count"],
                avg_rssi=avg_rssi_out,
                avg_snr=avg_snr_out,
                type_counts=b["type_counts"],
            )
        )
        total_packets += b["packet_count"]
        total_bytes += b["byte_count"]

    return TimeseriesResponse(
        bins=bins,
        total_packets=total_packets,
        total_bytes=total_bytes,
        start_ts=start_ts,
        end_ts=end_ts,
        bin_seconds=bin_seconds,
        has_signal_data=has_signal_data,
        has_type_data=has_type_data,
    )


class HistoricalNeighbor(BaseModel):
    public_key: str
    name: str | None
    heard_count: int
    first_seen: int | None
    last_seen: int | None
    lat: float | None
    lon: float | None
    min_path_len: int | None
    best_rssi: float | None = None


class HistoricalBusiestChannel(BaseModel):
    channel_key: str
    channel_name: str | None
    message_count: int


class HistoricalStatsResponse(BaseModel):
    start_ts: int
    end_ts: int
    total_packets: int
    total_bytes: int
    packets_per_minute: float
    avg_rssi: float | None
    avg_snr: float | None
    best_rssi: float | None
    type_counts: dict[str, int]
    has_signal_data: bool
    has_type_data: bool
    neighbors_by_count: list[HistoricalNeighbor]
    neighbors_by_signal: list[HistoricalNeighbor]
    busiest_channels: list[HistoricalBusiestChannel] = Field(default_factory=list)


@router.get("/historical-stats", response_model=HistoricalStatsResponse)
async def get_historical_stats(start_ts: int, end_ts: int) -> HistoricalStatsResponse:
    """Return DB-computed aggregate stats for a time window (My Node history).

    Packet/byte totals and rate, signal averages, payload-type breakdown, top
    neighbors (by heard count and by best signal, from contact_advert_paths),
    and the busiest channels in the window.
    """
    if end_ts <= start_ts:
        raise HTTPException(status_code=400, detail="end_ts must be greater than start_ts")

    duration_seconds = max(end_ts - start_ts, 1)

    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT COUNT(*) AS total_packets, SUM(LENGTH(data)) AS total_bytes
            FROM raw_packets
            WHERE timestamp >= ? AND timestamp < ?
            """,
            (start_ts, end_ts),
        ) as cur:
            row = await cur.fetchone()
            total_packets = int((row["total_packets"] if row else None) or 0)
            total_bytes = int((row["total_bytes"] if row else None) or 0)

        packets_per_minute = total_packets / max(duration_seconds / 60, 1 / 60)

        avg_rssi: float | None = None
        avg_snr: float | None = None
        best_rssi: float | None = None
        type_counts: dict[str, int] = {}
        has_signal_data = False
        has_type_data = False

        async with conn.execute(
            """
            SELECT AVG(rssi) AS avg_rssi, AVG(snr) AS avg_snr, MAX(rssi) AS best_rssi
            FROM raw_packets
            WHERE timestamp >= ? AND timestamp < ? AND rssi IS NOT NULL
            """,
            (start_ts, end_ts),
        ) as cur:
            row = await cur.fetchone()
            if row is not None and row["avg_rssi"] is not None:
                avg_rssi = float(row["avg_rssi"])
                avg_snr = float(row["avg_snr"]) if row["avg_snr"] is not None else None
                best_rssi = float(row["best_rssi"])
                has_signal_data = True

        async with conn.execute(
            """
            SELECT payload_type, COUNT(*) AS cnt
            FROM raw_packets
            WHERE timestamp >= ? AND timestamp < ? AND payload_type IS NOT NULL
            GROUP BY payload_type
            ORDER BY cnt DESC
            """,
            (start_ts, end_ts),
        ) as cur:
            rows = await cur.fetchall()
            if rows:
                type_counts = {row["payload_type"]: int(row["cnt"]) for row in rows}
                has_type_data = True

        # Top neighbors by total heard count (advert paths seen in the window).
        async with conn.execute(
            """
            SELECT
                c.public_key, c.name, c.last_seen, c.lat, c.lon,
                COALESCE(SUM(cap.heard_count), 0) AS heard_count,
                MIN(cap.first_seen) AS first_seen,
                MIN(cap.path_len) AS min_path_len,
                MAX(cap.best_rssi) AS best_rssi
            FROM contacts c
            LEFT JOIN contact_advert_paths cap ON cap.public_key = c.public_key
                AND cap.last_seen >= ? AND cap.last_seen < ?
                AND cap.path_len = 0
            WHERE c.last_seen >= ? AND c.last_seen < ?
            GROUP BY c.public_key
            HAVING heard_count > 0
            ORDER BY heard_count DESC
            LIMIT 50
            """,
            (start_ts, end_ts, start_ts, end_ts),
        ) as cur:
            rows = await cur.fetchall()
            neighbors_by_count = [
                HistoricalNeighbor(
                    public_key=row["public_key"],
                    name=row["name"],
                    heard_count=int(row["heard_count"]),
                    first_seen=row["first_seen"],
                    last_seen=row["last_seen"],
                    lat=row["lat"],
                    lon=row["lon"],
                    min_path_len=row["min_path_len"],
                    best_rssi=float(row["best_rssi"]) if row["best_rssi"] is not None else None,
                )
                for row in rows
            ]

        # Top neighbors by best stored advert-path signal.
        async with conn.execute(
            """
            SELECT
                c.public_key, c.name, c.last_seen, c.lat, c.lon,
                COALESCE(SUM(cap.heard_count), 0) AS heard_count,
                MAX(cap.best_rssi) AS best_rssi
            FROM contacts c
            JOIN contact_advert_paths cap ON cap.public_key = c.public_key
                AND cap.last_seen >= ? AND cap.last_seen < ?
                AND cap.best_rssi IS NOT NULL
                AND cap.path_len = 0
            WHERE c.last_seen >= ? AND c.last_seen < ?
            GROUP BY c.public_key
            HAVING heard_count > 0
            ORDER BY best_rssi DESC
            LIMIT 20
            """,
            (start_ts, end_ts, start_ts, end_ts),
        ) as cur:
            rows = await cur.fetchall()
            neighbors_by_signal = [
                HistoricalNeighbor(
                    public_key=row["public_key"],
                    name=row["name"],
                    heard_count=int(row["heard_count"]),
                    first_seen=None,
                    last_seen=row["last_seen"],
                    lat=row["lat"],
                    lon=row["lon"],
                    min_path_len=None,
                    best_rssi=float(row["best_rssi"]) if row["best_rssi"] is not None else None,
                )
                for row in rows
            ]

        async with conn.execute(
            """
            SELECT m.conversation_key, ch.name AS channel_name, COUNT(*) AS message_count
            FROM messages m
            LEFT JOIN channels ch ON ch.key = m.conversation_key
            WHERE m.type = 'CHAN' AND m.received_at >= ? AND m.received_at < ?
            GROUP BY m.conversation_key
            ORDER BY message_count DESC
            LIMIT 10
            """,
            (start_ts, end_ts),
        ) as cur:
            rows = await cur.fetchall()
            busiest_channels = [
                HistoricalBusiestChannel(
                    channel_key=row["conversation_key"],
                    channel_name=row["channel_name"],
                    message_count=int(row["message_count"]),
                )
                for row in rows
            ]

    return HistoricalStatsResponse(
        start_ts=start_ts,
        end_ts=end_ts,
        total_packets=total_packets,
        total_bytes=total_bytes,
        packets_per_minute=packets_per_minute,
        avg_rssi=avg_rssi,
        avg_snr=avg_snr,
        best_rssi=best_rssi,
        type_counts=type_counts,
        has_signal_data=has_signal_data,
        has_type_data=has_type_data,
        neighbors_by_count=neighbors_by_count,
        neighbors_by_signal=neighbors_by_signal,
        busiest_channels=busiest_channels,
    )


# Advert-count thresholds for mesh-health alerts (adverts per window).
MESH_HEALTH_HIGH_THRESHOLD = 8
MESH_HEALTH_MEDIUM_THRESHOLD = 2


class MeshHealthContact(BaseModel):
    public_key: str
    name: str | None
    advert_count: int
    direct_count: int = 0
    flood_count: int = 0
    first_seen: int | None
    last_seen: int | None
    lat: float | None
    lon: float | None
    min_path_len: int | None
    hash_mode: int | None = None


class MeshHealthAlert(BaseModel):
    level: str  # "HIGH" | "MEDIUM"
    public_key: str
    name: str | None
    advert_count: int
    adverts_per_hour: float


class MeshHealthResponse(BaseModel):
    start_ts: int
    end_ts: int
    window_hours: float
    total_contacts: int
    high_alert_count: int
    medium_alert_count: int
    high_advert_threshold: int
    medium_advert_threshold: int
    alerts: list[MeshHealthAlert]
    contacts: list[MeshHealthContact]


@router.get("/mesh-health", response_model=MeshHealthResponse)
async def get_mesh_health(start_ts: int, end_ts: int) -> MeshHealthResponse:
    """Advert-frequency health for all contacts heard in the window.

    Advert counts use ``last_primary_seen`` so relay copies are not counted as
    separate advert events. Contacts advertising too frequently are flagged
    HIGH (> 8/window) or MEDIUM (> 2/window).
    """
    if end_ts <= start_ts:
        raise HTTPException(status_code=400, detail="end_ts must be greater than start_ts")

    window_hours = (end_ts - start_ts) / 3600.0

    event_rows = await AdvertEventRepository.mesh_health_rows(start_ts, end_ts)

    contacts: list[MeshHealthContact] = []
    alerts: list[MeshHealthAlert] = []
    high_count = 0
    medium_count = 0

    for row in event_rows:
        pk = row["public_key"]
        contact = await ContactRepository.get_by_key(pk)
        direct = row["direct_count"]
        flood = row["flood_count"]
        advert_count = direct + flood
        first_seen = row["first_seen"]
        if first_seen is not None and first_seen < start_ts:
            first_seen = start_ts
        contacts.append(
            MeshHealthContact(
                public_key=pk,
                name=contact.name if contact else None,
                advert_count=advert_count,
                direct_count=direct,
                flood_count=flood,
                first_seen=first_seen,
                last_seen=(contact.last_seen if contact else None) or row["last_event"],
                lat=contact.lat if contact else None,
                lon=contact.lon if contact else None,
                min_path_len=row["min_path_len"],
                hash_mode=None,
            )
        )

        adverts_per_hour = advert_count / max(window_hours, 0.01)
        if advert_count > MESH_HEALTH_HIGH_THRESHOLD:
            level = "HIGH"
            high_count += 1
        elif advert_count > MESH_HEALTH_MEDIUM_THRESHOLD:
            level = "MEDIUM"
            medium_count += 1
        else:
            continue

        alerts.append(
            MeshHealthAlert(
                level=level,
                public_key=pk,
                name=contact.name if contact else None,
                advert_count=advert_count,
                adverts_per_hour=round(adverts_per_hour, 2),
            )
        )

    contacts.sort(key=lambda c: c.advert_count, reverse=True)

    return MeshHealthResponse(
        start_ts=start_ts,
        end_ts=end_ts,
        window_hours=round(window_hours, 2),
        total_contacts=len(contacts),
        high_alert_count=high_count,
        medium_alert_count=medium_count,
        high_advert_threshold=MESH_HEALTH_HIGH_THRESHOLD,
        medium_advert_threshold=MESH_HEALTH_MEDIUM_THRESHOLD,
        alerts=alerts,
        contacts=contacts,
    )


@router.get("/snr-rssi-scatter")
async def get_snr_rssi_scatter(
    start_ts: int | None = None,
    end_ts: int | None = None,
    limit: int = 2000,
) -> list[dict]:
    """Up to `limit` {rssi, snr, ts} points (newest-first) for an SNR vs RSSI scatter."""
    now = int(time.time())
    effective_start = start_ts if start_ts is not None else now - 7 * 86400
    effective_end = end_ts if end_ts is not None else now
    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT rssi, snr, timestamp
            FROM raw_packets
            WHERE rssi IS NOT NULL AND snr IS NOT NULL
              AND timestamp >= :start_ts AND timestamp <= :end_ts
            ORDER BY timestamp DESC
            LIMIT :limit
            """,
            {"start_ts": effective_start, "end_ts": effective_end, "limit": min(limit, 5000)},
        ) as cur:
            rows = await cur.fetchall()
    return [
        {"rssi": int(r["rssi"]), "snr": float(r["snr"]), "ts": int(r["timestamp"])} for r in rows
    ]


@router.get("/hourly-heatmap")
async def get_hourly_heatmap(start_ts: int | None = None, end_ts: int | None = None) -> dict:
    """A 7x24 packet-count heatmap grouped by (day_of_week, hour_of_day), UTC.

    day_of_week: 0=Sunday .. 6=Saturday (SQLite strftime('%w')).
    """
    now = int(time.time())
    effective_start = start_ts if start_ts is not None else now - 30 * 86400
    effective_end = end_ts if end_ts is not None else now
    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT
                CAST(strftime('%w', datetime(timestamp, 'unixepoch')) AS INTEGER) AS dow,
                CAST(strftime('%H', datetime(timestamp, 'unixepoch')) AS INTEGER) AS hour,
                COUNT(*) AS count
            FROM raw_packets
            WHERE timestamp >= :start_ts AND timestamp <= :end_ts
            GROUP BY dow, hour
            """,
            {"start_ts": effective_start, "end_ts": effective_end},
        ) as cur:
            rows = await cur.fetchall()
    cells = [{"dow": int(r["dow"]), "hour": int(r["hour"]), "count": int(r["count"])} for r in rows]
    max_count = max((c["count"] for c in cells), default=0)
    total = sum(c["count"] for c in cells)
    return {"cells": cells, "max_count": max_count, "total": total}


@router.get("/relay-pairs")
async def get_relay_pairs(limit: int = 20) -> list[dict]:
    """Most frequent consecutive node-pair co-occurrences across advert paths.

    Pairs come from contact_advert_paths where path_len >= 2. The per-hop hex
    width is derived from the stored path_hex length (RT does not store a
    per-path hash mode).
    """
    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT path_hex, path_len, heard_count
            FROM contact_advert_paths
            WHERE path_len >= 2 AND path_hex IS NOT NULL AND path_hex != ''
            """,
        ) as cur:
            rows = await cur.fetchall()

    pair_counts: dict[tuple[str, str], int] = {}
    for row in rows:
        path_hex: str = row["path_hex"] or ""
        path_len: int = row["path_len"]
        heard: int = row["heard_count"] or 1
        if path_len <= 0 or len(path_hex) % path_len != 0:
            continue
        hex_per_hop = len(path_hex) // path_len
        if hex_per_hop == 0:
            continue
        hops = [
            path_hex[i : i + hex_per_hop] for i in range(0, path_len * hex_per_hop, hex_per_hop)
        ]
        for a, b in zip(hops, hops[1:], strict=False):
            pair_counts[(a, b)] = pair_counts.get((a, b), 0) + heard

    top = sorted(pair_counts.items(), key=lambda x: x[1], reverse=True)[: min(limit, 50)]
    return [{"hop_a": a, "hop_b": b, "count": count} for (a, b), count in top]


@router.get("/reachability-rings")
async def get_reachability_rings(
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> list[dict]:
    """Unique contact counts grouped by minimum hop distance (reachability rings).

    Returns [{hops: 0|1|2|3|null, count, label}]; contacts with no known path
    are reported as hops=null.
    """
    now = int(time.time())
    effective_start = start_ts if start_ts is not None else 0
    effective_end = end_ts if end_ts is not None else now
    async with db.readonly() as conn:
        async with conn.execute(
            """
            SELECT c.public_key, MIN(cap.path_len) AS min_hops
            FROM contacts c
            LEFT JOIN contact_advert_paths cap
                ON cap.public_key = c.public_key
                AND (:start_ts = 0 OR cap.last_seen >= :start_ts)
                AND cap.last_seen <= :end_ts
            WHERE c.last_seen >= :start_ts AND c.last_seen <= :end_ts
            GROUP BY c.public_key
            """,
            {"start_ts": effective_start, "end_ts": effective_end},
        ) as cur:
            rows = await cur.fetchall()

    buckets: dict[int | None, int] = {}
    for row in rows:
        h = row["min_hops"]
        if h is not None:
            h = int(h)
            if h >= 3:
                h = 3
        buckets[h] = buckets.get(h, 0) + 1

    label_map = {0: "Direct (0-hop)", 1: "1 hop", 2: "2 hops", 3: "3+ hops", None: "Unknown"}
    order: list[int | None] = [0, 1, 2, 3, None]
    return [{"hops": h, "count": buckets[h], "label": label_map[h]} for h in order if h in buckets]


@router.get("/{packet_id}", response_model=RawPacketDetail)
async def get_raw_packet(packet_id: int) -> RawPacketDetail:
    """Fetch one stored raw packet by row ID for on-demand inspection."""
    packet_row = await RawPacketRepository.get_by_id(packet_id)
    if packet_row is None:
        raise HTTPException(status_code=404, detail="Raw packet not found")

    stored_packet_id, packet_data, packet_timestamp, message_id = packet_row
    packet_info = parse_packet(packet_data)
    payload_type_name = packet_info.payload_type.name if packet_info else "Unknown"

    # Resolve regional flood-scope for transport-routed packets against the
    # current known-region list (we have the raw payload here, so this stays
    # accurate even if the stored message predates a region-list change).
    transport_code: int | None = None
    region: str | None = None
    if packet_info is not None and packet_info.transport_codes is not None:
        transport_code = packet_info.transport_codes[0]
        settings = await AppSettingsRepository.get()
        region = resolve_region(
            int(packet_info.payload_type),
            packet_info.payload,
            transport_code,
            settings.known_regions,
        )

    decrypted_info: RawPacketDecryptedInfo | None = None
    if message_id is not None:
        message = await MessageRepository.get_by_id(message_id)
        if message is not None:
            if message.type == "CHAN":
                channel = await ChannelRepository.get_by_key(message.conversation_key)
                decrypted_info = RawPacketDecryptedInfo(
                    channel_name=channel.name if channel else None,
                    sender=message.sender_name,
                    channel_key=message.conversation_key,
                    contact_key=message.sender_key,
                    sender_timestamp=message.sender_timestamp,
                    message=message.text,
                )
            else:
                decrypted_info = RawPacketDecryptedInfo(
                    sender=message.sender_name,
                    contact_key=message.conversation_key,
                    sender_timestamp=message.sender_timestamp,
                    message=message.text,
                )

    return RawPacketDetail(
        id=stored_packet_id,
        timestamp=packet_timestamp,
        data=packet_data.hex(),
        payload_type=payload_type_name,
        decrypted=message_id is not None,
        decrypted_info=decrypted_info,
        transport_code=transport_code,
        region=region,
    )


@router.post("/decrypt/historical", response_model=DecryptResult)
async def decrypt_historical_packets(
    request: DecryptRequest, background_tasks: BackgroundTasks, response: Response
) -> DecryptResult:
    """
    Attempt to decrypt historical packets with the provided key.
    Runs in the background. Multiple decrypt jobs can run concurrently.
    """
    if request.key_type == "channel":
        # Channel decryption
        if request.channel_key:
            try:
                channel_key_bytes = bytes.fromhex(request.channel_key)
                if len(channel_key_bytes) != 16:
                    raise _bad_request("Channel key must be 16 bytes (32 hex chars)")
                channel_key_hex = request.channel_key.upper()
            except ValueError:
                raise _bad_request("Invalid hex string for channel key") from None
        elif request.channel_name:
            channel_key_bytes = sha256(request.channel_name.encode("utf-8")).digest()[:16]
            channel_key_hex = channel_key_bytes.hex().upper()
        else:
            raise _bad_request("Must provide channel_key or channel_name")

        # Get count and lookup channel name for display
        count = await RawPacketRepository.get_undecrypted_count()
        if count == 0:
            return DecryptResult(
                started=False, total_packets=0, message="No undecrypted packets to process"
            )

        # Try to find channel name for display
        channel = await ChannelRepository.get_by_key(channel_key_hex)
        display_name = channel.name if channel else request.channel_name

        background_tasks.add_task(
            _run_historical_channel_decryption, channel_key_bytes, channel_key_hex, display_name
        )
        response.status_code = status.HTTP_202_ACCEPTED

        return DecryptResult(
            started=True,
            total_packets=count,
            message=f"Started channel decryption of {count} packets in background",
        )

    elif request.key_type == "contact":
        # DM decryption
        if not request.private_key:
            raise _bad_request("Must provide private_key for contact decryption")
        if not request.contact_public_key:
            raise _bad_request("Must provide contact_public_key for contact decryption")

        try:
            private_key_bytes = bytes.fromhex(request.private_key)
            if len(private_key_bytes) != 64:
                raise _bad_request("Private key must be 64 bytes (128 hex chars)")
        except ValueError:
            raise _bad_request("Invalid hex string for private key") from None

        try:
            contact_public_key_bytes = bytes.fromhex(request.contact_public_key)
            if len(contact_public_key_bytes) != 32:
                raise _bad_request("Contact public key must be 32 bytes (64 hex chars)")
            contact_public_key_hex = request.contact_public_key.lower()
        except ValueError:
            raise _bad_request("Invalid hex string for contact public key") from None

        count = await RawPacketRepository.count_undecrypted_text_messages()
        if count == 0:
            return DecryptResult(
                started=False,
                total_packets=0,
                message="No undecrypted TEXT_MESSAGE packets to process",
            )

        # Try to find contact name for display
        from app.repository import ContactRepository

        contact = await ContactRepository.get_by_key(contact_public_key_hex)
        display_name = contact.name if contact else None

        background_tasks.add_task(
            run_historical_dm_decryption,
            private_key_bytes,
            contact_public_key_bytes,
            contact_public_key_hex,
            display_name,
        )
        response.status_code = status.HTTP_202_ACCEPTED

        return DecryptResult(
            started=True,
            total_packets=count,
            message=f"Started DM decryption of {count} TEXT_MESSAGE packets in background",
        )

    raise _bad_request("key_type must be 'channel' or 'contact'")


class MaintenanceRequest(BaseModel):
    prune_undecrypted_days: int | None = Field(
        default=None, ge=1, description="Delete undecrypted packets older than this many days"
    )
    purge_linked_raw_packets: bool = Field(
        default=False,
        description="Delete raw packets already linked to a stored message",
    )


class MaintenanceResult(BaseModel):
    packets_deleted: int
    vacuumed: bool


@router.post("/maintenance", response_model=MaintenanceResult)
async def run_maintenance(request: MaintenanceRequest) -> MaintenanceResult:
    """
    Run packet maintenance tasks and reclaim disk space.

    - Optionally deletes undecrypted packets older than the specified number of days
    - Optionally deletes raw packets already linked to stored messages
    - Runs VACUUM to reclaim disk space
    """
    deleted = 0

    if request.prune_undecrypted_days is not None:
        logger.info(
            "Running maintenance: pruning undecrypted packets older than %d days",
            request.prune_undecrypted_days,
        )
        pruned_undecrypted = await RawPacketRepository.prune_old_undecrypted(
            request.prune_undecrypted_days
        )
        deleted += pruned_undecrypted
        logger.info("Deleted %d old undecrypted packets", pruned_undecrypted)

    if request.purge_linked_raw_packets:
        logger.info("Running maintenance: purging raw packets linked to stored messages")
        purged_linked = await RawPacketRepository.purge_linked_to_messages()
        deleted += purged_linked
        logger.info("Deleted %d linked raw packets", purged_linked)

    # Run VACUUM to reclaim space on a dedicated connection.
    # VACUUM requires exclusive access — if the main connection is actively
    # writing (background sync, message processing, etc.) it fails with
    # SQLITE_BUSY. This is expected; we just report vacuumed=False.
    vacuumed = False
    try:
        async with aiosqlite.connect(db.db_path) as vacuum_conn:
            await vacuum_conn.executescript("VACUUM;")
        vacuumed = True
        logger.info("Database vacuumed")
    except OperationalError as e:
        logger.warning("VACUUM skipped (database busy): %s", e)
    except Exception as e:
        logger.error("VACUUM failed unexpectedly: %s", e)

    return MaintenanceResult(packets_deleted=deleted, vacuumed=vacuumed)
