"""Tests for the pure partial-node resolution scoring/neighbour helpers."""

from app.services.advert_links import AdvertPathRow, LocatedNode
from app.services.partial_resolution import (
    Candidate,
    collect_path_prefix_neighbours,
    compute_preview,
    rank_candidates,
)

FULL_A = "aa" * 32
FULL_B = "bb" * 32


class TestRankCandidates:
    def test_unique_three_byte_match_is_full_confidence(self):
        cands = [Candidate(pubkey="aabbcc" + "00" * 29, name="Alpha", lat=None, lon=None)]
        ranked = rank_candidates("aabbcc", cands, neighbour_points=[])
        assert len(ranked) == 1
        assert ranked[0].pubkey == "aabbcc" + "00" * 29
        assert ranked[0].confidence == 1.0
        assert ranked[0].distance_km is None

    def test_unique_one_byte_match_is_high_but_below_full(self):
        cands = [Candidate(pubkey="aa" + "00" * 31, name="Alpha", lat=None, lon=None)]
        ranked = rank_candidates("aa", cands, neighbour_points=[])
        assert len(ranked) == 1
        assert ranked[0].confidence == 0.8

    def test_ambiguous_prefers_candidate_near_path_neighbour(self):
        near = Candidate(pubkey="aabb" + "01" * 30, name="Near", lat=52.01, lon=4.01)
        far = Candidate(pubkey="aabb" + "02" * 30, name="Far", lat=48.0, lon=2.0)
        ranked = rank_candidates("aabb", [far, near], neighbour_points=[(52.0, 4.0)])
        assert ranked[0].pubkey == near.pubkey
        assert ranked[0].distance_km is not None and ranked[1].distance_km is not None
        assert ranked[0].distance_km < ranked[1].distance_km
        assert ranked[0].confidence > ranked[1].confidence

    def test_ambiguous_without_neighbours_has_no_distance_and_low_confidence(self):
        a = Candidate(pubkey="aabb" + "01" * 30, name="A", lat=52.0, lon=4.0)
        b = Candidate(pubkey="aabb" + "02" * 30, name="B", lat=53.0, lon=5.0)
        ranked = rank_candidates("aabb", [b, a], neighbour_points=[])
        assert [c.pubkey for c in ranked] == [a.pubkey, b.pubkey]  # stable by pubkey
        assert all(c.distance_km is None for c in ranked)
        assert all(c.confidence < 0.8 for c in ranked)

    def test_located_candidate_outranks_unlocated_when_neighbours_present(self):
        located = Candidate(pubkey="aabb" + "01" * 30, name="Loc", lat=52.01, lon=4.01)
        unlocated = Candidate(pubkey="aabb" + "02" * 30, name="NoLoc", lat=None, lon=None)
        ranked = rank_candidates("aabb", [unlocated, located], neighbour_points=[(52.0, 4.0)])
        assert ranked[0].pubkey == located.pubkey
        assert ranked[0].distance_km is not None
        assert ranked[1].distance_km is None
        assert ranked[0].confidence > ranked[1].confidence


class TestCollectPathPrefixNeighbours:
    def test_records_upstream_neighbour_and_breaks_on_unresolved_hop(self):
        located = [LocatedNode(pubkey=FULL_A, lat=52.0, lon=4.0, kind="contact")]
        rows = [
            AdvertPathRow(
                public_key=FULL_A,
                path_hex="ccdd",  # two 1-byte hops, neither matches a located node
                hop_width=1,
                min_path_len=2,
                first_seen=100,
            )
        ]
        neighbours = collect_path_prefix_neighbours(rows, located)
        assert neighbours["cc"] == [(52.0, 4.0)]  # origin is upstream neighbour of "cc"
        assert "dd" not in neighbours  # chain broke at "cc" (unresolved), no anchor for "dd"

    def test_direct_advert_contributes_no_prefixes(self):
        located = [LocatedNode(pubkey=FULL_A, lat=52.0, lon=4.0, kind="contact")]
        rows = [
            AdvertPathRow(
                public_key=FULL_A, path_hex="", hop_width=None, min_path_len=0, first_seen=1
            )
        ]
        assert collect_path_prefix_neighbours(rows, located) == {}


class TestComputePreview:
    def test_placeholder_with_unique_candidate_resolves(self):
        external = [Candidate(pubkey="aa" + "11" * 31, name="Alpha", lat=52.0, lon=4.0)]
        result = compute_preview(
            placeholder_prefixes=["aa"],
            path_rows=[],
            located=[],
            external=external,
            full_contact_pubkeys=set(),
        )
        assert len(result.resolutions) == 1
        r = result.resolutions[0]
        assert r.prefix_hex == "aa"
        assert r.seen_as == "placeholder"
        assert r.candidate_count == 1
        assert r.candidates[0].confidence == 0.8
        assert result.unmatched == []

    def test_path_hop_excluded_when_it_is_a_known_contact_prefix(self):
        origin = "ee" + "00" * 31
        external = [Candidate(pubkey="ee" + "11" * 31, name="X", lat=1.0, lon=1.0)]
        row = AdvertPathRow(
            public_key=origin, path_hex="ee", hop_width=1, min_path_len=1, first_seen=1
        )
        result = compute_preview(
            placeholder_prefixes=[],
            path_rows=[row],
            located=[LocatedNode(pubkey=origin, lat=52.0, lon=4.0, kind="contact")],
            external=external,
            full_contact_pubkeys={origin},
        )
        assert result.resolutions == []
        assert result.unmatched == []

    def test_unknown_path_hop_resolves_with_neighbour_distance(self):
        origin = "dd" + "00" * 31
        external = [Candidate(pubkey="bbcc" + "22" * 30, name="Beta", lat=52.1, lon=4.1)]
        row = AdvertPathRow(
            public_key=origin, path_hex="bbcc", hop_width=2, min_path_len=1, first_seen=1
        )
        result = compute_preview(
            placeholder_prefixes=[],
            path_rows=[row],
            located=[LocatedNode(pubkey=origin, lat=52.0, lon=4.0, kind="contact")],
            external=external,
            full_contact_pubkeys={origin},
        )
        assert len(result.resolutions) == 1
        r = result.resolutions[0]
        assert r.prefix_hex == "bbcc"
        assert r.seen_as == "path"
        assert r.candidates[0].distance_km is not None

    def test_prefix_without_candidate_is_unmatched(self):
        result = compute_preview(
            placeholder_prefixes=["cd"],
            path_rows=[],
            located=[],
            external=[Candidate(pubkey="aa" + "11" * 31, name="A", lat=1.0, lon=1.0)],
            full_contact_pubkeys=set(),
        )
        assert result.resolutions == []
        assert result.unmatched == ["cd"]

    def test_prefix_seen_as_both_placeholder_and_path(self):
        origin = "dd" + "00" * 31
        external = [Candidate(pubkey="bbcc" + "22" * 30, name="Beta", lat=52.1, lon=4.1)]
        row = AdvertPathRow(
            public_key=origin, path_hex="bbcc", hop_width=2, min_path_len=1, first_seen=1
        )
        result = compute_preview(
            placeholder_prefixes=["bbcc"],
            path_rows=[row],
            located=[LocatedNode(pubkey=origin, lat=52.0, lon=4.0, kind="contact")],
            external=external,
            full_contact_pubkeys={origin},
        )
        assert len(result.resolutions) == 1
        assert result.resolutions[0].seen_as == "both"
