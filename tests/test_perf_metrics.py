"""Metric primitives for the Performance page."""

from app.perf.metrics import Histogram, RateCounter, Rolling, Windowed, safe


class TestHistogram:
    def test_empty_has_no_percentiles(self):
        h = Histogram()
        assert h.percentile(50) is None
        assert h.summary() == {"count": 0, "p50": None, "p95": None, "max": None, "avg": None}

    def test_percentiles_within_one_bucket(self):
        h = Histogram()
        for ms in range(1, 101):
            h.record(float(ms))
        p50 = h.percentile(50)
        p95 = h.percentile(95)
        assert p50 is not None and 50 <= p50 <= 50 * 1.2
        assert p95 is not None and 95 <= p95 <= 100
        assert h.max == 100
        assert h.count == 100

    def test_percentile_never_above_max(self):
        h = Histogram()
        h.record(3.0)
        assert h.percentile(99) == 3.0

    def test_ignores_negative_and_nan(self):
        h = Histogram()
        h.record(-1)
        h.record(float("nan"))
        assert h.count == 0

    def test_merge_adds_counts_and_keeps_max(self):
        a, b = Histogram(), Histogram()
        a.record(1)
        b.record(500)
        b.record(2)
        a.merge(b)
        assert a.count == 3
        assert a.max == 500


class TestRolling:
    def test_last_hour_drops_old_slots(self):
        r = Rolling()
        r.record(10, now=0)
        r.record(20, now=3000)
        assert r.last_hour(now=3000).count == 2
        assert r.last_hour(now=3600 + 600).count == 1
        assert r.total == 2


class TestWindowed:
    def test_swap_starts_a_new_interval(self):
        w = Windowed()
        w.record(5)
        done = w.swap()
        assert done.count == 1
        assert w.interval.count == 0
        assert w.hour.last_hour().count == 1


class TestRateCounter:
    def test_counts_last_sixty_seconds(self):
        c = RateCounter()
        c.add(now=100)
        c.add(2, now=130)
        assert c.last_minute(now=150) == 3
        assert c.last_minute(now=165) == 2
        assert c.last_minute(now=200) == 0
        assert c.total == 3


def test_safe_swallows_errors():
    @safe
    def boom() -> int:
        raise ValueError("x")

    assert boom() is None
