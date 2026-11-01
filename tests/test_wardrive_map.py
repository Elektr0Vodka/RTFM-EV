"""The coverage map's server side: receptions with their sender, filtered,
paged, binned into cells, and the driver roster."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import HTTPException

import app.wardrive.map as map_module
from app.repository.contacts import ContactRepository
from app.repository.wardrive import (
    WardriveConfigRepository,
    WardriveDataRepository,
    WardriveUserRepository,
)
from app.wardrive.config import HASHTAG_CHANNELS
from app.wardrive.map import MapQuery, map_cells, map_drivers, map_points, map_query
from app.wardrive.models import Obs
from tests.wardrive_helpers import obs

BASE = 1792404000
VECTORS = {
    v["name"]: v["raw"]
    for v in json.loads(
        (Path(__file__).parent / "fixtures" / "wardrive_sender_vectors.json").read_text("utf-8")
    )
}
ADVERT_KEY = "4250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb80620"
RADIO_A = "A1" * 32
RADIO_B = "B2" * 32


def iso(dt: int) -> str:
    return (
        datetime.fromtimestamp(BASE + dt, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def q(**over) -> MapQuery:
    base = {"since": BASE - 10, "until": BASE + 10000}
    return MapQuery(**{**base, **over})


async def user(name: str) -> int:
    return await WardriveUserRepository.create(name, "x", now=1)


async def put(uid: int, radio: str, dt: int, raw: str, **over) -> None:
    """One stored reception ``dt`` seconds after BASE (hash unique per dt)."""
    pos = {"lat": 52.1, "lon": 5.1, "accuracy": 4.0, "src": "phone"}
    pos.update(over.pop("pos", {}))
    msg = obs(radio, iso(dt), hash=f"{dt:016x}", raw=raw, path=[], pos=pos, **over)
    await WardriveDataRepository.insert_obs(uid, radio, [Obs(**msg)], now=BASE + dt)


@pytest.fixture
async def world(test_db):
    """A: an advert (dt 1), a relayed channel message (2), a direct Response
    (3). B: a zero-hop channel message (4) further north."""
    await WardriveConfigRepository.set_json(HASHTAG_CHANNELS, ["#test"], now=1)
    a = await user("A")
    b = await user("B")
    await put(a, RADIO_A, 1, VECTORS["advert signed"], RSSI=-80)
    await put(a, RADIO_A, 2, VECTORS["flood 2-byte hops"], RSSI=-100)
    await put(a, RADIO_A, 3, VECTORS["response zero hop"], RSSI=-115)
    await put(b, RADIO_B, 4, VECTORS["channel zero hop"], RSSI=-95, pos={"lat": 52.9})
    await ContactRepository.upsert(
        {"public_key": ADVERT_KEY, "name": "Esnode", "type": 2, "last_advert": 1000}
    )
    return {"A": a, "B": b}


def kinds(result) -> list[str | None]:
    return [p["sender"]["kind"] for p in result["points"]]


async def test_points_carry_sender_name_and_driver(world):
    result = await map_points(None, q())
    assert [p["rx_ts"] for p in result["points"]] == [BASE + 4, BASE + 3, BASE + 2, BASE + 1]
    advert = result["points"][-1]
    assert advert["sender"]["kind"] == "advert_pubkey"
    assert advert["sender"]["id"] == ADVERT_KEY
    assert advert["name"] == "Esnode"
    assert advert["driver"] == "A"
    assert advert["packet_type_name"] == "Advert"
    assert "raw" not in advert
    # Every stored field, for the reception card.
    assert advert["pub_at"] == "2026-10-19T10:00:01.000Z"
    assert advert["uploaded_at"] == BASE + 1
    assert (advert["len"], advert["payload_len"], advert["src"]) == (6, 4, "phone")
    assert advert["drive_name"] is None
    assert advert["path"] == []
    assert result["truncated"] is False
    assert result["covers_from"] is None


async def test_points_carry_the_stored_path(test_db):
    uid = await user("A")
    await put(uid, RADIO_A, 1, VECTORS["flood 1-byte hops"])
    await WardriveDataRepository.insert_obs(
        uid,
        RADIO_A,
        [
            Obs(
                **obs(
                    RADIO_A,
                    iso(2),
                    hash=f"{2:016x}",
                    raw=VECTORS["flood 1-byte hops"],
                    path=["a1", "b2"],
                )
            )
        ],
        now=BASE,
    )
    paths = [p["path"] for p in (await map_points(None, q()))["points"]]
    assert paths == [["a1", "b2"], []]


async def test_scope_limits_users(world):
    result = await map_points({world["B"]}, q())
    assert [p["driver"] for p in result["points"]] == ["B"]


async def test_types_filter(world):
    assert kinds(await map_points(None, q(types=["Advert", "Response"]))) == [
        "direct_hash",
        "advert_pubkey",
    ]


async def test_idclass_filter(world):
    assert kinds(await map_points(None, q(idclass=["2b"]))) == ["relay"]
    assert kinds(await map_points(None, q(idclass=["channel", "pubkey"]))) == [
        "channel_name",
        "advert_pubkey",
    ]


async def test_nopath_keeps_zero_hop_only(world):
    assert kinds(await map_points(None, q(nopath=True))) == [
        "channel_name",
        "direct_hash",
        "advert_pubkey",
    ]


async def test_sender_exact_and_prefix(world):
    assert kinds(await map_points(None, q(senders=["C3D4"]))) == ["relay"]
    assert kinds(await map_points(None, q(sender_prefix="4250"))) == ["advert_pubkey"]
    assert kinds(await map_points(None, q(sender_prefix="ali"))) == ["channel_name"]


async def test_ignore_drops_sender(world):
    assert kinds(await map_points(None, q(ignore=["4a", "alice"]))) == [
        "relay",
        "advert_pubkey",
    ]


async def test_users_param_narrows(world):
    result = await map_points(None, q(users=[world["B"]]))
    assert [p["driver"] for p in result["points"]] == ["B"]


async def test_bbox_limits_rows(world):
    result = await map_points(None, q(bbox=(52.5, 5.0, 53.0, 5.5)))
    assert [p["driver"] for p in result["points"]] == ["B"]


@pytest.mark.parametrize("bbox", ["53,5,52,6", "91,0,92,1", "52,5,53", "a,b,c,d"])
def test_bad_bbox_is_422(bbox):
    with pytest.raises(HTTPException) as err:
        map_query(since=None, until=BASE, bbox=bbox)
    assert err.value.status_code == 422


@pytest.mark.parametrize("field", [{"types": "Bogus"}, {"idclass": "4b"}])
def test_unknown_type_or_class_is_422(field):
    with pytest.raises(HTTPException) as err:
        map_query(since=None, until=BASE, **field)
    assert err.value.status_code == 422


def test_since_defaults_to_30_days_before_until():
    assert map_query(since=None, until=BASE).since == BASE - 30 * 86400


async def test_paging_offset_limit_and_truncated(test_db):
    uid = await user("P")
    for dt in range(1, 8):
        await put(uid, RADIO_A, dt, VECTORS["response zero hop"])
    page = await map_points(None, q(limit=3, offset=3))
    assert [p["rx_ts"] for p in page["points"]] == [BASE + 4, BASE + 3, BASE + 2]
    assert page["truncated"] is True
    last = await map_points(None, q(limit=3, offset=6))
    assert [p["rx_ts"] for p in last["points"]] == [BASE + 1]
    assert last["truncated"] is False


async def test_covers_from_when_read_cap_hit(test_db, monkeypatch):
    monkeypatch.setattr(map_module, "MAP_MAX_ROWS", 5)
    uid = await user("P")
    for dt in range(1, 8):
        await put(uid, RADIO_A, dt, VECTORS["response zero hop"])
    result = await map_points(None, q())
    assert len(result["points"]) == 5
    assert result["truncated"] is True
    assert result["covers_from"] == iso(3)


async def test_cells_bin_best_count_drivers(test_db):
    a = await user("A")
    b = await user("B")
    await put(a, RADIO_A, 1, VECTORS["response zero hop"], RSSI=-100)
    await put(a, RADIO_A, 2, VECTORS["response zero hop"], RSSI=-90)
    await put(b, RADIO_B, 3, VECTORS["response zero hop"], RSSI=-110)
    await put(b, RADIO_B, 4, VECTORS["response zero hop"], RSSI=-70, pos={"lat": 52.9})
    result = await map_cells(None, q(), 9)
    cells = sorted(result["cells"], key=lambda c: -c["count"])
    assert [(c["count"], c["best"], c["drivers"]) for c in cells] == [(3, -90, 2), (1, -70, 1)]
    assert cells[0]["cell"].startswith("9:")
    assert len(cells[0]["ring"]) == 7
    assert cells[0]["ring"][0] == cells[0]["ring"][-1]
    assert result["truncated"] is False
    assert result["covers_from"] is None


async def test_cells_follow_filters(world):
    result = await map_cells(None, q(types=["GroupText"]), 9)
    assert sum(c["count"] for c in result["cells"]) == 2


async def test_cells_without_rssi_have_no_best(test_db):
    uid = await user("A")
    await put(uid, RADIO_A, 1, VECTORS["response zero hop"], RSSI=None)
    result = await map_cells(None, q(), 9)
    assert result["cells"][0]["best"] is None


async def test_cells_cap_keeps_newest(test_db, monkeypatch):
    monkeypatch.setattr(map_module, "CELLS_MAX_ROWS", 2)
    uid = await user("A")
    for dt in range(1, 5):
        await put(uid, RADIO_A, dt, VECTORS["response zero hop"])
    result = await map_cells(None, q(), 9)
    assert sum(c["count"] for c in result["cells"]) == 2
    assert result["truncated"] is True
    assert result["covers_from"] == iso(3)


async def test_roster_lists_drivers_with_rows_newest_first(world):
    result = await map_drivers(None, BASE - 10, BASE + 10000)
    assert [(d["username"], d["count"]) for d in result["drivers"]] == [("B", 1), ("A", 3)]
    assert result["drivers"][0]["last_rx_at"] == iso(4)


async def test_roster_respects_scope(world):
    result = await map_drivers({world["A"]}, BASE - 10, BASE + 10000)
    assert [d["username"] for d in result["drivers"]] == ["A"]


async def test_roster_last_position_is_newest_row(test_db):
    uid = await user("A")
    await put(uid, RADIO_A, 1, VECTORS["response zero hop"], pos={"lat": 51.0, "lon": 4.0})
    await put(uid, RADIO_A, 9, VECTORS["response zero hop"], pos={"lat": 53.0, "lon": 6.0})
    (driver,) = (await map_drivers(None, BASE - 10, BASE + 10000))["drivers"]
    assert (driver["last_lat"], driver["last_lon"]) == (53.0, 6.0)
    assert driver["user_id"] == uid


async def test_roster_window_excludes_older_rows(world):
    result = await map_drivers(None, BASE + 4, BASE + 10000)
    assert [d["username"] for d in result["drivers"]] == ["B"]
