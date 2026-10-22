"""Repository for ``radio_scan_lists`` (migration _160): user lists of settings to cycle."""

from __future__ import annotations

import json
import time

from app.database import db
from app.models import RadioScanEntry, RadioScanList, RadioScanListRequest, TempRadioOptIns


def _normalized_entries(request: RadioScanListRequest) -> list[RadioScanEntry]:
    from app.services.temp_radio import normalize_session_region

    return [
        entry.model_copy(update={"region": normalize_session_region(entry.region)})
        for entry in request.entries
    ]


def _row_to_list(row) -> RadioScanList:
    return RadioScanList(
        id=row["id"],
        name=row["name"],
        entries=[RadioScanEntry.model_validate(e) for e in json.loads(row["entries"])],
        rounds=row["rounds"],
        normal_between_secs=row["normal_between_secs"],
        hold_on_activity_secs=row["hold_on_activity_secs"],
        opt_ins=TempRadioOptIns.model_validate(json.loads(row["opt_ins"] or "{}")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class RadioScanListsRepository:
    @staticmethod
    async def list_all() -> list[RadioScanList]:
        async with db.readonly() as conn:
            async with conn.execute("SELECT * FROM radio_scan_lists ORDER BY id") as cursor:
                rows = await cursor.fetchall()
        return [_row_to_list(row) for row in rows]

    @staticmethod
    async def get(list_id: int) -> RadioScanList | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM radio_scan_lists WHERE id = ?", (list_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_list(row) if row else None

    @staticmethod
    async def create(request: RadioScanListRequest) -> RadioScanList:
        now = int(time.time())
        entries = json.dumps([e.model_dump() for e in _normalized_entries(request)])
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO radio_scan_lists (name, entries, rounds, normal_between_secs, "
                "hold_on_activity_secs, opt_ins, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    request.name,
                    entries,
                    request.rounds,
                    request.normal_between_secs,
                    request.hold_on_activity_secs,
                    request.opt_ins.model_dump_json(),
                    now,
                    now,
                ),
            ) as cursor:
                list_id = cursor.lastrowid
        assert list_id is not None
        created = await RadioScanListsRepository.get(list_id)
        assert created is not None
        return created

    @staticmethod
    async def update(list_id: int, request: RadioScanListRequest) -> RadioScanList | None:
        entries = json.dumps([e.model_dump() for e in _normalized_entries(request)])
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE radio_scan_lists SET name = ?, entries = ?, rounds = ?, "
                "normal_between_secs = ?, hold_on_activity_secs = ?, opt_ins = ?, "
                "updated_at = ? WHERE id = ?",
                (
                    request.name,
                    entries,
                    request.rounds,
                    request.normal_between_secs,
                    request.hold_on_activity_secs,
                    request.opt_ins.model_dump_json(),
                    int(time.time()),
                    list_id,
                ),
            ) as cursor:
                if cursor.rowcount == 0:
                    return None
        return await RadioScanListsRepository.get(list_id)

    @staticmethod
    async def delete(list_id: int) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM radio_scan_lists WHERE id = ?", (list_id,)
            ) as cursor:
                return cursor.rowcount > 0
