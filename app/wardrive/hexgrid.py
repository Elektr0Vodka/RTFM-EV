"""Hex cells for wardrive coverage: CoreScope's server grid
(``cmd/server/hexgrid.go``), the grid rx.mesh-hunter.eu's live map and the
analyzer coverage map use, so a report lines up with them.

Pointy-top hexagons over Web Mercator metres; a cell id is ``res:q:r`` (axial
coordinates). The frontend has the same grid in
``frontend/src/wardrive/map/hexgrid.ts``; both are tested on
``tests/fixtures/wardrive_hex_vectors.json``.
"""

import math

R = 6378137.0
SQRT3 = math.sqrt(3)

# Edge length (metres) per resolution; below 6 is 1500, above 15 is 3.
HEX_SIZES: dict[int, float] = {
    6: 1500,
    7: 720,
    8: 360,
    9: 180,
    10: 90,
    11: 40,
    12: 20,
    13: 10,
    14: 5,
    15: 3,
}

# Axial steps to the six neighbours.
_STEPS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))


def hex_size(res: int) -> float:
    return HEX_SIZES[min(15, max(6, res))]


def _mercator(lat: float, lon: float) -> tuple[float, float]:
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def _inverse(x: float, y: float) -> tuple[float, float]:
    """(lat, lon) of Mercator metres."""
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)


def _js_round(v: float) -> float:
    # JavaScript's Math.round (half up), which the reference grid uses;
    # Python's round() goes to even on .5.
    return math.floor(v + 0.5)


def cell_at(lat: float, lon: float, res: int) -> str:
    size = hex_size(res)
    x, y = _mercator(lat, lon)
    q = (SQRT3 / 3 * x - y / 3) / size
    r = (2 / 3 * y) / size
    qi, ri = _round(q, r)
    return f"{res}:{qi}:{ri}"


def _round(q: float, r: float) -> tuple[int, int]:
    """Nearest hexagon of fractional axial coordinates (cube rounding)."""
    x, z = q, r
    y = -x - z
    rx, ry, rz = _js_round(x), _js_round(y), _js_round(z)
    dx, dy, dz = abs(rx - x), abs(ry - y), abs(rz - z)
    if dx > dy and dx > dz:
        rx = -ry - rz
    elif dy > dz:
        ry = -rx - rz
    else:
        rz = -rx - ry
    # -0.0 from the sums prints as "-0"; the reference prints "0".
    return int(rx) + 0, int(rz) + 0


def _parse(cell: str) -> tuple[int, int, int] | None:
    parts = cell.split(":")
    if len(parts) != 3:
        return None
    try:
        res, q, r = (int(p) for p in parts)
    except ValueError:
        return None
    return res, q, r


def _center_xy(res: int, q: int, r: int) -> tuple[float, float]:
    size = hex_size(res)
    return size * (SQRT3 * q + SQRT3 / 2 * r), size * 1.5 * r


def cell_center(cell: str) -> tuple[float, float] | None:
    """(lat, lon) of the cell's centre, None for a malformed id."""
    parsed = _parse(cell)
    if parsed is None:
        return None
    return _inverse(*_center_xy(*parsed))


def cell_ring(cell: str) -> list[tuple[float, float]] | None:
    """The six corners as (lon, lat), closed (GeoJSON order), None when malformed."""
    parsed = _parse(cell)
    if parsed is None:
        return None
    res = parsed[0]
    cx, cy = _center_xy(*parsed)
    size = hex_size(res)
    ring: list[tuple[float, float]] = []
    for i in range(6):
        a = math.radians(60 * i - 30)
        lat, lon = _inverse(cx + size * math.cos(a), cy + size * math.sin(a))
        ring.append((lon, lat))
    ring.append(ring[0])
    return ring


def neighbours(cell: str) -> list[str]:
    parsed = _parse(cell)
    if parsed is None:
        return []
    res, q, r = parsed
    return [f"{res}:{q + dq}:{r + dr}" for dq, dr in _STEPS]
