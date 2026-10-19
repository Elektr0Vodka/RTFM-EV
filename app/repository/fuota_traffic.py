"""FUOTA firmware-update traffic heard in a window, grouped by campaign.

Recognised packets are stored in ``raw_packets`` with payload type ``FUOTA``
(see ``app/fuota.py``); this module re-parses those rows and aggregates them.
FUOTA packets are never forwarded, so every sender is a direct neighbour.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.database import db
from app.fuota import FUOTA_PAYLOAD_TYPE_NAME, FuotaMessage, detect_fuota


@dataclass(frozen=True)
class FuotaObservation:
    ts: int
    raw_len: int
    rssi: int | None
    snr: float | None
    msg: FuotaMessage


def _new_campaign(campaign: str, ts: int) -> dict[str, Any]:
    return {
        "campaign": campaign,
        "first_seen": ts,
        "last_seen": ts,
        "build": None,
        "target": None,
        "patch_size": None,
        "manifest_len": None,
        "source_prefix": None,
        "offers": 0,
        "requests": 0,
        "data": 0,
        "fragments": set(),
        "senders": {},
        "providers": set(),
        "airtime_ms": 0.0,
    }


def _track_sender(senders: dict[str, dict[str, Any]], obs: FuotaObservation) -> None:
    entry = senders.setdefault(
        obs.msg.sender,
        {"sender": obs.msg.sender, "count": 0, "best_rssi": None, "best_snr": None, "kinds": set()},
    )
    entry["count"] += 1
    entry["kinds"].add(obs.msg.kind)
    if obs.rssi is not None and (entry["best_rssi"] is None or obs.rssi > entry["best_rssi"]):
        entry["best_rssi"] = obs.rssi
    if obs.snr is not None and (entry["best_snr"] is None or obs.snr > entry["best_snr"]):
        entry["best_snr"] = obs.snr


def aggregate_fuota(
    observations: list[FuotaObservation], airtime_ms: Callable[[int], float] | None
) -> dict[str, Any]:
    """Totals, per-campaign rows and retracts. Pure: no I/O."""
    totals: dict[str, Any] = {"offers": 0, "requests": 0, "data": 0, "retracts": 0}
    all_senders: set[str] = set()
    total_air = 0.0
    campaigns: dict[str, dict[str, Any]] = {}
    retracts: dict[tuple[int, str], dict[str, Any]] = {}

    for obs in sorted(observations, key=lambda o: o.ts):
        msg = obs.msg
        all_senders.add(msg.sender)
        air = airtime_ms(obs.raw_len) if airtime_ms is not None else 0.0
        total_air += air

        if msg.kind == "retract":
            totals["retracts"] += 1
            entry = retracts.setdefault(
                (obs.ts, msg.sender), {"ts": obs.ts, "sender": msg.sender, "count": 0}
            )
            entry["count"] += 1
            continue
        if msg.campaign is None:
            continue

        camp = campaigns.get(msg.campaign)
        if camp is None:
            camp = campaigns[msg.campaign] = _new_campaign(msg.campaign, obs.ts)
        camp["last_seen"] = obs.ts
        camp["airtime_ms"] += air
        _track_sender(camp["senders"], obs)

        if msg.kind == "offer":
            totals["offers"] += 1
            camp["offers"] += 1
            camp["build"] = msg.build
            camp["target"] = msg.target
            camp["patch_size"] = msg.patch_size
            camp["manifest_len"] = msg.manifest_len
            camp["source_prefix"] = msg.source_prefix
        elif msg.kind == "request":
            totals["requests"] += 1
            camp["requests"] += 1
            if msg.tail:
                # Target/nonce split is unpublished: keep the first byte raw.
                camp["providers"].add(msg.tail[:2])
        elif msg.kind == "data":
            totals["data"] += 1
            camp["data"] += 1
            if msg.fragment is not None:
                camp["fragments"].add(msg.fragment)

    totals["senders"] = len(all_senders)
    totals["airtime_ms"] = total_air if airtime_ms is not None else None

    rows = []
    for camp in sorted(campaigns.values(), key=lambda c: c["last_seen"], reverse=True):
        senders = sorted(camp.pop("senders").values(), key=lambda s: s["sender"])
        for s in senders:
            s["kinds"] = sorted(s["kinds"])
        camp["senders"] = senders
        camp["fragments_heard"] = sorted(camp.pop("fragments"))
        camp["providers_asked"] = sorted(camp.pop("providers"))
        if airtime_ms is None:
            camp["airtime_ms"] = None
        rows.append(camp)

    return {
        "totals": totals,
        "campaigns": rows,
        "retracts": sorted(retracts.values(), key=lambda r: r["ts"]),
    }


class FuotaTrafficRepository:
    @staticmethod
    async def window_observations(start_ts: int, end_ts: int) -> list[FuotaObservation]:
        """Fetch and re-parse stored FUOTA packets heard in the window."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT timestamp, data, rssi, snr FROM raw_packets
                WHERE payload_type = :payload_type
                  AND timestamp BETWEEN :start_ts AND :end_ts
                ORDER BY timestamp
                """,
                {"payload_type": FUOTA_PAYLOAD_TYPE_NAME, "start_ts": start_ts, "end_ts": end_ts},
            ) as cur:
                rows = await cur.fetchall()

        out: list[FuotaObservation] = []
        for row in rows:
            data = bytes(row["data"])
            msg = detect_fuota(data)
            if msg is not None:
                out.append(
                    FuotaObservation(
                        ts=int(row["timestamp"]),
                        raw_len=len(data),
                        rssi=row["rssi"],
                        snr=row["snr"],
                        msg=msg,
                    )
                )
        return out
