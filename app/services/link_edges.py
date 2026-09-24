"""Record the link edges each received packet copy proves (``link_edge_events``).

Called from ``process_raw_packet`` for every copy, including duplicates, so a
flood packet heard over several paths records every path's edges. Failures are
logged and swallowed: edge recording must never break packet processing.
"""

import logging
import time
from dataclasses import dataclass

from app.decoder import PacketInfo
from app.keystore import get_public_key
from app.repository.link_edges import LinkEdgesRepository
from app.repository.partial_resolution import PartialResolutionRepository
from app.services.packet_decoded_fields import route_label
from app.services.traffic_links import KnownNode, build_known_index, edges_for_packet

logger = logging.getLogger(__name__)

# Known-node index and confirmed resolutions are rebuilt at most this often.
CONTEXT_TTL_SECONDS = 60


@dataclass
class _Context:
    index: dict[str, list[KnownNode]]
    by_pubkey: dict[str, KnownNode]
    confirmed: dict[str, str]
    built_at: float


_context: _Context | None = None


def reset_context() -> None:
    """Drop the cached node index (tests; also safe to call at any time)."""
    global _context
    _context = None


async def _get_context(now: float) -> _Context:
    global _context
    if _context is None or now - _context.built_at >= CONTEXT_TTL_SECONDS:
        nodes = await LinkEdgesRepository.known_nodes()
        confirmed = {
            r.prefix_hex.lower(): r.resolved_pubkey.lower()
            for r in await PartialResolutionRepository.list_all()
        }
        _context = _Context(
            index=build_known_index(nodes),
            by_pubkey={n.pubkey: n for n in nodes},
            confirmed=confirmed,
            built_at=now,
        )
    return _context


def current_self_node() -> KnownNode | None:
    """Our own node: pubkey from the radio (or keystore), location if advertised."""
    try:
        from app.services.radio_runtime import radio_runtime as radio_manager

        mc = getattr(radio_manager, "meshcore", None)
        info = (getattr(mc, "self_info", None) if mc else None) or {}
        pubkey = (info.get("public_key") or "").lower()
        if not pubkey:
            key = get_public_key()
            pubkey = key.hex() if key else ""
        if not pubkey:
            return None
        lat = info.get("adv_lat")
        lon = info.get("adv_lon")
        if (
            lat is None
            or lon is None
            or not (-90 <= lat <= 90 and -180 <= lon <= 180)
            or (lat == 0 and lon == 0)
        ):
            return KnownNode(pubkey, None, None)
        return KnownNode(pubkey, float(lat), float(lon))
    except Exception:
        return None


async def record_packet_edges(
    packet_id: int,
    ts: int,
    packet_info: PacketInfo | None,
    snr: float | None,
    rssi: int | None,
    *,
    self_node: KnownNode | None = None,
) -> None:
    try:
        me = self_node or current_self_node()
        if me is None or packet_info is None:
            return
        ctx = await _get_context(time.monotonic())
        edges = edges_for_packet(packet_info, me, ctx.index, ctx.by_pubkey, ctx.confirmed)
        if not edges:
            return
        await LinkEdgesRepository.insert_edges(
            raw_packet_id=packet_id,
            ts=ts,
            payload_type=packet_info.payload_type.name,
            route_type=route_label(packet_info.route_type),
            edges=edges,
            snr=snr,
            rssi=rssi,
        )
    except Exception:
        logger.warning("Link edge recording failed for packet %s", packet_id, exc_info=True)
