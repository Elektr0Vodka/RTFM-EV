"""Unit tests for the pure traffic-link resolver."""

from app.decoder import PacketInfo, PayloadType, RouteType
from app.services.traffic_links import (
    KnownNode,
    build_known_index,
    edges_for_packet,
    pick_hop,
)

SELF = KnownNode("ff" + "0" * 62, 52.0, 5.0)


def pk(prefix: str) -> str:
    return prefix + "0" * (64 - len(prefix))


def node(prefix: str, lat: float | None, lon: float | None) -> KnownNode:
    return KnownNode(pk(prefix), lat, lon)


def flood(path_hex: str, width: int = 1, ptype=PayloadType.GROUP_TEXT, payload=b"") -> PacketInfo:
    path = bytes.fromhex(path_hex)
    return PacketInfo(
        route_type=RouteType.FLOOD,
        payload_type=ptype,
        payload_version=0,
        path_length=len(path) // width,
        path=path,
        payload=payload,
        path_hash_size=width,
    )


def run(info: PacketInfo, nodes: list[KnownNode], confirmed=None):
    index = build_known_index(nodes)
    by_pk = {n.pubkey: n for n in nodes}
    edges = edges_for_packet(info, SELF, index, by_pk, confirmed or {})
    return {(e.a_pubkey[:4], e.b_pubkey[:4], e.hop_width, e.confidence, e.measured) for e in edges}


def test_unique_chain_anchored_at_self():
    nodes = [node("aa01", 52.2, 5.0), node("bb01", 52.1, 5.0)]
    assert run(flood("aabb"), nodes) == {
        ("aa01", "bb01", 1, "unique", False),
        ("bb01", "ff00", 1, "unique", True),
    }


def test_nearest_accepted_when_clearly_nearest():
    nodes = [node("aa01", 52.01, 5.0), node("aa02", 52.5, 5.0)]
    assert run(flood("aa"), nodes) == {("aa01", "ff00", 1, "nearest", True)}


def test_nearest_rejected_when_not_clearly_nearest():
    nodes = [node("aa01", 52.09, 5.0), node("aa02", 52.13, 5.0)]
    assert run(flood("aa"), nodes) == set()


def test_unlocated_candidate_blocks_distance_rule():
    nodes = [node("aa01", 52.01, 5.0), node("aa02", None, None)]
    assert run(flood("aa"), nodes) == set()


def test_confirmed_soft_resolution_wins():
    nodes = [node("aa01", 52.09, 5.0), node("aa02", 52.13, 5.0)]
    assert run(flood("aa"), nodes, confirmed={"aa": pk("aa02")}) == {
        ("aa02", "ff00", 1, "confirmed", True)
    }


def test_chain_break_keeps_resolved_tail_only():
    nodes = [node("aa01", 52.1, 5.0)]  # "cc" matches nothing
    assert run(flood("ccaa"), nodes) == {("aa01", "ff00", 1, "unique", True)}


def test_origin_forward_walk_resolves_hop_ambiguous_from_self_side():
    origin = node("0a01", 53.0, 5.0)
    # From self (52.0) aa02 is 66.7 km, aa01 110 km: ratio < 2, rejected.
    # From origin (53.0) aa01 is 1.1 km, aa02 44 km: accepted.
    nodes = [origin, node("aa01", 52.99, 5.0), node("aa02", 52.6, 5.0)]
    payload = bytes.fromhex(origin.pubkey) + b"\x00" * 69
    info = flood("aa", ptype=PayloadType.ADVERT, payload=payload)
    assert run(info, nodes) == {
        ("0a01", "aa01", 1, "nearest", False),
        ("aa01", "ff00", 1, "nearest", True),
    }


def test_zero_hop_advert_is_origin_to_self_width_3():
    origin = node("0a01", 52.1, 5.0)
    payload = bytes.fromhex(origin.pubkey) + b"\x00" * 69
    info = PacketInfo(
        route_type=RouteType.DIRECT,
        payload_type=PayloadType.ADVERT,
        payload_version=0,
        path_length=0,
        path=b"",
        payload=payload,
    )
    assert run(info, [origin]) == {("0a01", "ff00", 3, "unique", True)}


def test_trace_and_direct_paths_are_ignored():
    nodes = [node("aa01", 52.1, 5.0)]
    trace = flood("aa", ptype=PayloadType.TRACE)
    assert run(trace, nodes) == set()
    direct = PacketInfo(
        route_type=RouteType.DIRECT,
        payload_type=PayloadType.TEXT_MESSAGE,
        payload_version=0,
        path_length=1,
        path=bytes.fromhex("aa"),
        payload=b"",
    )
    assert run(direct, nodes) == set()


def test_repeated_pair_in_one_path_is_recorded_once():
    nodes = [node("aa01", 52.2, 5.0), node("bb01", 52.1, 5.0)]
    edges = run(flood("aabbaa"), nodes)
    pairs = [(a, b) for a, b, *_ in edges]
    assert pairs.count(("aa01", "bb01")) == 1


def test_two_byte_hops():
    nodes = [node("aa01", 52.2, 5.0), node("aa02", 52.1, 5.0)]
    assert run(flood("aa01aa02", width=2), nodes) == {
        ("aa01", "aa02", 2, "unique", False),
        ("aa02", "ff00", 2, "unique", True),
    }


def test_pick_hop_needs_located_neighbour_for_distance_rule():
    nodes = [node("aa01", 52.01, 5.0), node("aa02", 52.5, 5.0)]
    blind = KnownNode(pk("ee01"), None, None)
    assert pick_hop("aa", blind, build_known_index(nodes), {}) is None


def test_advert_origin_that_is_not_a_contact_is_not_an_endpoint():
    stranger = pk("0a01")  # signed advert, but not a known node (contact)
    payload = bytes.fromhex(stranger) + b"\x00" * 69
    nodes = [node("aa01", 52.1, 5.0)]
    info = flood("aa", ptype=PayloadType.ADVERT, payload=payload)
    assert run(info, nodes) == {("aa01", "ff00", 1, "unique", True)}
    zero_hop = PacketInfo(
        route_type=RouteType.DIRECT,
        payload_type=PayloadType.ADVERT,
        payload_version=0,
        path_length=0,
        path=b"",
        payload=payload,
    )
    assert run(zero_hop, nodes) == set()
