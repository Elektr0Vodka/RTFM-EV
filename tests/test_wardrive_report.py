"""The wardrive report builder: summary, coverage cells, weak spots and the
nodes heard, from stored rows."""

from __future__ import annotations

import pytest

from app.wardrive import hexgrid
from app.wardrive.report import band, build_report, heard_id

# frontend/src/test/wardrive/decodeVectors.ts REAL_ADVERT: a public repeater
# beacon from core-hunter's decode tests (zero hops).
REAL_ADVERT = (
    "12004250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb806202a6e7b6aaf114f76dbd2af"
    "c6e732160cab0f45881163c98535dc5177f8e04ac796da9108cfb21bf5657452e23ed12f1007194e8da4937179"
    "ce214abf2465272e541ef80d929cda1c03b88d69004e4c2d4f562d454e532d45534e4f4445"
)
REAL_ADVERT_KEY = "4250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb80620"
BASE = 1792404000
LAT, LON = 52.5168, 6.083
KM_LAT = 1 / 111.32  # about one kilometre of latitude


def ob(
    dt: int = 0,
    *,
    rssi: float | None = -80,
    snr: float | None = 5.0,
    lat: float = LAT,
    lon: float = LON,
    path: list[str] | None = None,
    route: str = "F",
    packet_type: int = 5,
    raw: str = "1500aabbccdd",
    drive: int = 1,
    user: int = 1,
) -> dict:
    return {
        "drive_id": drive,
        "user_id": user,
        "username": f"u{user}",
        "radio_key": f"R{user}",
        "rx_ts": BASE + dt,
        "rssi": rssi,
        "snr": snr,
        "lat": lat,
        "lon": lon,
        "accuracy": 5.0,
        "packet_type": packet_type,
        "route": route,
        "path": ["a1b2", "c3"] if path is None else path,
        "raw": raw,
        "hash": f"{dt:016x}",
    }


def tr(dt: int, lat: float = LAT, lon: float = LON, drive: int = 1, user: int = 1, dur: int = 10):
    return {
        "drive_id": drive,
        "user_id": user,
        "radio_key": f"R{user}",
        "t0_ts": BASE + dt,
        "t1_ts": BASE + dt + dur,
        "lat": lat,
        "lon": lon,
    }


def report(obs=(), tracks=(), nodes=(), res: int = 9) -> dict:
    return build_report(list(obs), list(tracks), list(nodes), res, False)


def test_bands_follow_the_page_tiers():
    assert band(-90) == "strong"
    assert band(-70) == "strong"
    assert band(-90.5) == "fair"
    assert band(-110) == "fair"
    assert band(-110.1) == "weak"
    assert band(None) == "none"


def test_an_empty_scope_gives_zeros():
    r = report()
    s = r["summary"]
    assert (s["drives"], s["drivers"], s["radios"], s["receptions"], s["nodes_heard"]) == (
        0,
        0,
        0,
        0,
        0,
    )
    assert s["first_ts"] is None and s["rssi_median"] is None and s["snr_median"] is None
    assert s["distance_m"] == 0 and s["drive_seconds"] == 0
    assert r["coverage"]["covered_share"] is None
    assert r["coverage"]["cells_driven"] == 0
    assert r["weak_spots"] == {"gaps": 0, "weak": 0, "total": 0, "cells": []}
    assert r["nodes"] == [] and r["cells"] == [] and r["points"] == [] and r["tracks"] == []
    assert r["truncated"] is False


def test_heard_by_the_last_relay_of_a_flood():
    assert heard_id(ob(path=["a1b2", "c3"])) == ("c3", False)


@pytest.mark.parametrize(
    "row",
    [
        ob(route="D", path=["a1"]),
        ob(path=[]),
        ob(packet_type=9, path=["a1", "b2"]),
    ],
    ids=["direct route", "zero-hop non-advert", "trace"],
)
def test_not_attributed(row):
    assert heard_id(row) is None


def test_a_zero_hop_advert_is_heard_from_its_signer():
    assert heard_id(ob(path=[], route="D", packet_type=4, raw=REAL_ADVERT)) == (
        REAL_ADVERT_KEY,
        True,
    )
    # One signature byte flipped: the measurement is no proof of who sent it.
    forged = REAL_ADVERT[:120] + ("0" if REAL_ADVERT[120] != "0" else "1") + REAL_ADVERT[121:]
    assert heard_id(ob(path=[], route="D", packet_type=4, raw=forged)) is None


def test_cells_gaps_and_covered_share():
    far = LAT + KM_LAT
    gap_lat = LAT + 2 * KM_LAT
    r = report(
        obs=[ob(0, rssi=-80), ob(10, rssi=-100), ob(20, rssi=-115, lat=far)],
        tracks=[tr(0), tr(60, lat=gap_lat, dur=45)],
    )
    cov = r["coverage"]
    assert cov["cells_driven"] == 3
    assert cov["cells_covered"] == 2
    assert cov["covered_share"] == pytest.approx(2 / 3)
    assert cov["cell_bands"] == {"strong": 1, "fair": 0, "weak": 1}
    home = next(c for c in r["cells"] if c["id"] == hexgrid.cell_at(LAT, LON, 9))
    assert (home["receptions"], home["rssi_best"], home["rssi_median"]) == (2, -80, -90)
    assert home["band"] == "strong"
    assert home["best_node"] == {"id": "c3", "name": None, "guess": False, "rssi": -80}
    assert [c["rssi_best"] for c in cov["strongest"]] == [-80, -115]
    assert [c["rssi_best"] for c in cov["weakest"]] == [-115, -80]
    ws = r["weak_spots"]
    assert (ws["gaps"], ws["weak"], ws["total"]) == (1, 1, 2)
    gap = ws["cells"][0]
    assert gap["id"] == hexgrid.cell_at(gap_lat, LON, 9)
    assert (gap["receptions"], gap["track_s"], gap["band"]) == (0, 45, "none")


def test_weak_spot_lists_nodes_heard_next_door():
    home = hexgrid.cell_at(LAT, LON, 9)
    next_door = hexgrid.cell_center(hexgrid.neighbours(home)[0])
    assert next_door is not None
    r = report(obs=[ob(0, rssi=-95)], tracks=[tr(0), tr(30, lat=next_door[0], lon=next_door[1])])
    gap = r["weak_spots"]["cells"][0]
    assert gap["receptions"] == 0
    assert gap["nearby"] == [{"id": "c3", "name": None, "guess": False, "rssi_best": -95}]


def test_distance_and_time_on_the_road():
    r = report(
        tracks=[
            tr(0),
            tr(60, lat=LAT + KM_LAT),
            tr(120, lat=LAT + 2 * KM_LAT),
            tr(0, drive=2, lat=10, lon=10, dur=600),
        ]
    )
    s = r["summary"]
    assert s["distance_m"] == pytest.approx(2000, rel=0.01)
    assert s["drives"] == 2
    # drive 1: 0..130, drive 2: 0..600
    assert s["drive_seconds"] == 130 + 600


def test_summary_numbers():
    r = report(
        obs=[ob(0, rssi=-80, snr=4), ob(30, rssi=-100, snr=6, user=2, drive=2), ob(60, rssi=None)],
    )
    s = r["summary"]
    assert (s["receptions"], s["drives"], s["drivers"], s["radios"]) == (3, 2, 2, 2)
    assert (s["rssi_best"], s["rssi_median"], s["rssi_worst"]) == (-80, -90, -100)
    assert s["snr_median"] == 5.0
    assert s["bands"] == {"strong": 1, "fair": 1, "weak": 0, "none": 1}
    assert (s["first_ts"], s["last_ts"]) == (BASE, BASE + 60)
    assert s["attributed"] == 3 and s["nodes_heard"] == 1


NODES = [
    {
        "public_key": "c3" + "11" * 31,
        "name": "Toren",
        "role": "Repeater",
        "lat": LAT,
        "lon": LON + 0.05,
        "seen": 1,
    },
    {
        "public_key": "a1b2" + "22" * 30,
        "name": "Dak",
        "role": None,
        "lat": None,
        "lon": None,
        "seen": 2,
    },
    {
        "public_key": "a1b2" + "33" * 30,
        "name": "Mast",
        "role": None,
        "lat": None,
        "lon": None,
        "seen": 3,
    },
    {
        "public_key": REAL_ADVERT_KEY,
        "name": "ESNODE",
        "role": "Repeater",
        "lat": None,
        "lon": None,
        "seen": 4,
    },
]


def test_node_names_and_reach():
    r = report(
        obs=[
            ob(0, rssi=-80, path=["c3"]),
            ob(10, rssi=-100, path=["c3"], lat=LAT + KM_LAT),
            ob(20, path=["a1b2"]),
            ob(30, path=[], route="D", packet_type=4, raw=REAL_ADVERT),
        ],
        nodes=NODES,
    )
    by_id = {n["id"]: n for n in r["nodes"]}
    toren = by_id["c3"]
    assert (toren["name"], toren["guess"], toren["role"]) == ("Toren", True, "Repeater")
    assert (toren["receptions"], toren["rssi_best"], toren["rssi_worst"]) == (2, -80, -100)
    assert toren["cells"] == 2
    assert toren["farthest_m"] == pytest.approx(3533, rel=0.01)
    assert by_id["a1b2"]["name"] is None  # Dak and Mast share the prefix
    esnode = by_id[REAL_ADVERT_KEY]
    assert (esnode["name"], esnode["guess"], esnode["full_key"]) == ("ESNODE", False, True)
    assert r["nodes"][0]["id"] == "c3"  # most receptions first


def test_a_one_byte_id_is_named_only_by_a_node_in_reach():
    far_node = {**NODES[0], "lat": LAT + 1.0}  # about 111 km away
    r = report(obs=[ob(0, path=["c3"])], nodes=[far_node])
    assert r["nodes"][0]["name"] is None


def test_points_are_sampled_to_five_thousand():
    r = report(obs=[ob(i, rssi=-90) for i in range(6000)])
    assert len(r["points"]) == 5000
    assert r["points"][0]["ts"] == BASE
    assert r["points"][-1]["ts"] == BASE + 5999
    assert r["summary"]["receptions"] == 6000


def test_tracks_keep_at_most_two_thousand_points_with_both_ends():
    r = report(tracks=[tr(i * 10, lat=LAT + i * 1e-5) for i in range(5000)])
    points = r["tracks"][0]["points"]
    assert len(points) <= 2000
    assert points[0][2] == BASE
    assert points[-1][2] == BASE + 49990


def test_via_uses_the_nodes_own_signal_not_the_cells_best():
    r = report(
        obs=[
            ob(0, rssi=-70, path=[], route="D"),  # not attributed, but strongest
            ob(10, rssi=-90, path=["c3"]),
        ]
    )
    cell = r["cells"][0]
    assert cell["rssi_best"] == -70
    assert cell["best_node"] == {"id": "c3", "name": None, "guess": False, "rssi": -90}


def test_nearby_nodes_carry_their_own_signal_and_guess_mark():
    home = hexgrid.cell_at(LAT, LON, 9)
    next_door = hexgrid.cell_center(hexgrid.neighbours(home)[0])
    assert next_door is not None
    r = report(
        obs=[ob(0, rssi=-70, path=[], route="D"), ob(5, rssi=-95, path=["c3"])],
        tracks=[tr(30, lat=next_door[0], lon=next_door[1])],
        nodes=[NODES[0]],
    )
    gap = r["weak_spots"]["cells"][0]
    assert gap["nearby"] == [{"id": "c3", "name": "Toren", "guess": True, "rssi_best": -95}]
    home_cell = next(c for c in r["cells"] if c["id"] == home)
    assert home_cell["best_node"]["guess"] is True


def test_a_truncated_report_keeps_one_common_time_window():
    from app.wardrive.report import trim_to_common_window

    # Receptions dense and recent, tracks sparse and reaching further back.
    obs = [ob(1000 + i) for i in range(5)]
    tracks = [tr(i * 100) for i in range(20)]
    kept_obs, kept_tracks, cut = trim_to_common_window(obs, tracks, limit=5)
    assert cut == BASE + 1000
    assert len(kept_obs) == 5
    assert all(t["t0_ts"] >= BASE + 1000 for t in kept_tracks)
    # Not truncated: nothing is cut.
    assert trim_to_common_window(obs, tracks, limit=50) == (obs, tracks, None)


def test_tracks_and_cells_are_capped_in_total(monkeypatch):
    import app.wardrive.report as report_module

    monkeypatch.setattr(report_module, "MAX_TOTAL_TRACK_POINTS", 50)
    monkeypatch.setattr(report_module, "MAX_REPORT_CELLS", 10)
    tracks = [tr(i * 10, lat=LAT + i * 0.003, drive=d) for d in range(1, 11) for i in range(20)]
    r = report(tracks=tracks)
    assert sum(len(t["points"]) for t in r["tracks"]) <= 50
    assert all(len(t["points"]) >= 2 for t in r["tracks"])
    assert len(r["cells"]) == 10
    assert r["coverage"]["cells_driven"] > 10
