"""Tests for the MGRS -> lat/lon port (app/mgrs.py).

Vectors were generated with the ``mgrs`` npm package 2.2.0 (the library the
frontend uses): ``forward([lon, lat], accuracy)`` then ``toPoint``. The port
must agree with it to within float noise.
"""

import pytest

from app.mgrs import mgrs_to_point

# (mgrs, lat, lon) from mgrs@2.2.0 toPoint
VECTORS = [
    ("31UFT4533273249", 52.09070099579618, 5.121397980233555),
    ("31UFT45337324", 52.090659908375144, 5.12143252705166),
    ("31UFT4573", 52.09290739017614, 5.123948783977015),
    ("31UFU2902403904", 52.37020025870592, 4.89519893744154),
    ("18TWL8073504695", 40.689203051837225, -74.04450434357587),
    ("18TWL8004", 40.687464960177195, -74.0473157747098),
    ("56HLH3490052288", -33.85680226934748, 151.21529919987273),
    ("56HLH3452", -33.85483277233209, 151.21101118314309),
    ("31UDQ4825211954", 48.85839635284583, 2.294506849242765),
    ("30UXC9933010142", 51.507204061173724, -0.12760671563797654),
    ("34HBH6188143182", -33.924898667431655, 18.424098973642156),
    ("54SUE8162250298", 35.68949635622236, 139.69170304291515),
    ("10SEG5113080998", 37.774896576972424, -122.41940307540212),
    ("32VNM9797943118", 59.913895682660026, 10.752192566592043),
    ("33XWG1448183357", 78.2231985987435, 15.635600588656839),
    ("19HCC4484697700", -33.4488968636402, -70.66930231000305),
    ("31NAA6603200011", 0.00010390056652074357, 0.00009922788880367683),
    ("31NAA6600", 0.004517452000721077, 0.00429473505718847),
    ("1CDM4915473130", -79.49999622987673, -179.50000326232245),
    ("60XWU3439017795", 83.89999788209872, 179.89997104547598),
    ("60XWU3417", 83.89730308362346, 179.9079630761417),
]


@pytest.mark.parametrize(("reference", "lat", "lon"), VECTORS)
def test_matches_npm_mgrs(reference: str, lat: float, lon: float) -> None:
    point = mgrs_to_point(reference)
    assert point.lat == pytest.approx(lat, abs=1e-9)
    assert point.lon == pytest.approx(lon, abs=1e-9)


def test_precision_follows_digit_count() -> None:
    assert mgrs_to_point("31UFT4533273249").precision_m == 1
    assert mgrs_to_point("31UFT45337324").precision_m == 10
    assert mgrs_to_point("31UFT4573").precision_m == 1000


def test_spaces_and_lower_case_are_accepted() -> None:
    compact = mgrs_to_point("31UFT4533273249")
    assert mgrs_to_point("31U FT 45332 73249") == compact
    assert mgrs_to_point("31ufT 45332 73249") == compact


@pytest.mark.parametrize(
    "reference",
    [
        "",
        "31UFT453327324",  # odd digit count
        "31UFT45332732491234",  # more than 5 digits per half
        "61UFT4533273249",  # zone out of range
        "0UFT4533273249",  # zone 0
        "31IFT4533273249",  # band I does not exist
        "31YFT4533273249",  # polar band (UPS, not MGRS)
        "31UFW4533273249",  # row letter beyond V
        "hello world",
    ],
)
def test_rejects_malformed_references(reference: str) -> None:
    with pytest.raises(ValueError):
        mgrs_to_point(reference)
