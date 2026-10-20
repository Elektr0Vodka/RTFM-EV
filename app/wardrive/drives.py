"""Wardrive drives: one stored session of one radio, created by the page's
drive uid or derived from stored rows by rx's ride gap (more than 10 minutes
between successive rows starts a new drive).

The handlers here serve both the driver API (``viewer`` = the logged-in
wardrive user: reads follow their visibility, changes only their own drives)
and the owner's admin API (``viewer`` None: everything).
"""

import asyncio
import json
import re
import time
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from app.repository.wardrive import WardriveDriveRepository, WardriveGroupRepository
from app.wardrive import export
from app.wardrive import nodes as wardrive_nodes
from app.wardrive.crypto import normalize_key
from app.wardrive.report import REPORT_MAX_ROWS, build_report, trim_to_common_window
from app.wardrive.visibility import visible_user_ids

GAP_S = 600
UID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MAX_NAME = 64
MAX_NOTES = 1000
MAX_MERGE = 50


def split_by_gap(times: list[int], gap_s: int = GAP_S) -> list[list[int]]:
    """Indexes of ``times`` (sorted ascending) grouped into drives: a gap of
    more than ``gap_s`` seconds starts the next group; exactly ``gap_s`` does not."""
    groups: list[list[int]] = []
    last: int | None = None
    for i, t in enumerate(times):
        if last is None or t - last > gap_s:
            groups.append([])
        groups[-1].append(i)
        last = t
    return groups


class DriveUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_NAME + 32)
    notes: str | None = Field(default=None, max_length=MAX_NOTES)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if len(v) > MAX_NAME:
            raise ValueError(f"A drive name has at most {MAX_NAME} characters")
        return v or None

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return (v.strip() or None) if v is not None else None


class MergeBody(BaseModel):
    ids: list[int] = Field(min_length=2, max_length=MAX_MERGE)


class SplitBody(BaseModel):
    at: int = Field(ge=0, le=2**40, description="Unix seconds; rows at or after it move")


async def scope_user_ids(
    viewer: dict[str, Any] | None, user_id: int | None, group_id: int | None
) -> set[int] | None:
    """Whose rows a request covers. ``viewer`` None is the owner (None =
    everyone); a driver's set is always cut to their visibility. An unknown
    group is a 404."""
    ids: set[int] | None = None
    if group_id is not None:
        group = next(
            (g for g in await WardriveGroupRepository.list_all() if g["id"] == group_id), None
        )
        if group is None:
            raise HTTPException(status_code=404, detail="No such group")
        ids = set(group["member_ids"])
    if user_id is not None:
        ids = {user_id} if ids is None else ids & {user_id}
    if viewer is not None:
        visible = await visible_user_ids(viewer)
        if visible is not None:
            ids = visible if ids is None else ids & visible
    return ids


def _out(row: dict[str, Any], viewer: dict[str, Any] | None) -> dict[str, Any]:
    keys = (
        "id",
        "user_id",
        "username",
        "radio_key",
        "radio_name",
        "name",
        "notes",
        "start_ts",
        "end_ts",
        "obs",
        "tracks",
    )
    out = {k: row.get(k) for k in keys}
    out["can_edit"] = viewer is None or row["user_id"] == viewer["id"]
    return out


async def _listed(drive_id: int, viewer: dict[str, Any] | None) -> dict[str, Any]:
    rows, _ = await WardriveDriveRepository.list_drives(
        None, None, None, None, 1, drive_ids=[drive_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No such drive")
    return _out(rows[0], viewer)


async def visible_drive(drive_id: int, viewer: dict[str, Any] | None) -> dict[str, Any]:
    """The drive, when ``viewer`` may see it; else 404 (an invisible drive
    does not exist for them)."""
    drive = await WardriveDriveRepository.get(drive_id)
    if drive is None:
        raise HTTPException(status_code=404, detail="No such drive")
    if viewer is not None:
        visible = await visible_user_ids(viewer)
        if visible is not None and drive["user_id"] not in visible:
            raise HTTPException(status_code=404, detail="No such drive")
    return drive


async def _editable(drive_id: int, viewer: dict[str, Any] | None) -> dict[str, Any]:
    drive = await visible_drive(drive_id, viewer)
    if viewer is not None and drive["user_id"] != viewer["id"]:
        raise HTTPException(status_code=403, detail="Only the driver can change this drive")
    return drive


async def list_drives(
    viewer: dict[str, Any] | None,
    *,
    since: int | None,
    until: int | None,
    user_id: int | None,
    group_id: int | None,
    radio_key: str | None,
    limit: int,
) -> dict[str, Any]:
    ids = await scope_user_ids(viewer, user_id, group_id)
    key = None
    if radio_key:
        try:
            key = normalize_key(radio_key)
        except ValueError:
            raise HTTPException(status_code=404, detail="No such radio") from None
    rows, truncated = await WardriveDriveRepository.list_drives(ids, since, until, key, limit)
    return {"drives": [_out(r, viewer) for r in rows], "truncated": truncated}


async def update_drive(
    drive_id: int, body: DriveUpdate, viewer: dict[str, Any] | None
) -> dict[str, Any]:
    await _editable(drive_id, viewer)
    await WardriveDriveRepository.update(drive_id, body.model_dump(exclude_unset=True))
    return await _listed(drive_id, viewer)


async def delete_drive(drive_id: int, viewer: dict[str, Any] | None) -> dict[str, Any]:
    await _editable(drive_id, viewer)
    obs, tracks = await WardriveDriveRepository.delete_with_rows(drive_id)
    return {"status": "deleted", "obs": obs, "tracks": tracks}


async def merge_drives(body: MergeBody, viewer: dict[str, Any] | None) -> dict[str, Any]:
    ids = list(dict.fromkeys(body.ids))
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="Pick two or more drives to merge")
    drives = [await _editable(i, viewer) for i in ids]
    if len({(d["user_id"], d["radio_key"]) for d in drives}) != 1:
        raise HTTPException(status_code=422, detail="Only drives of one radio can be merged")
    drives.sort(key=lambda d: (d["start_ts"], d["id"]))
    into, others = drives[0], drives[1:]
    notes = "\n\n".join(n for n in (d["notes"] for d in drives) if n) or None
    await WardriveDriveRepository.merge(into["id"], [d["id"] for d in others], notes)
    return await _listed(into["id"], viewer)


async def split_drive(
    drive_id: int, body: SplitBody, viewer: dict[str, Any] | None
) -> dict[str, Any]:
    drive = await _editable(drive_id, viewer)
    if not drive["start_ts"] < body.at <= drive["end_ts"]:
        raise HTTPException(status_code=422, detail="Pick a time inside the drive")
    new_id = await WardriveDriveRepository.split(drive_id, body.at, int(time.time()))
    if new_id is None:
        raise HTTPException(status_code=422, detail="Both parts need receptions or track")
    return {"drive": await _listed(drive_id, viewer), "new_drive": await _listed(new_id, viewer)}


DEFAULT_REPORT_WINDOW_S = 30 * 86400


class ReportQuery(BaseModel):
    """What a report or an export covers: picked drives, or a window
    narrowed to a user, a group and a radio. Plus the cell size."""

    drive: list[int] = Field(default_factory=list)
    since: int | None = None
    until: int | None = None
    user_id: int | None = None
    group_id: int | None = None
    radio_key: str | None = None
    res: int = 9


def report_query(
    drive: Annotated[list[int] | None, Query(description="Picked drive ids (repeat)")] = None,
    since: Annotated[int | None, Query(ge=0, le=2**40)] = None,
    until: Annotated[int | None, Query(ge=0, le=2**40)] = None,
    user_id: int | None = None,
    group_id: int | None = None,
    radio_key: str | None = None,
    res: Annotated[int, Query(ge=7, le=11, description="Cell size: 7 = 720 m to 11 = 40 m")] = 9,
) -> ReportQuery:
    return ReportQuery(
        drive=drive or [],
        since=since,
        until=until,
        user_id=user_id,
        group_id=group_id,
        radio_key=radio_key,
        res=res,
    )


async def report_rows(
    q: ReportQuery, viewer: dict[str, Any] | None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool, dict[str, Any]]:
    """The rows a report covers, checked against ``viewer``'s visibility, and
    the scope as answered (window filled in when none was given)."""
    scope: dict[str, Any] = {
        "drive_ids": [],
        "since": None,
        "until": None,
        "user_id": q.user_id,
        "group_id": q.group_id,
        "radio_key": q.radio_key,
        "res": q.res,
        "cut_ts": None,
    }
    if q.drive:
        ids = list(dict.fromkeys(q.drive))
        for drive_id in ids:
            await visible_drive(drive_id, viewer)
        scope["drive_ids"] = ids
        obs, tracks, truncated = await WardriveDriveRepository.rows_for_report(
            ids, None, None, None, None, REPORT_MAX_ROWS
        )
        return _common_window(obs, tracks, truncated, scope)
    until = q.until if q.until is not None else int(time.time())
    since = q.since if q.since is not None else until - DEFAULT_REPORT_WINDOW_S
    scope["since"], scope["until"] = since, until
    user_ids = await scope_user_ids(viewer, q.user_id, q.group_id)
    key = None
    if q.radio_key:
        try:
            key = normalize_key(q.radio_key)
        except ValueError:
            raise HTTPException(status_code=404, detail="No such radio") from None
    obs, tracks, truncated = await WardriveDriveRepository.rows_for_report(
        None, user_ids, since, until, key, REPORT_MAX_ROWS
    )
    return _common_window(obs, tracks, truncated, scope)


def _common_window(
    obs: list[dict[str, Any]],
    tracks: list[dict[str, Any]],
    truncated: bool,
    scope: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool, dict[str, Any]]:
    """After a cut, keep the time both kinds cover (see trim_to_common_window)."""
    if truncated:
        obs, tracks, scope["cut_ts"] = trim_to_common_window(obs, tracks, REPORT_MAX_ROWS)
    return obs, tracks, truncated, scope


async def report_nodes(obs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """RTFM-EV's known nodes around the receptions (phase 2's /nodes sources)."""
    if not obs:
        return []
    lats = [o["lat"] for o in obs]
    lons = [o["lon"] for o in obs]
    box = await wardrive_nodes.nodes_in_box(
        max(-90.0, min(lats) - 0.2),
        min(90.0, max(lats) + 0.2),
        max(-180.0, min(lons) - 0.2),
        min(180.0, max(lons) + 0.2),
    )
    return box["nodes"]


async def make_report(q: ReportQuery, viewer: dict[str, Any] | None) -> dict[str, Any]:
    obs, tracks, truncated, scope = await report_rows(q, viewer)
    nodes = await report_nodes(obs)
    # Up to 400 000 rows: built in a worker thread, the event loop stays free.
    report = await asyncio.to_thread(build_report, obs, tracks, nodes, q.res, truncated)
    return {"scope": scope, **report}


EXPORT_MEDIA = {
    "receptions.csv": "text/csv; charset=utf-8",
    "cells.csv": "text/csv; charset=utf-8",
    "drives.geojson": "application/geo+json",
    "drives.gpx": "application/gpx+xml",
}


async def make_export(kind: str, q: ReportQuery, viewer: dict[str, Any] | None) -> Response:
    """One export file over the report's rows, as a download."""
    if kind not in EXPORT_MEDIA:
        raise HTTPException(status_code=404, detail="No such export")
    obs, tracks, truncated, _ = await report_rows(q, viewer)
    nodes = await report_nodes(obs)
    # The exports list every cell (no cap for the map).
    report = await asyncio.to_thread(
        build_report, obs, tracks, nodes, q.res, truncated, all_cells=True
    )
    names = {n["id"]: (n["name"], n["guess"]) for n in report["nodes"]}
    ids = {r["drive_id"] for r in [*obs, *tracks]}
    listed, _ = await WardriveDriveRepository.list_drives(
        None, None, None, None, len(ids) or 1, drive_ids=ids
    )
    drive_names = {d["id"]: d["name"] for d in listed}

    def render() -> str:
        if kind == "receptions.csv":
            return export.receptions_csv(obs, names)
        if kind == "cells.csv":
            return export.cells_csv(report)
        if kind == "drives.geojson":
            return json.dumps(export.geojson(obs, tracks, report, names, drive_names))
        return export.gpx(tracks, drive_names)

    body = await asyncio.to_thread(render)
    stem, ext = kind.split(".")
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    return Response(
        content=body,
        media_type=EXPORT_MEDIA[kind],
        headers={
            "Content-Disposition": f'attachment; filename="rtfm-ev-wardrive-{stem}-{day}.{ext}"'
        },
    )


async def own_groups(viewer: dict[str, Any]) -> dict[str, Any]:
    return {
        "groups": [
            {"id": g["id"], "name": g["name"]}
            for g in await WardriveGroupRepository.list_all()
            if viewer["id"] in g["member_ids"]
        ]
    }
