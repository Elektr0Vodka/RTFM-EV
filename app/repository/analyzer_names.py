"""Repository for ``analyzer_resolved_names`` (plan 16 case (a)).

Latest-value cache of what a configured analyzer's node API answered for a
full public key: the name, or ``None`` for "asked, no name" so a miss is not
re-queried on every request within its TTL (the service decides the TTLs).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.database import db


@dataclass(frozen=True)
class AnalyzerResolvedName:
    pubkey: str
    resolved_name: str | None
    source_site: str
    resolved_at: int


class AnalyzerResolvedNameRepository:
    @staticmethod
    async def get(pubkey: str) -> AnalyzerResolvedName | None:
        """Return the cached answer for ``pubkey`` (lowercased), or ``None``."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT pubkey, resolved_name, source_site, resolved_at "
                "FROM analyzer_resolved_names WHERE pubkey = ?",
                (pubkey.lower(),),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return AnalyzerResolvedName(
            pubkey=row["pubkey"],
            resolved_name=row["resolved_name"],
            source_site=row["source_site"],
            resolved_at=row["resolved_at"],
        )

    @staticmethod
    async def upsert(
        pubkey: str, resolved_name: str | None, source_site: str, resolved_at: int
    ) -> None:
        """Insert or replace the cached answer for ``pubkey``."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO analyzer_resolved_names (pubkey, resolved_name, source_site, resolved_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(pubkey) DO UPDATE SET
                    resolved_name = excluded.resolved_name,
                    source_site = excluded.source_site,
                    resolved_at = excluded.resolved_at
                """,
                (pubkey.lower(), resolved_name, source_site, resolved_at),
            ):
                pass
