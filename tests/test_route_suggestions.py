"""Suggested DM routes: reversing heard paths, merging sources, scoring and ranking."""

import pytest

from app.models import ContactPathOutcome, ContactRoute
from app.services.route_suggestions import (
    MAX_SUGGESTIONS,
    W_DELIVERY,
    W_FRESHNESS,
    W_HEARD,
    W_HOPS,
    HeardPath,
    reverse_heard_path,
    suggest_routes,
)

NOW = 1_800_000_000.0


def heard(path: str, path_len: int, **kw) -> HeardPath:
    base: dict = {"last_seen": int(NOW), "heard_count": 1, "source": "advert"}
    base.update(kw)
    return HeardPath(path_hex=path, path_len=path_len, **base)


def outcome(path: str, path_len: int, **kw) -> ContactPathOutcome:
    base: dict = {"path": path, "path_len": path_len, "first_used": 1, "last_used": 1}
    base.update(kw)
    return ContactPathOutcome(**base)


class TestReverseHeardPath:
    def test_reverses_hop_order_and_keeps_hop_width(self):
        # Heard contact -> aa11 -> bb22 -> cc33 -> us; we send us -> cc33 -> bb22 -> aa11.
        assert reverse_heard_path("aa11bb22cc33", 3) == ("cc33bb22aa11", 3, 1)

    def test_one_and_three_byte_hops(self):
        assert reverse_heard_path("aabb", 2) == ("bbaa", 2, 0)
        assert reverse_heard_path("aa1111bb2222", 2) == ("bb2222aa1111", 2, 2)

    def test_zero_hops_is_the_direct_route(self):
        assert reverse_heard_path("", 0) == ("", 0, 0)

    @pytest.mark.parametrize(
        ("path", "path_len"),
        [("aabbc", 2), ("aabbcc", 2), ("aabb", -1), ("", 2), ("zzzz", 2)],
    )
    def test_rejects_paths_that_do_not_split_into_whole_hops(self, path, path_len):
        assert reverse_heard_path(path, path_len) is None


class TestSuggestRoutes:
    def test_route_text_matches_the_routing_override_format(self):
        [multi, direct] = suggest_routes(
            [heard("aa11bb22", 2), heard("", 0, last_seen=int(NOW) - 86400)], [], None, now=NOW
        )
        assert (multi.path, multi.path_len, multi.path_hash_mode) == ("bb22aa11", 2, 1)
        assert multi.route == "bb22,aa11"
        assert (direct.path, direct.path_len, direct.route) == ("", 0, "0")

    def test_merges_the_same_route_heard_through_adverts_and_dms(self):
        [s] = suggest_routes(
            [
                heard("aabb", 2, heard_count=3, last_seen=100),
                heard("AABB", 2, heard_count=2, last_seen=500, source="dm"),
            ],
            [],
            None,
            now=NOW,
        )
        assert s.heard_count == 5
        assert s.last_seen == 500
        assert s.sources == ["advert", "dm"]

    def test_same_bytes_at_another_hop_width_is_a_different_route(self):
        routes = suggest_routes([heard("aabbccdd", 4), heard("aabbccdd", 2)], [], None, now=NOW)
        assert {(r.path_len, r.path_hash_mode) for r in routes} == {(4, 0), (2, 1)}

    def test_score_terms(self):
        routes = suggest_routes(
            [
                heard("aabb", 2, heard_count=2, last_seen=int(NOW) - 86400),
                heard("cc", 1, heard_count=4),
            ],
            [outcome("bbaa", 2, attempt_count=4, success_count=3, failure_count=1)],
            None,
            now=NOW,
        )
        s = next(r for r in routes if r.route == "bb,aa")
        assert s.freshness == pytest.approx(0.5)  # 1 / (1 + days)
        assert s.heard == pytest.approx(0.5)  # count / highest count
        assert s.hops == pytest.approx(1 / 3)  # 1 / (1 + hops)
        assert s.delivery == pytest.approx(4 / 6)  # (s + 1) / (s + f + 2)
        assert (s.attempt_count, s.success_count, s.failure_count) == (4, 3, 1)
        assert s.score == pytest.approx(
            W_FRESHNESS * 0.5 + W_HEARD * 0.5 + W_HOPS / 3 + W_DELIVERY * 4 / 6
        )

    def test_a_route_never_sent_on_gets_the_neutral_delivery_term(self):
        [s] = suggest_routes([heard("aa", 1)], [], None, now=NOW)
        assert s.delivery == pytest.approx(0.5)
        assert s.attempt_count == 0

    def test_outcomes_for_flood_or_other_routes_are_not_attached(self):
        [s] = suggest_routes(
            [heard("aa", 1)],
            [outcome("", -1, success_count=9), outcome("bb", 1, failure_count=9)],
            None,
            now=NOW,
        )
        assert s.delivery == pytest.approx(0.5)

    def test_ranks_fresh_short_delivering_routes_first(self):
        routes = suggest_routes(
            [
                heard("aabbcc", 3, last_seen=int(NOW) - 30 * 86400),
                heard("dd", 1, heard_count=5),
                heard("eeff", 2, heard_count=5),
            ],
            [outcome("ffee", 2, failure_count=6)],
            None,
            now=NOW,
        )
        assert [r.route for r in routes] == ["dd", "ff,ee", "cc,bb,aa"]

    def test_marks_the_route_in_use(self):
        current = ContactRoute(path="BBAA", path_len=2, path_hash_mode=0)
        routes = suggest_routes([heard("aabb", 2), heard("cc", 1)], [], current, now=NOW)
        assert {r.route: r.is_current for r in routes} == {"bb,aa": True, "cc": False}

    def test_flood_as_current_route_matches_nothing(self):
        current = ContactRoute(path="", path_len=-1, path_hash_mode=-1)
        [s] = suggest_routes([heard("", 0)], [], current, now=NOW)
        assert s.is_current is False

    def test_skips_unusable_paths_and_caps_the_list(self):
        paths = [heard("aabbc", 2)] + [heard(f"{i:02x}", 1) for i in range(MAX_SUGGESTIONS + 3)]
        assert len(suggest_routes(paths, [], None, now=NOW)) == MAX_SUGGESTIONS

    def test_future_timestamps_do_not_push_freshness_above_one(self):
        [s] = suggest_routes([heard("aa", 1, last_seen=int(NOW) + 600)], [], None, now=NOW)
        assert s.freshness == 1.0
