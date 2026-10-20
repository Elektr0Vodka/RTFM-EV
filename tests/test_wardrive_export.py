"""Wardrive exports: receptions and cells as CSV, GeoJSON, GPX."""

from __future__ import annotations

import csv
import io
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

import pytest

import app.routers.wardrive as router_module
import app.routers.wardrive_admin as admin_module
from app.wardrive import export, sessions
from app.wardrive.crypto import ChallengeStore
from app.wardrive.report import build_report
from tests.test_wardrive_report import ob, tr
from tests.wardrive_helpers import (
    PASSWORD,
    client_for,
    make_radio,
    obs,
    register,
    track,
    wardrive_app,
)

BASE = 1792404000
GPX_NS = "{http://www.topografix.com/GPX/1/1}"


def rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def test_safe_cell_defuses_formulas_only():
    assert export.safe_cell("=1+1") == "'=1+1"
    assert export.safe_cell("+31 6") == "'+31 6"
    assert export.safe_cell("@home") == "'@home"
    assert export.safe_cell("-90") == "-90"
    assert export.safe_cell("-91.5") == "-91.5"
    assert export.safe_cell("Toren") == "Toren"


def test_empty_exports_are_valid():
    report = build_report([], [], [], 9, False)
    assert rows(export.receptions_csv([], {})) == [export.RECEPTION_COLUMNS]
    assert rows(export.cells_csv(report)) == [export.CELL_COLUMNS]
    assert export.geojson([], [], report, {}, {}) == {"type": "FeatureCollection", "features": []}
    root = ET.fromstring(export.gpx([], {}))
    assert root.findall(f"{GPX_NS}trk") == []


def test_receptions_csv_quotes_and_defuses():
    o = {**ob(0, path=["c3"]), "username": 'Mike, "the" driver'}
    text = export.receptions_csv([o], {"c3": ("=1+1", True)})
    header, line = rows(text)
    assert header == export.RECEPTION_COLUMNS
    row = dict(zip(header, line, strict=True))
    assert row["driver"] == 'Mike, "the" driver'
    assert row["heard_id"] == "c3"
    assert row["heard_name"] == "'=1+1"
    assert row["heard_name_guess"] == "yes"
    assert row["rssi"] == "-80"
    assert row["hops"] == "1"
    assert row["time_utc"] == "2026-10-19T10:00:00Z"


def test_cells_csv_lists_every_cell():
    report = build_report([ob(0)], [tr(0, lat=52.6)], [], 9, False)
    header, *lines = rows(export.cells_csv(report))
    assert len(lines) == 2
    bands = {dict(zip(header, line, strict=True))["band"] for line in lines}
    assert bands == {"strong", "none"}


def test_geojson_has_points_tracks_and_cells():
    obs_rows = [ob(0), ob(10)]
    tracks = [tr(0), tr(30, lat=52.52)]
    report = build_report(obs_rows, tracks, [], 9, False)
    doc = export.geojson(obs_rows, tracks, report, {}, {1: "Ochtend"})
    kinds = [f["properties"]["kind"] for f in doc["features"]]
    assert kinds.count("reception") == 2
    assert kinds.count("track") == 1
    assert kinds.count("cell") == len(report["cells"])
    line = next(f for f in doc["features"] if f["properties"]["kind"] == "track")
    assert line["geometry"]["type"] == "LineString"
    assert line["properties"]["name"] == "Ochtend"
    cell = next(f for f in doc["features"] if f["properties"]["kind"] == "cell")
    assert cell["geometry"]["type"] == "Polygon"
    assert len(cell["geometry"]["coordinates"][0]) == 7


def test_gpx_escapes_names_and_parses():
    xml = export.gpx([tr(0), tr(30)], {1: "<A&B>"})
    root = ET.fromstring(xml)
    trk = root.findall(f"{GPX_NS}trk")
    assert len(trk) == 1
    assert trk[0].find(f"{GPX_NS}name").text == "<A&B>"
    points = trk[0].findall(f"{GPX_NS}trkseg/{GPX_NS}trkpt")
    assert len(points) == 2
    assert points[0].find(f"{GPX_NS}time").text == "2026-10-19T10:00:00Z"


@pytest.fixture
async def world(test_db, monkeypatch):
    monkeypatch.setattr(router_module, "challenges", ChallengeStore())
    monkeypatch.setattr(sessions, "login_throttle", sessions.LoginThrottle())
    app = wardrive_app(router_module.router, admin_module.router)
    async with client_for(app) as client:
        for i, name in enumerate(("A", "C")):
            radio = make_radio()
            await register(client, username=name, radio=radio)
            pk = radio[1]
            at = datetime.fromtimestamp(BASE + i * 100, UTC).isoformat().replace("+00:00", "Z")
            await client.post(
                "/api/wardrive/upload",
                json={
                    "radio_key": pk,
                    "drive_uid": f"0000000{i}-0000-4000-8000-000000000000",
                    "obs": [obs(pk, at, hash=f"{i:016x}")],
                    "tracks": [track(pk, at)],
                },
            )
        client.cookies.clear()
        yield client


async def login(client, name: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/wardrive/login", json={"username": name, "password": PASSWORD})
    assert r.status_code == 200


WINDOW = {"since": BASE - 10, "until": BASE + 1000}


@pytest.mark.parametrize(
    ("kind", "media"),
    [
        ("receptions.csv", "text/csv"),
        ("cells.csv", "text/csv"),
        ("drives.geojson", "application/geo+json"),
        ("drives.gpx", "application/gpx+xml"),
    ],
)
async def test_driver_export_is_a_named_attachment(world, kind, media):
    await login(world, "A")
    r = await world.get(f"/api/wardrive/export/{kind}", params=WINDOW)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(media)
    stem, ext = kind.split(".")
    disposition = r.headers["content-disposition"]
    assert disposition.startswith(f'attachment; filename="rtfm-ev-wardrive-{stem}-')
    assert disposition.endswith(f'.{ext}"')


async def test_driver_export_holds_only_own_rows(world):
    await login(world, "A")
    r = await world.get("/api/wardrive/export/receptions.csv", params=WINDOW)
    lines = rows(r.text)[1:]
    assert {line[1] for line in lines} == {"A"}


async def test_an_invisible_drive_cannot_be_exported(world):
    await login(world, "C")
    c_drive = (await world.get("/api/wardrive/drives")).json()["drives"][0]["id"]
    await login(world, "A")
    r = await world.get("/api/wardrive/export/drives.gpx", params={"drive": c_drive})
    assert r.status_code == 404


async def test_owner_exports_everyone(world):
    world.cookies.clear()
    r = await world.get("/api/wardrive-admin/export/receptions.csv", params=WINDOW)
    assert {line[1] for line in rows(r.text)[1:]} == {"A", "C"}
    assert (await world.get("/api/wardrive-admin/export/nope.txt")).status_code == 404
