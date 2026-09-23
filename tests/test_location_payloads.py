"""Tests for location-share recognition (app/location_payloads.py)."""

import pytest

from app.location_payloads import parse_location_share


class TestMarker:
    def test_meshcore_open_marker(self) -> None:
        share = parse_location_share("m:52.090700,5.121400|Dom tower|poi")
        assert share is not None
        assert share.format == "marker"
        assert (share.lat, share.lon) == (52.0907, 5.1214)
        assert share.label == "Dom tower"
        assert share.flags == "poi"
        assert share.precision_m is None

    def test_marker_needs_both_pipes(self) -> None:
        # Not a marker; the 6-decimal pair is still a plain decimal share.
        share = parse_location_share("m:52.090700,5.121400")
        assert share is not None
        assert share.format == "decimal"

    def test_marker_zero_zero_is_unset(self) -> None:
        assert parse_location_share("m:0.000000,0.000000|x|poi") is None

    def test_marker_out_of_range(self) -> None:
        assert parse_location_share("m:95.000000,5.000000|x|poi") is None


class TestDecimal:
    @pytest.mark.parametrize(
        "text",
        [
            "52.090700, 5.121400",
            "I'm at 52.0907,5.1214 now",
            "geo:52.090700,5.121400",
        ],
    )
    def test_pairs_with_four_or_more_decimals(self, text: str) -> None:
        share = parse_location_share(text)
        assert share is not None
        assert share.format == "decimal"
        assert share.lat == pytest.approx(52.0907)
        assert share.lon == pytest.approx(5.1214)

    def test_negative_values(self) -> None:
        share = parse_location_share("-33.856800, 151.215300")
        assert share is not None
        assert (share.lat, share.lon) == (-33.8568, 151.2153)

    @pytest.mark.parametrize(
        "text",
        [
            "1.5, 2.5",  # too few decimals
            "52.090, 5.121",  # 3 decimals
            "version 1.23456, build 2.34567.8",  # trailing .8 breaks the second number
            "0.000000, 0.000000",
            "91.000000, 5.000000",
            "no numbers here",
        ],
    )
    def test_rejected(self, text: str) -> None:
        assert parse_location_share(text) is None


class TestMgrs:
    def test_spaced_reference(self) -> None:
        share = parse_location_share("meet at 31U FT 45332 73249 at noon")
        assert share is not None
        assert share.format == "mgrs"
        assert share.raw == "31U FT 45332 73249"
        assert share.lat == pytest.approx(52.09070099579618, abs=1e-9)
        assert share.lon == pytest.approx(5.121397980233555, abs=1e-9)
        assert share.precision_m == 1

    def test_compact_reference(self) -> None:
        share = parse_location_share("31UFT45337324")
        assert share is not None
        assert share.format == "mgrs"
        assert share.precision_m == 10

    def test_lower_case_is_not_matched(self) -> None:
        # Lower case would also match hex such as "10cab12345".
        assert parse_location_share("31u ft 4533 7324") is None
        assert parse_location_share("10cab12345") is None

    @pytest.mark.parametrize(
        "text",
        [
            "31U FT 4533 73249",  # unequal halves
            "31UFT4533732",  # odd compact digit count
            "31UFT1",  # 10 km precision not accepted as a share
            "131UFT45337324",  # zone 131
            "31UFT45337324X",  # glued to a letter
        ],
    )
    def test_rejected(self, text: str) -> None:
        assert parse_location_share(text) is None


def test_marker_wins_over_other_formats() -> None:
    share = parse_location_share("m:52.090700,5.121400|31U FT 45332 73249|poi")
    assert share is not None
    assert share.format == "marker"
