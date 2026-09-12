"""Unit tests for the advert-links resolver (pure, no DB/radio)."""

from app.services.advert_links import (
    AdvertPathRow,
    LocatedNode,
    resolve_advert_edges,
)

# Located nodes. Pubkeys chosen so 1-byte prefixes collide (aa...) but
# 2-byte prefixes are unique. Coordinates spread so "nearest" is unambiguous.
ORIGIN = LocatedNode(pubkey="ff00000000", lat=52.0, lon=5.0, kind="contact")
R1 = LocatedNode(pubkey="aa11000000", lat=52.1, lon=5.0, kind="external")
R2 = LocatedNode(pubkey="aa22000000", lat=52.2, lon=5.0, kind="external")
FAR = LocatedNode(pubkey="aa99000000", lat=10.0, lon=5.0, kind="external")
SELF = LocatedNode(pubkey="ee00000000", lat=52.3, lon=5.0, kind="self")


def _edge_key(edge):
    return (tuple(sorted((edge.a_pubkey, edge.b_pubkey))), edge.hop_width)


def test_direct_advert_emits_origin_to_self_high_confidence():
    rows = [
        AdvertPathRow(
            public_key="ff00000000", path_hex="", hop_width=None, min_path_len=0, first_seen=1000
        )
    ]
    edges = resolve_advert_edges(rows, [ORIGIN], SELF)
    assert len(edges) == 1
    e = edges[0]
    assert _edge_key(e) == (("ee00000000", "ff00000000"), 3)
    assert e.ambiguous is False
    assert e.last_seen == 1000


def test_unique_two_byte_hop_resolves_and_builds_full_chain():
    # width 2 => 4 hex per hop. One hop "aa11" resolves uniquely to R1.
    rows = [
        AdvertPathRow(
            public_key="ff00000000", path_hex="aa11", hop_width=2, min_path_len=1, first_seen=2000
        )
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    keys = {_edge_key(e) for e in edges}
    assert keys == {
        (("aa11000000", "ff00000000"), 2),  # origin -> hop
        (("aa11000000", "ee00000000"), 2),  # hop -> self
    }
    assert all(e.ambiguous is False for e in edges)


def test_ambiguous_one_byte_hop_picks_nearest_to_previous():
    # width 1 => 2 hex per hop. Hop "aa" matches R1, R2, FAR. Anchored at ORIGIN
    # (lat 52.0); nearest is R1 (lat 52.1), not FAR (lat 10.0).
    rows = [
        AdvertPathRow(
            public_key="ff00000000", path_hex="aa", hop_width=1, min_path_len=1, first_seen=3000
        )
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1, R2, FAR], SELF)
    origin_edges = [e for e in edges if "ff00000000" in (e.a_pubkey, e.b_pubkey)]
    assert len(origin_edges) == 1
    other = [p for p in (origin_edges[0].a_pubkey, origin_edges[0].b_pubkey) if p != "ff00000000"][
        0
    ]
    assert other == "aa11000000"  # R1, nearest to origin
    assert origin_edges[0].ambiguous is True


def test_unresolvable_hop_breaks_chain_and_drops_tail():
    # First hop "aa11" resolves to R1; second hop "bbbb" matches nothing.
    # Expect origin->R1 only; no R1->self (chain broke before the end).
    rows = [
        AdvertPathRow(
            public_key="ff00000000",
            path_hex="aa11bbbb",
            hop_width=2,
            min_path_len=2,
            first_seen=4000,
        )
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    keys = {_edge_key(e) for e in edges}
    assert keys == {(("aa11000000", "ff00000000"), 2)}


def test_aggregates_identical_edges_across_rows():
    rows = [
        AdvertPathRow(
            public_key="ff00000000", path_hex="aa11", hop_width=2, min_path_len=1, first_seen=5000
        ),
        AdvertPathRow(
            public_key="ff00000000", path_hex="aa11", hop_width=2, min_path_len=1, first_seen=6000
        ),
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    origin_edges = [e for e in edges if _edge_key(e) == (("aa11000000", "ff00000000"), 2)]
    assert len(origin_edges) == 1
    assert origin_edges[0].count == 2
    assert origin_edges[0].last_seen == 6000


def test_no_self_node_omits_self_edges_but_keeps_hop_chain():
    rows = [
        AdvertPathRow(
            public_key="ff00000000", path_hex="aa11", hop_width=2, min_path_len=1, first_seen=7000
        )
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], None)
    keys = {_edge_key(e) for e in edges}
    assert keys == {(("aa11000000", "ff00000000"), 2)}  # origin -> hop only
