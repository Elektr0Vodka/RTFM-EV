"""MGRS (Military Grid Reference System) to WGS84 conversion.

Inverse direction only (MGRS text -> lat/lon), used to place MGRS location
shares on the map. Ported from the ``mgrs`` npm package 2.2.0 (proj4js, MIT,
https://github.com/proj4js/mgrs), which the frontend uses directly, so both
sides agree: ``decode`` + ``UTMtoLL`` + ``toPoint`` (the centre of the grid
square named by the reference). Tests compare against vectors generated with
that package.

Polar areas use UPS, not MGRS, and are not handled (bands A/B/Y/Z rejected).
"""

import math
import re
from dataclasses import dataclass

_NUM_100K_SETS = 6
_SET_ORIGIN_COLUMN_LETTERS = "AJSAJS"
_SET_ORIGIN_ROW_LETTERS = "AFAFAF"
_A, _I, _O, _V, _Z = ord("A"), ord("I"), ord("O"), ord("V"), ord("Z")
_ECC_SQUARED = 0.00669438
_SCALE_FACTOR = 0.9996
_SEMI_MAJOR_AXIS = 6378137
_EASTING_OFFSET = 500000
_NORTHING_OFFSET = 10000000
_UTM_ZONE_WIDTH = 6
_HALF_UTM_ZONE_WIDTH = _UTM_ZONE_WIDTH / 2

_MIN_NORTHING = {
    "C": 1100000,
    "D": 2000000,
    "E": 2800000,
    "F": 3700000,
    "G": 4600000,
    "H": 5500000,
    "J": 6400000,
    "K": 7300000,
    "L": 8200000,
    "M": 9100000,
    "N": 0,
    "P": 800000,
    "Q": 1700000,
    "R": 2600000,
    "S": 3500000,
    "T": 4400000,
    "U": 5300000,
    "V": 6200000,
    "W": 7000000,
    "X": 7900000,
}

# Zone 1-60, band C-X (no I/O), 100 km square letters, then an even run of
# digits (easting half + northing half). Spaces are removed before matching.
_COMPACT = re.compile(r"^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$")


@dataclass(frozen=True)
class MgrsPoint:
    lat: float
    lon: float
    precision_m: float  # side of the grid square the reference names (1 m .. 100 km)


def _set_for_zone(zone: int) -> int:
    set_parm = zone % _NUM_100K_SETS
    return _NUM_100K_SETS if set_parm == 0 else set_parm


def _easting_from_char(letter: str, set_parm: int) -> int:
    cur = ord(_SET_ORIGIN_COLUMN_LETTERS[set_parm - 1])
    value = 100000
    rewound = False
    while cur != ord(letter):
        cur += 1
        if cur == _I:
            cur += 1
        if cur == _O:
            cur += 1
        if cur > _Z:
            if rewound:
                raise ValueError(f"bad MGRS column letter {letter}")
            cur = _A
            rewound = True
        value += 100000
    return value


def _northing_from_char(letter: str, set_parm: int) -> int:
    if letter > "V":
        raise ValueError(f"bad MGRS row letter {letter}")
    cur = ord(_SET_ORIGIN_ROW_LETTERS[set_parm - 1])
    value = 0
    rewound = False
    while cur != ord(letter):
        cur += 1
        if cur == _I:
            cur += 1
        if cur == _O:
            cur += 1
        if cur > _V:
            if rewound:
                raise ValueError(f"bad MGRS row letter {letter}")
            cur = _A
            rewound = True
        value += 100000
    return value


def _utm_to_ll(northing: float, easting: float, zone: int, band: str) -> tuple[float, float]:
    a = _SEMI_MAJOR_AXIS
    e1 = (1 - math.sqrt(1 - _ECC_SQUARED)) / (1 + math.sqrt(1 - _ECC_SQUARED))
    x = easting - _EASTING_OFFSET
    y = northing
    if band < "N":
        y -= _NORTHING_OFFSET
    long_origin = (zone - 1) * _UTM_ZONE_WIDTH - 180 + _HALF_UTM_ZONE_WIDTH
    ecc_prime_squared = _ECC_SQUARED / (1 - _ECC_SQUARED)

    m = y / _SCALE_FACTOR
    mu = m / (
        a
        * (
            1
            - _ECC_SQUARED / 4
            - 3 * _ECC_SQUARED * _ECC_SQUARED / 64
            - 5 * _ECC_SQUARED * _ECC_SQUARED * _ECC_SQUARED / 256
        )
    )
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * math.sin(2 * mu)
        + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * math.sin(4 * mu)
        + (151 * e1 * e1 * e1 / 96) * math.sin(6 * mu)
    )
    sin_phi1 = math.sin(phi1)
    n1 = a / math.sqrt(1 - _ECC_SQUARED * sin_phi1 * sin_phi1)
    t1 = math.tan(phi1) * math.tan(phi1)
    c1 = ecc_prime_squared * math.cos(phi1) * math.cos(phi1)
    r1 = a * (1 - _ECC_SQUARED) / math.pow(1 - _ECC_SQUARED * sin_phi1 * sin_phi1, 1.5)
    d = x / (n1 * _SCALE_FACTOR)

    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d * d / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ecc_prime_squared) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ecc_prime_squared - 3 * c1 * c1)
        * d**6
        / 720
    )
    lon = (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ecc_prime_squared + 24 * t1 * t1) * d**5 / 120
    ) / math.cos(phi1)
    return math.degrees(lat), long_origin + math.degrees(lon)


def mgrs_to_point(reference: str) -> MgrsPoint:
    """Centre of the grid square an MGRS reference names.

    Accepts upper or lower case, with or without spaces. Raises ``ValueError``
    for anything that is not a well-formed MGRS reference.
    """
    compact = re.sub(r"\s+", "", reference).upper()
    match = _COMPACT.match(compact)
    if match is None:
        raise ValueError(f"not an MGRS reference: {reference!r}")
    zone = int(match.group(1))
    if not 1 <= zone <= 60:
        raise ValueError(f"MGRS zone out of range: {zone}")
    band, col, row, digits = match.group(2), match.group(3), match.group(4), match.group(5)
    if len(digits) % 2 != 0 or len(digits) > 10:
        raise ValueError(f"MGRS needs an even number of digits (0-10): {reference!r}")

    set_parm = _set_for_zone(zone)
    east100k = _easting_from_char(col, set_parm)
    north100k = _northing_from_char(row, set_parm)
    while north100k < _MIN_NORTHING[band]:
        north100k += 2000000

    sep = len(digits) // 2
    accuracy = 100000 / math.pow(10, sep)
    sep_easting = float(digits[:sep]) * accuracy if sep else 0.0
    sep_northing = float(digits[sep:]) * accuracy if sep else 0.0
    easting = sep_easting + east100k
    northing = sep_northing + north100k

    bottom, left = _utm_to_ll(northing, easting, zone, band)
    top, right = _utm_to_ll(northing + accuracy, easting + accuracy, zone, band)
    lat = (top + bottom) / 2
    lon = (left + right) / 2
    if not (-80 <= lat <= 84 and -180 <= lon <= 180):
        raise ValueError(f"MGRS reference outside the MGRS area: {reference!r}")
    return MgrsPoint(lat=lat, lon=lon, precision_m=accuracy)
