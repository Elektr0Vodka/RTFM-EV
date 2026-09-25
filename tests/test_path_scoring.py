"""Scored path history (plan 28 item 1.15): meshcore-open score port and ranking."""

import pytest

from app.models import ContactPathOutcome
from app.services.path_scoring import UNKNOWN_LATENCY_SCORE, score_paths, score_terms

NOW = 1_800_000_000.0


def row(**kw) -> ContactPathOutcome:
    base: dict = {"path": "11", "path_len": 1, "first_used": 1, "last_used": 1}
    base.update(kw)
    return ContactPathOutcome(**base)


def test_terms_match_meshcore_open_formula():
    r = row(
        success_count=3,
        failure_count=1,
        last_trip_ms=2000,
        route_weight=2.0,
        last_success=NOW - 86400,
    )
    score, reliability, latency, freshness, weight = score_terms(
        r, fastest_trip_ms=1000, highest_weight=4.0, now=NOW
    )
    assert reliability == pytest.approx(4 / 6)  # (s + 1) / (s + f + 2)
    assert latency == pytest.approx(0.5)  # fastest / this
    assert freshness == pytest.approx(0.5)  # 1 / (1 + days)
    assert weight == pytest.approx(0.5)  # weight / highest
    assert score == pytest.approx(0.45 * 4 / 6 + 0.25 * 0.5 + 0.1 * 0.5 + 0.2 * 0.5)


def test_unknown_trip_and_never_successful():
    r = row()
    score, reliability, latency, freshness, weight = score_terms(
        r, fastest_trip_ms=None, highest_weight=1.0, now=NOW
    )
    assert (reliability, latency, freshness, weight) == (0.5, UNKNOWN_LATENCY_SCORE, 0.0, 1.0)
    assert score == pytest.approx(0.45 * 0.5 + 0.25 * 0.6 + 0.2)


def test_latency_is_clamped_and_freshness_never_negative():
    r = row(last_trip_ms=500, last_success=NOW + 600)  # clock skew: success "in the future"
    _, _, latency, freshness, _ = score_terms(r, fastest_trip_ms=1000, highest_weight=1.0, now=NOW)
    assert latency == 1.0 and freshness == 1.0


def test_ranking_prefers_reliable_fast_fresh_heavy_paths():
    good = row(
        path="aa", success_count=5, last_trip_ms=800, route_weight=3.5, last_success=NOW - 60
    )
    slow = row(
        path="bb", success_count=5, last_trip_ms=4000, route_weight=3.5, last_success=NOW - 60
    )
    flaky = row(path="cc", success_count=1, failure_count=4, last_trip_ms=800, route_weight=0.1)
    flood = row(path="", path_len=-1, success_count=2, failure_count=1, last_trip_ms=2500)
    ranked = score_paths([flaky, flood, slow, good], now=NOW)
    assert [p.path for p in ranked] == ["aa", "bb", "", "cc"]
    assert ranked[0].score > ranked[1].score > ranked[2].score > ranked[3].score
    assert ranked[0].latency == 1.0 and ranked[1].latency == pytest.approx(0.2)
    assert ranked[3].weight == pytest.approx(0.1 / 3.5, abs=1e-4)


def test_ties_break_on_weight_then_trip_then_recency():
    a = row(path="aa", route_weight=1.0, last_trip_ms=0)
    b = row(path="bb", route_weight=1.0, last_trip_ms=0)
    ranked = score_paths([a, b], now=NOW)
    assert [p.path for p in ranked] == ["aa", "bb"]  # stable when everything ties
    faster = row(path="cc", route_weight=2.0, last_trip_ms=300, last_success=NOW - 10)
    slower = row(path="dd", route_weight=2.0, last_trip_ms=900, last_success=NOW - 10)
    ranked = score_paths([slower, faster], now=NOW)
    assert [p.path for p in ranked] == ["cc", "dd"]


def test_empty_input():
    assert score_paths([]) == []
