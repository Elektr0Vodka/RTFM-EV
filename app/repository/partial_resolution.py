"""Repository for soft partial-node resolution links (``partial_node_resolutions``).

Stores reversible prefix -> full-pubkey links matched from the external-map
cache. Keyed by ``prefix_hex`` (lowercased hex). Never touches ``contacts``.
"""

from datetime import UTC, datetime

from app.database import db
from app.models import PartialNodeResolution


def _row_to_model(row) -> PartialNodeResolution:
    return PartialNodeResolution(
        prefix_hex=row["prefix_hex"],
        resolved_pubkey=row["resolved_pubkey"],
        resolved_name=row["resolved_name"],
        source=row["source"],
        confidence=row["confidence"],
        candidate_count=row["candidate_count"],
        resolved_by=row["resolved_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class PartialResolutionRepository:
    @staticmethod
    async def upsert(
        prefix_hex: str,
        resolved_pubkey: str,
        resolved_name: str | None,
        confidence: float,
        candidate_count: int,
        source: str = "external_map",
        resolved_by: str = "user",
    ) -> None:
        """Insert or replace the soft link for ``prefix_hex``.

        ``created_at`` is preserved across updates; ``updated_at`` is refreshed.
        """
        now = datetime.now(UTC).isoformat()
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO partial_node_resolutions
                    (prefix_hex, resolved_pubkey, resolved_name, source, confidence,
                     candidate_count, resolved_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(prefix_hex) DO UPDATE SET
                    resolved_pubkey = excluded.resolved_pubkey,
                    resolved_name = excluded.resolved_name,
                    source = excluded.source,
                    confidence = excluded.confidence,
                    candidate_count = excluded.candidate_count,
                    resolved_by = excluded.resolved_by,
                    updated_at = excluded.updated_at
                """,
                (
                    prefix_hex.lower(),
                    resolved_pubkey.lower(),
                    resolved_name,
                    source,
                    confidence,
                    candidate_count,
                    resolved_by,
                    now,
                    now,
                ),
            )

    @staticmethod
    async def list_all() -> list[PartialNodeResolution]:
        """All soft links, ordered by prefix ascending."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM partial_node_resolutions ORDER BY prefix_hex"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_model(row) for row in rows]

    @staticmethod
    async def delete(prefix_hex: str) -> bool:
        """Clear the soft link for ``prefix_hex``. Returns True if a row was removed."""
        async with db.tx() as conn:
            cursor = await conn.execute(
                "DELETE FROM partial_node_resolutions WHERE prefix_hex = ?",
                (prefix_hex.lower(),),
            )
            return cursor.rowcount > 0
