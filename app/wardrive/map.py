"""The coverage map's server side (Tools > Wardrive Map tab and the driver
page's Map tab): stored receptions with who each was heard from, filtered
the way the map filters, paged; hex cells over the same rows; the drivers in
a window. Visibility is the caller's job (``scope``: ``None`` = everyone).

Every filter runs here, so the points, the cells, the receptions list and
Locate always agree."""

import asyncio
import time
from functools import lru_cache
from typing import Annotated, Any

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field

from app.repository.wardrive import (
    WardriveDataRepository,
    WardriveGroupRepository,
    WardriveUserRepository,
)
from app.wardrive import hexgrid
from app.wardrive.drives import report_nodes, scope_user_ids
from app.wardrive.models import MAX_TS
from app.wardrive.report import NodeNames
from app.wardrive.senders import (
    ID_CLASSES,
    TYPE_VALUES,
    UNKNOWN,
    ChannelKey,
    channel_keys,
    decode_sender,
    id_class,
)
from app.wardrive.visibility import visible_user_ids

# Rows read per request at most (newest kept); a page of points at most.
MAP_MAX_ROWS = 200000
MAX_PAGE = 5000
# Cells are binned from at most this many filtered rows (newest kept), the
# cap map.mesh-hunter.eu's heatmap has.
CELLS_MAX_ROWS = 50000
DEFAULT_WINDOW_S = 30 * 86400
FULL_KEY_KINDS = ("advert_pubkey", "discover_pubkey")


class MapQuery(BaseModel):
    """What the map shows: a window, whose rows, which senders and kinds."""

    since: int
    until: int
    users: list[int] = Field(default_factory=list)
    group_id: int | None = None
    radio_key: str | None = None
    senders: list[str] = Field(default_factory=list)
    sender_prefix: str | None = None
    types: list[str] = Field(default_factory=list)
    idclass: list[str] = Field(default_factory=list)
    nopath: bool = False
    ignore: list[str] = Field(default_factory=list)
    bbox: tuple[float, float, float, float] | None = None
    limit: int = MAX_PAGE
    offset: int = 0


def _comma(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    parts = value.split(",")
    try:
        south, west, north, east = (float(p) for p in parts)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="bbox is south,west,north,east in degrees"
        ) from None
    if not (-90 <= south <= north <= 90 and -180 <= west <= east <= 180):
        raise HTTPException(status_code=422, detail="bbox is out of range or upside down")
    return south, west, north, east


def map_query(
    since: Annotated[int | None, Query(ge=0, le=MAX_TS)] = None,
    until: Annotated[int | None, Query(ge=0, le=MAX_TS)] = None,
    users: Annotated[str | None, Query(description="Comma list of user ids")] = None,
    group_id: int | None = None,
    radio_key: str | None = None,
    sender: Annotated[list[str] | None, Query(description="Sender ids (repeat)")] = None,
    sender_prefix: Annotated[str | None, Query(max_length=64)] = None,
    types: Annotated[str | None, Query(description="Comma list of packet type names")] = None,
    idclass: Annotated[str | None, Query(description="Comma list of id classes")] = None,
    nopath: bool = False,
    ignore: Annotated[list[str] | None, Query(description="Ignored sender ids (repeat)")] = None,
    bbox: Annotated[str | None, Query(description="south,west,north,east")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = MAX_PAGE,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MapQuery:
    end = until if until is not None else int(time.time())
    start = since if since is not None else max(0, end - DEFAULT_WINDOW_S)
    type_list = _comma(types)
    bad = [t for t in type_list if t not in TYPE_VALUES and t != UNKNOWN]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown packet type: {bad[0]}")
    class_list = _comma(idclass)
    bad = [c for c in class_list if c not in ID_CLASSES]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown id class: {bad[0]}")
    try:
        user_list = [int(u) for u in _comma(users)]
    except ValueError:
        raise HTTPException(status_code=422, detail="users is a comma list of ids") from None
    return MapQuery(
        since=start,
        until=end,
        users=user_list,
        group_id=group_id,
        radio_key=radio_key,
        senders=[s for s in (sender or []) if s],
        sender_prefix=sender_prefix or None,
        types=type_list,
        idclass=class_list,
        nopath=nopath,
        ignore=[s for s in (ignore or []) if s],
        bbox=_bbox(bbox),
        limit=limit,
        offset=offset,
    )


@lru_cache(maxsize=200000)
def _decode_cached(raw: str, keys: tuple[ChannelKey, ...]) -> dict[str, Any]:
    return decode_sender(raw, list(keys))


def _keep(point: dict[str, Any], q: MapQuery) -> bool:
    sender = point["sender"]
    ident = (sender["id"] or "").lower()
    if ident and ident in {s.lower() for s in q.ignore}:
        return False
    if q.nopath and point["hops"] != 0:
        return False
    if q.types and point["packet_type_name"] not in q.types:
        return False
    if q.idclass and id_class(sender) not in q.idclass:
        return False
    if q.senders and ident not in {s.lower() for s in q.senders}:
        return False
    return not (q.sender_prefix and not ident.startswith(q.sender_prefix.lower()))


def _point(row: dict[str, Any], decoded: dict[str, Any]) -> dict[str, Any]:
    return {
        "rx_at": row["rx_at"],
        "rx_ts": row["rx_ts"],
        "rssi": row["rssi"],
        "snr": row["snr"],
        "lat": row["lat"],
        "lon": row["lon"],
        "accuracy": row["accuracy"],
        "user_id": row["user_id"],
        "driver": row["username"],
        "radio_key": row["radio_key"],
        "radio_name": row["radio_name"],
        "packet_type": row["packet_type"],
        "packet_type_name": decoded["packet_type_name"],
        "route": row["route"],
        "path": row["path"],
        "hops": decoded["hops"],
        "sender": dict(decoded["sender"]),
        "channel": decoded["channel"],
        "drive_id": row["drive_id"],
        "drive_name": row["drive_name"],
        "hash": row["hash"],
        "pub_at": row["pub_at"],
        "uploaded_at": row["uploaded_at"],
        "len": row["len"],
        "payload_len": row["payload_len"],
        "src": row["src"],
    }


async def filtered_points(
    scope: set[int] | None, q: MapQuery, *, with_names: bool = True
) -> tuple[list[dict[str, Any]], bool, str | None]:
    """Every point under ``q`` (no paging), newest first, whether the read
    cap cut the window, and how far back the read reached when it did."""
    if q.users:
        scope = set(q.users) if scope is None else scope & set(q.users)
    rows, capped = await WardriveDataRepository.map_rows(
        scope, q.since, q.until, q.radio_key, q.bbox, MAP_MAX_ROWS
    )
    keys = tuple(await channel_keys())
    covers_from = rows[-1]["rx_at"] if capped and rows else None
    nodes = await report_nodes(rows) if with_names else []

    def work() -> list[dict[str, Any]]:
        names = NodeNames(nodes)
        out: list[dict[str, Any]] = []
        for row in rows:
            point = _point(row, _decode_cached(row["raw"], keys))
            if not _keep(point, q):
                continue
            out.append(point)
            if not with_names:
                continue
            sender = point["sender"]
            name, guess = None, False
            if sender["kind"] == "channel_name":
                name = sender["label"]
            elif sender["id"]:
                full = sender["kind"] in FULL_KEY_KINDS and len(sender["id"]) == 64
                _, resolved, guessed = names.resolve(sender["id"], full, (row["lat"], row["lon"]))
                name = resolved or sender["label"]
                guess = bool(resolved and guessed)
            point["name"], point["guess"] = name, guess
        return out

    return await asyncio.to_thread(work), capped, covers_from


async def map_points(scope: set[int] | None, q: MapQuery) -> dict[str, Any]:
    """One page of points: ``{points, truncated, covers_from}``."""
    points, capped, covers_from = await filtered_points(scope, q)
    page = points[q.offset : q.offset + q.limit]
    more = len(points) > q.offset + q.limit
    return {"points": page, "truncated": capped or more, "covers_from": covers_from}


async def map_cells(scope: set[int] | None, q: MapQuery, res: int) -> dict[str, Any]:
    """The filtered rows binned on CoreScope's hex grid at ``res``: per cell
    the best RSSI, the count, how many drivers, and its outline (lon, lat).
    ``{cells, truncated, covers_from}``."""
    points, capped, covers_from = await filtered_points(scope, q, with_names=False)
    if len(points) > CELLS_MAX_ROWS:
        points = points[:CELLS_MAX_ROWS]
        capped = True
        covers_from = points[-1]["rx_at"]

    def work() -> list[dict[str, Any]]:
        cells: dict[str, dict[str, Any]] = {}
        for p in points:
            cid = hexgrid.cell_at(p["lat"], p["lon"], res)
            cell = cells.setdefault(cid, {"best": None, "count": 0, "users": set()})
            cell["count"] += 1
            cell["users"].add(p["user_id"])
            if p["rssi"] is not None and (cell["best"] is None or p["rssi"] > cell["best"]):
                cell["best"] = p["rssi"]
        return [
            {
                "cell": cid,
                "best": c["best"],
                "count": c["count"],
                "drivers": len(c["users"]),
                "ring": [list(corner) for corner in hexgrid.cell_ring(cid) or []],
            }
            for cid, c in cells.items()
        ]

    return {"cells": await asyncio.to_thread(work), "truncated": capped, "covers_from": covers_from}


async def map_drivers(scope: set[int] | None, since: int, until: int) -> dict[str, Any]:
    """The drivers in ``scope`` with receptions in the window, newest first,
    for the driver picker."""
    return {"drivers": await WardriveDataRepository.driver_roster(scope, since, until)}


async def view_scope(as_user: int | None, as_group: int | None) -> set[int] | None:
    """Whose rows the owner sees: everyone, or exactly what one driver would
    see, or what the members of a group would see together. A disabled driver
    can still be viewed. Unknown ids are a 404."""
    if as_user is not None:
        user = await WardriveUserRepository.get(as_user)
        if user is None:
            raise HTTPException(status_code=404, detail="No such user")
        return await visible_user_ids(user)
    if as_group is not None:
        group = next(
            (g for g in await WardriveGroupRepository.list_all() if g["id"] == as_group), None
        )
        if group is None:
            raise HTTPException(status_code=404, detail="No such group")
        union: set[int] = set()
        for member_id in group["member_ids"]:
            member = await WardriveUserRepository.get(member_id)
            if member is None:
                continue
            visible = await visible_user_ids(member)
            if visible is None:
                return None
            union |= visible
        return union
    return None


async def request_scope(
    viewer: dict[str, Any] | None, q: MapQuery, base: set[int] | None = None
) -> set[int] | None:
    """A driver's visibility (``viewer``) or the owner's view scope
    (``base``), narrowed by the group filter."""
    scope = await scope_user_ids(viewer, None, q.group_id)
    if viewer is None and base is not None:
        scope = base if scope is None else scope & base
    return scope
