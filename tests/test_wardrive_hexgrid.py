"""The wardrive report's hex cells: CoreScope's grid, checked against vectors
made by core-hunter's port of it (tests/fixtures/wardrive_hex_vectors.json),
the same file the frontend test reads."""

import json
import math
from pathlib import Path

import pytest

from app.wardrive import hexgrid

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "wardrive_hex_vectors.json").read_text(encoding="utf-8")
)
R = 6378137.0


def _merc(lat: float, lon: float) -> tuple[float, float]:
    return (
        R * math.radians(lon),
        R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)),
    )


@pytest.mark.parametrize("point", VECTORS["points"], ids=lambda p: p["name"])
def test_cells_match_the_reference(point):
    for res, cell in point["cells"].items():
        assert hexgrid.cell_at(point["lat"], point["lon"], int(res)) == cell


@pytest.mark.parametrize("point", VECTORS["points"], ids=lambda p: p["name"])
def test_a_cell_centre_is_near_its_points(point):
    for res in (7, 9, 11):
        cell = hexgrid.cell_at(point["lat"], point["lon"], res)
        center = hexgrid.cell_center(cell)
        assert center is not None
        x0, y0 = _merc(point["lat"], point["lon"])
        x1, y1 = _merc(*center)
        assert math.hypot(x1 - x0, y1 - y0) <= hexgrid.hex_size(res)


def test_ring_matches_the_reference_corners():
    zwolle = VECTORS["points"][0]
    ring = hexgrid.cell_ring(zwolle["cells"]["9"])
    assert ring is not None
    assert len(ring) == 7
    assert ring[0] == ring[-1]
    for (lon, lat), (ref_lat, ref_lon) in zip(
        ring, VECTORS["ring_zwolle_res9_latlon"], strict=True
    ):
        assert lat == pytest.approx(ref_lat, abs=1e-9)
        assert lon == pytest.approx(ref_lon, abs=1e-9)


def test_neighbours_are_six_cells_one_step_away():
    cell = hexgrid.cell_at(52.5168, 6.083, 9)
    near = hexgrid.neighbours(cell)
    assert len(set(near)) == 6
    center = hexgrid.cell_center(cell)
    assert center is not None
    cx, cy = _merc(*center)
    step = math.sqrt(3) * hexgrid.hex_size(9)
    for other in near:
        oc = hexgrid.cell_center(other)
        assert oc is not None
        ox, oy = _merc(*oc)
        assert math.hypot(ox - cx, oy - cy) == pytest.approx(step, rel=0.01)


def test_sizes_per_resolution():
    assert [hexgrid.hex_size(r) for r in range(6, 16)] == [
        1500,
        720,
        360,
        180,
        90,
        40,
        20,
        10,
        5,
        3,
    ]
    assert hexgrid.hex_size(2) == 1500
    assert hexgrid.hex_size(20) == 3


@pytest.mark.parametrize("bad", ["", "9:1", "x:1:2", "9:1:2:3", "9:a:b"])
def test_a_malformed_id_gives_nothing(bad):
    assert hexgrid.cell_center(bad) is None
    assert hexgrid.cell_ring(bad) is None
    assert hexgrid.neighbours(bad) == []
