"""Plan 21 S1: per-relay reception of the same flooded packet.

Capture (:func:`record_packet_reception`) runs on every reception of a
flood-routed packet, including copies ``raw_packets`` deduplicates, and stores
which relay delivered the copy (the last path hop) with the signal our radio
measured. Aggregation (:func:`aggregate_relay_receptions`) is pure: it groups
the rows by payload hash into packets x relays with SNR/RSSI per cell, plus a
per-relay summary, so the endpoint and tests share one implementation.

Direct-routed packets are skipped: the firmware pops the path as it forwards
them, so the last chunk is not the delivering relay (plan 21 Q3).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from app.decoder import PacketInfo, RouteType
from app.path_utils import last_hop_hex
from app.repository.packet_receptions import PacketReceptionRepository, PacketReceptionRow
from app.repository.raw_packets import payload_hash_for
from app.services.packet_decoded_fields import route_label

logger = logging.getLogger(__name__)

RELAY_ROUTE_TYPES = frozenset({RouteType.FLOOD, RouteType.TRANSPORT_FLOOD})


@dataclass(frozen=True)
class RelayCapture:
    """What :func:`record_packet_reception` stored. ``last_hop_hex`` None = heard from the origin."""

    last_hop_hex: str | None


async def record_packet_reception(
    packet_id: int,
    ts: int,
    packet_info: PacketInfo | None,
    snr: float | None,
    rssi: int | None,
    raw_bytes: bytes,
) -> RelayCapture | None:
    """Store one reception row for a flood-routed packet copy. Never raises.

    Returns the capture (for the live ``raw_packet`` broadcast), or None when
    nothing was stored (not flood-routed, undecodable, or the insert failed).
    """
    try:
        if packet_info is None or packet_info.route_type not in RELAY_ROUTE_TYPES:
            return None
        hops = packet_info.path_length or 0
        path_hex = packet_info.path.hex() if (hops > 0 and packet_info.path) else ""
        width = packet_info.path_hash_size if hops > 0 else 0
        hop = last_hop_hex(path_hex, hops)
        await PacketReceptionRepository.insert(
            raw_packet_id=packet_id,
            payload_hash=payload_hash_for(raw_bytes),
            observed_at=ts,
            snr=snr,
            rssi=rssi,
            payload_type=packet_info.payload_type.name,
            route_type=route_label(packet_info.route_type),
            hop_count=hops,
            hash_size=width,
            last_hop_hex=hop,
            path_hex=path_hex or None,
        )
        return RelayCapture(last_hop_hex=hop)
    except Exception:
        logger.warning("Packet reception recording failed for packet %s", packet_id, exc_info=True)
        return None


@dataclass
class RelayCell:
    """One relay's deliveries of one packet. ``last_hop_hex`` None = heard from the origin."""

    last_hop_hex: str | None
    count: int = 0
    best_snr: float | None = None
    last_snr: float | None = None
    best_rssi: int | None = None
    last_rssi: int | None = None
    last_seen: int = 0

    def add(self, row: PacketReceptionRow) -> None:
        """Fold one reception in. Rows arrive newest first, so the first one is the latest."""
        if self.count == 0:
            self.last_snr = row.snr
            self.last_rssi = row.rssi
        self.count += 1
        if row.snr is not None:
            self.best_snr = row.snr if self.best_snr is None else max(self.best_snr, row.snr)
        if row.rssi is not None:
            self.best_rssi = row.rssi if self.best_rssi is None else max(self.best_rssi, row.rssi)
        self.last_seen = max(self.last_seen, row.observed_at)


@dataclass
class PacketGroup:
    payload_hash: bytes
    payload_type: str
    route_type: str
    first_seen: int
    last_seen: int
    copies: int = 0
    raw_packet_id: int | None = None
    relays: dict[str | None, RelayCell] = field(default_factory=dict)


@dataclass
class RelaySummary:
    last_hop_hex: str | None
    receptions: int = 0
    packets: int = 0
    best_snr: float | None = None
    snr_sum: float = 0.0
    snr_count: int = 0
    last_snr: float | None = None
    best_rssi: int | None = None
    last_seen: int = 0

    @property
    def avg_snr(self) -> float | None:
        return round(self.snr_sum / self.snr_count, 1) if self.snr_count else None


def aggregate_relay_receptions(
    rows: Sequence[PacketReceptionRow], *, limit_packets: int = 50
) -> tuple[list[PacketGroup], list[RelaySummary]]:
    """Group reception rows (newest first) into packets x relays and per-relay totals.

    Packets are returned newest first, capped at ``limit_packets``; the relay
    summary covers every row in ``rows`` (not only the capped packets).
    """
    groups: dict[bytes, PacketGroup] = {}
    summaries: dict[str | None, RelaySummary] = {}
    packets_per_relay: dict[str | None, set[bytes]] = {}

    for row in rows:
        group = groups.get(row.payload_hash)
        if group is None:
            group = PacketGroup(
                payload_hash=row.payload_hash,
                payload_type=row.payload_type,
                route_type=row.route_type,
                first_seen=row.observed_at,
                last_seen=row.observed_at,
                raw_packet_id=row.raw_packet_id,
            )
            groups[row.payload_hash] = group
        group.copies += 1
        group.first_seen = min(group.first_seen, row.observed_at)
        group.last_seen = max(group.last_seen, row.observed_at)
        if group.raw_packet_id is None:
            group.raw_packet_id = row.raw_packet_id

        cell = group.relays.get(row.last_hop_hex)
        if cell is None:
            cell = RelayCell(last_hop_hex=row.last_hop_hex)
            group.relays[row.last_hop_hex] = cell
        cell.add(row)

        summary = summaries.get(row.last_hop_hex)
        if summary is None:
            summary = RelaySummary(last_hop_hex=row.last_hop_hex)
            summaries[row.last_hop_hex] = summary
        summary.receptions += 1
        if summary.receptions == 1:
            summary.last_snr = row.snr
        if row.snr is not None:
            summary.best_snr = (
                row.snr if summary.best_snr is None else max(summary.best_snr, row.snr)
            )
            summary.snr_sum += row.snr
            summary.snr_count += 1
        if row.rssi is not None:
            summary.best_rssi = (
                row.rssi if summary.best_rssi is None else max(summary.best_rssi, row.rssi)
            )
        summary.last_seen = max(summary.last_seen, row.observed_at)
        packets_per_relay.setdefault(row.last_hop_hex, set()).add(row.payload_hash)

    for hop, summary in summaries.items():
        summary.packets = len(packets_per_relay.get(hop, ()))

    ordered_groups = sorted(groups.values(), key=lambda g: g.last_seen, reverse=True)[
        :limit_packets
    ]
    ordered_summaries = sorted(
        summaries.values(), key=lambda s: (s.receptions, s.last_seen), reverse=True
    )
    return ordered_groups, ordered_summaries


def resolve_relay(
    last_hop_hex: str | None, identities: Iterable[tuple[str, str | None]]
) -> tuple[str | None, str | None, int]:
    """Match a last-hop hash prefix against full contact keys.

    Returns ``(pubkey, name, candidates)``: the contact only when exactly one
    key starts with the prefix; ``candidates`` > 1 flags a collision so the
    caller can show the raw hash instead of guessing.
    """
    if not last_hop_hex:
        return None, None, 0
    prefix = last_hop_hex.lower()
    matches = [(pk, name) for pk, name in identities if pk.lower().startswith(prefix)]
    if len(matches) == 1:
        pk, name = matches[0]
        return pk, name, 1
    return None, None, len(matches)
