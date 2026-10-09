import json
import time
from collections.abc import AsyncIterator
from typing import Any

from app.database import db


def _loads(raw: Any) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class SpamGuardConfigRepository:
    """Single-row store for the Spam Guard settings document (migration _137)."""

    @staticmethod
    async def get() -> tuple[int, dict[str, Any]] | None:
        """Return ``(version, settings_dict)``, or None when never saved."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT version, settings FROM spam_guard_config WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return int(row["version"]), _loads(row["settings"])

    @staticmethod
    async def save(expected_version: int, settings: dict[str, Any]) -> int | None:
        """Write the document if the stored version is still ``expected_version``.

        Version 0 means "never saved". Returns the new version, or None when the
        stored version changed in the meantime (the caller answers 409).
        """
        now = int(time.time())
        payload = json.dumps(settings, separators=(",", ":"))
        async with db.tx() as conn:
            async with conn.execute("SELECT version FROM spam_guard_config WHERE id = 1") as cursor:
                row = await cursor.fetchone()
            current = int(row["version"]) if row is not None else 0
            if current != expected_version:
                return None
            new_version = current + 1
            async with conn.execute(
                "INSERT INTO spam_guard_config (id, version, settings, updated_at) "
                "VALUES (1, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET version = excluded.version, "
                "settings = excluded.settings, updated_at = excluded.updated_at",
                (new_version, payload, now),
            ):
                pass
        return new_version


class SpamGuardStateRepository:
    """Single-row store for what the detector has learnt (migration _137)."""

    @staticmethod
    async def get() -> dict[str, Any] | None:
        """The stored detector state, or None when nothing was saved yet."""
        async with db.readonly() as conn:
            async with conn.execute("SELECT state FROM spam_guard_state WHERE id = 1") as cursor:
                row = await cursor.fetchone()
        return None if row is None else _loads(row["state"])

    @staticmethod
    async def save(state: dict[str, Any]) -> None:
        payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO spam_guard_state (id, state, updated_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET state = excluded.state, "
                "updated_at = excluded.updated_at",
                (payload, int(time.time())),
            ):
                pass


class SpamEvidenceRepository:
    """The evidence log: one row per record (migration _133).

    Record shapes are in ``app/spam/evidence.py``. Rows are only written while
    the user has the evidence log switched on, and the retention pruner deletes
    them after ``evidence_days``.
    """

    @staticmethod
    async def add(record: dict[str, Any]) -> None:
        payload = json.dumps(record, separators=(",", ":"), ensure_ascii=False)
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO spam_evidence (ts, type, data) VALUES (?, ?, ?)",
                (float(record["ts"]), str(record["type"]), payload),
            ):
                pass

    @staticmethod
    async def iter_since(since_ts: float, *, batch: int = 2000) -> AsyncIterator[dict[str, Any]]:
        """Records at or after ``since_ts`` in the order they were written."""
        last_id = 0
        while True:
            async with db.readonly() as conn:
                async with conn.execute(
                    "SELECT id, data FROM spam_evidence WHERE ts >= ? AND id > ? "
                    "ORDER BY id LIMIT ?",
                    (since_ts, last_id, batch),
                ) as cursor:
                    rows = list(await cursor.fetchall())
            for row in rows:
                record = _loads(row["data"])
                if record:
                    yield record
            if len(rows) < batch:
                return
            last_id = int(rows[-1]["id"])

    @staticmethod
    async def list_since(since_ts: float, limit: int | None = None) -> list[dict[str, Any]]:
        """Like ``iter_since`` as a list. Raises ``ValueError`` past ``limit`` records."""
        records: list[dict[str, Any]] = []
        async for record in SpamEvidenceRepository.iter_since(since_ts):
            if limit is not None and len(records) >= limit:
                raise ValueError(f"more than {limit} evidence records in that period")
            records.append(record)
        return records

    @staticmethod
    async def prune_older_than(cutoff_ts: float) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM spam_evidence WHERE ts < ?", (cutoff_ts,)
            ) as cursor:
                return cursor.rowcount

    @staticmethod
    async def count() -> int:
        async with db.readonly() as conn:
            async with conn.execute("SELECT COUNT(*) AS n FROM spam_evidence") as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row is not None else 0
