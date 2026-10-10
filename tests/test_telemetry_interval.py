"""Tests for the telemetry interval math helpers.

These helpers back both the PATCH validation and the scheduler clamping,
so regressions here silently corrupt cadence for every operator. Keep this
suite fast, pure, and focused on the boundary values in the N=1..8 table.
"""

from datetime import UTC, datetime, timezone

import pytest

from app.telemetry_interval import (
    DAILY_CHECK_CEILING,
    DEFAULT_TELEMETRY_INTERVAL_HOURS,
    TELEMETRY_INTERVAL_OPTIONS_HOURS,
    clamp_telemetry_interval,
    legal_interval_options,
    next_run_timestamp_utc,
    resolve_schedule_minute,
    shortest_legal_interval_hours,
    telemetry_schedule_minute,
)


@pytest.mark.parametrize(
    ("n", "expected_hours"),
    [
        (1, 1),
        (2, 2),
        (3, 3),
        (4, 4),
        (5, 6),
        (6, 6),
        (7, 8),
        (8, 8),
    ],
)
def test_shortest_legal_interval_table(n: int, expected_hours: int):
    """The N=1..8 table must match the user-facing design exactly."""
    assert shortest_legal_interval_hours(n) == expected_hours


def test_shortest_legal_interval_above_ceiling_falls_back_to_24h():
    # Not reachable today (max 8 tracked), but verify the math terminates
    # gracefully if the limit is ever raised above DAILY_CHECK_CEILING.
    assert shortest_legal_interval_hours(DAILY_CHECK_CEILING + 1) == 24


def test_shortest_legal_interval_zero_returns_default():
    # No repeaters tracked: loop skips the cycle regardless, but the math
    # must terminate with a sane value (otherwise div-by-zero).
    assert shortest_legal_interval_hours(0) == DEFAULT_TELEMETRY_INTERVAL_HOURS


def test_clamp_respects_user_pref_when_legal():
    # User picks 2h with N=2 tracked -> 2h is the shortest legal, keep it.
    assert clamp_telemetry_interval(2, 2) == 2


def test_clamp_pushes_up_when_pref_illegal():
    # User picked 1h, then grew to 5 tracked. 5 repeaters' shortest legal is
    # 6h, so the scheduler should be using 6h while the saved pref is still 1.
    assert clamp_telemetry_interval(1, 5) == 6


def test_clamp_unrecognized_value_falls_back_to_default():
    # A malformed saved value (e.g. from a hand-edited DB row) should default,
    # not error. Default 8h still gets clamped up if illegal for N.
    assert clamp_telemetry_interval(99, 1) == DEFAULT_TELEMETRY_INTERVAL_HOURS


def test_clamp_preserves_longer_than_shortest_legal():
    # 24h is always legal at any N.
    assert clamp_telemetry_interval(24, 8) == 24


def test_legal_options_filters_menu():
    assert legal_interval_options(5) == [6, 8, 12, 24]
    assert legal_interval_options(1) == list(TELEMETRY_INTERVAL_OPTIONS_HOURS)
    assert legal_interval_options(8) == [8, 12, 24]


def test_next_run_is_strictly_future_even_on_boundary():
    # Exactly at a matching top-of-hour (8:00 UTC with interval=8), we want
    # the *next* one (16:00), never "now". Prevents a double-run in the same
    # minute if code mishandles equality.
    now = datetime(2026, 4, 16, 8, 0, 0, tzinfo=UTC)
    result = next_run_timestamp_utc(8, now=now)
    expected = datetime(2026, 4, 16, 16, 0, 0, tzinfo=UTC)
    assert result == int(expected.timestamp())


def test_next_run_rounds_up_from_mid_hour():
    # 14:37 UTC with interval=8 -> next matching hour is 16:00.
    now = datetime(2026, 4, 16, 14, 37, 0, tzinfo=UTC)
    result = next_run_timestamp_utc(8, now=now)
    expected = datetime(2026, 4, 16, 16, 0, 0, tzinfo=UTC)
    assert result == int(expected.timestamp())


def test_next_run_crosses_midnight():
    # 23:12 UTC with interval=8 -> midnight (00:00 next day) is legal.
    now = datetime(2026, 4, 16, 23, 12, 0, tzinfo=UTC)
    result = next_run_timestamp_utc(8, now=now)
    expected = datetime(2026, 4, 17, 0, 0, 0, tzinfo=UTC)
    assert result == int(expected.timestamp())


def test_next_run_accepts_non_utc_input():
    # Non-UTC input should be normalized internally.
    from datetime import timedelta

    pst = timezone(timedelta(hours=-8))
    # 08:00 PST == 16:00 UTC, a matching boundary for interval=8 -> next is 00:00 UTC.
    now = datetime(2026, 4, 16, 8, 0, 0, tzinfo=pst)
    result = next_run_timestamp_utc(8, now=now)
    expected = datetime(2026, 4, 17, 0, 0, 0, tzinfo=UTC)
    assert result == int(expected.timestamp())


def test_schedule_minute_is_derived_from_the_radio_key():
    # First two key bytes, modulo 60: 0x0025 = 37, 0xffff = 65535 -> 15.
    assert telemetry_schedule_minute("0025" + "ab" * 30) == 37
    assert telemetry_schedule_minute("ffff" + "00" * 30) == 15
    assert telemetry_schedule_minute("FFFF" + "00" * 30) == 15


def test_schedule_minute_is_the_same_on_every_call():
    key = "c3a1" + "5e" * 30
    assert telemetry_schedule_minute(key) == telemetry_schedule_minute(key)
    assert 0 <= telemetry_schedule_minute(key) < 60


@pytest.mark.parametrize("key", [None, "", "zz" * 32, "a"])
def test_schedule_minute_without_a_usable_key_is_the_top_of_the_hour(key):
    assert telemetry_schedule_minute(key) == 0


def test_next_run_lands_on_the_schedule_minute():
    # 14:50 UTC, interval 8, minute 37 -> 16:37.
    now = datetime(2026, 4, 16, 14, 50, 0, tzinfo=UTC)
    expected = datetime(2026, 4, 16, 16, 37, 0, tzinfo=UTC)
    assert next_run_timestamp_utc(8, now=now, minute=37) == int(expected.timestamp())


def test_next_run_can_still_be_in_the_current_hour():
    # 08:10 UTC in a matching hour: the 08:37 run has not happened yet.
    now = datetime(2026, 4, 16, 8, 10, 0, tzinfo=UTC)
    expected = datetime(2026, 4, 16, 8, 37, 0, tzinfo=UTC)
    assert next_run_timestamp_utc(8, now=now, minute=37) == int(expected.timestamp())


def test_next_run_on_the_schedule_minute_itself_is_the_one_after():
    now = datetime(2026, 4, 16, 8, 37, 0, tzinfo=UTC)
    expected = datetime(2026, 4, 16, 16, 37, 0, tzinfo=UTC)
    assert next_run_timestamp_utc(8, now=now, minute=37) == int(expected.timestamp())


def test_next_run_after_the_schedule_minute_skips_to_the_next_matching_hour():
    now = datetime(2026, 4, 16, 8, 40, 0, tzinfo=UTC)
    expected = datetime(2026, 4, 16, 16, 37, 0, tzinfo=UTC)
    assert next_run_timestamp_utc(8, now=now, minute=37) == int(expected.timestamp())


def test_a_chosen_minute_wins_over_the_radio_key():
    key = "0025" + "ab" * 30  # automatic minute 37
    assert resolve_schedule_minute(12, key) == 12
    assert resolve_schedule_minute(0, key) == 0
    assert resolve_schedule_minute(59, key) == 59


@pytest.mark.parametrize("setting", [-1, None, 60, 99, -5])
def test_automatic_or_out_of_range_falls_back_to_the_radio_key(setting):
    key = "0025" + "ab" * 30
    assert resolve_schedule_minute(setting, key) == 37
    assert resolve_schedule_minute(setting, None) == 0
