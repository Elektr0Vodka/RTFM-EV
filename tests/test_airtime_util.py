"""Tests for airtime utilization binning (reset-safe deltas)."""

from app.services.airtime_util import (
    compute_airtime_utilization,
    map_openhop_airtime_buckets,
)

SAMPLE_INTERVAL = 60


def test_basic_utilization_percent():
    # 60s apart; tx grows 30s -> 50% ; rx grows 6s -> 10%
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 60, "tx_air_secs": 30, "rx_air_secs": 6},
    ]
    out = compute_airtime_utilization(
        samples, start_ts=0, end_ts=60, bin_count=1, sample_interval=SAMPLE_INTERVAL
    )
    assert len(out) == 1
    assert out[0]["tx_pct"] == 50.0
    assert out[0]["rx_pct"] == 10.0


def test_counter_reset_is_skipped():
    samples = [
        {"timestamp": 0, "tx_air_secs": 100, "rx_air_secs": 100},
        {"timestamp": 60, "tx_air_secs": 130, "rx_air_secs": 106},  # +30/+6 -> valid
        {"timestamp": 120, "tx_air_secs": 5, "rx_air_secs": 1},  # reset -> skip
    ]
    out = compute_airtime_utilization(
        samples, start_ts=0, end_ts=120, bin_count=2, sample_interval=SAMPLE_INTERVAL
    )
    ids = {o["_bin"] for o in out}
    assert 0 in ids
    assert 1 not in ids


def test_large_gap_pair_is_skipped():
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 600, "tx_air_secs": 300, "rx_air_secs": 60},  # dt = 10*interval
    ]
    out = compute_airtime_utilization(
        samples, start_ts=0, end_ts=600, bin_count=1, sample_interval=SAMPLE_INTERVAL
    )
    assert out == []


def test_percent_clamped_to_100():
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 60, "tx_air_secs": 999, "rx_air_secs": 0},
    ]
    out = compute_airtime_utilization(
        samples, start_ts=0, end_ts=60, bin_count=1, sample_interval=SAMPLE_INTERVAL
    )
    assert out[0]["tx_pct"] == 100.0


def test_empty_and_single_sample():
    assert compute_airtime_utilization([], 0, 60, 1, SAMPLE_INTERVAL) == []
    assert (
        compute_airtime_utilization(
            [{"timestamp": 0, "tx_air_secs": 1, "rx_air_secs": 1}], 0, 60, 1, SAMPLE_INTERVAL
        )
        == []
    )


# ── map_openhop_airtime_buckets ──────────────────────────────────────────────


def test_map_openhop_buckets_ms_to_percent():
    # 60s buckets: 30000ms tx -> 50%, 6000ms rx -> 10%
    data = {
        "bucket_seconds": 60,
        "buckets": [
            {"timestamp": 1000, "tx_ms": 30000, "rx_ms": 6000},
        ],
    }
    out = map_openhop_airtime_buckets(data)
    assert out == [{"timestamp": 1000, "tx_pct": 50.0, "rx_pct": 10.0}]


def test_map_openhop_buckets_caps_at_100_and_sorts():
    data = {
        "bucket_seconds": 60,
        "buckets": [
            {"timestamp": 120, "tx_ms": 0, "rx_ms": 120000},  # 200% -> capped 100
            {"timestamp": 60, "tx_ms": 0, "rx_ms": 0},
        ],
    }
    out = map_openhop_airtime_buckets(data)
    assert [p["timestamp"] for p in out] == [60, 120]
    assert out[1]["rx_pct"] == 100.0


def test_map_openhop_buckets_empty_and_missing_fields():
    assert map_openhop_airtime_buckets({}) == []
    assert map_openhop_airtime_buckets({"bucket_seconds": 0, "buckets": []}) == []
    # bucket_seconds 0 -> no divide-by-zero, percentages are 0
    out = map_openhop_airtime_buckets(
        {"bucket_seconds": 0, "buckets": [{"timestamp": 5, "tx_ms": 10, "rx_ms": 10}]}
    )
    assert out == [{"timestamp": 5, "tx_pct": 0.0, "rx_pct": 0.0}]
