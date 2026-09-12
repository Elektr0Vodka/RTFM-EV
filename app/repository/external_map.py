"""Repository for externally-synced map nodes (``external_map_nodes``).

A local cache of located nodes pulled from an external analyzer directory. A
sync is a full-directory refresh, so :meth:`replace_all` swaps the whole table
atomically. Reads are bounding-box scoped for the viewport-driven map overlay.
"""

from app.database import db
from app.models import ExternalMapNode


class ExternalMapRepository:
    @staticmethod
    async def replace_all(nodes: list[ExternalMapNode], source: str, synced_at: int) -> int:
        """Atomically replace the cached node set with ``nodes``.

        The external directory returns every node each fetch, so a full replace
        keeps the cache in step (nodes dropped from the directory disappear).
        Returns the number of rows written.
        """
        rows = [
            (
                n.pubkey.lower(),
                n.name,
                n.role,
                n.lat,
                n.lon,
                n.last_seen,
                n.advert_count,
                1 if n.mobile else 0,
                source,
                synced_at,
            )
            for n in nodes
        ]
        async with db.tx() as conn:
            await conn.execute("DELETE FROM external_map_nodes")
            if rows:
                await conn.executemany(
                    """
                    INSERT INTO external_map_nodes
                        (pubkey, name, role, lat, lon, last_seen, advert_count,
                         mobile, source, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(pubkey) DO UPDATE SET
                        name = excluded.name,
                        role = excluded.role,
                        lat = excluded.lat,
                        lon = excluded.lon,
                        last_seen = excluded.last_seen,
                        advert_count = excluded.advert_count,
                        mobile = excluded.mobile,
                        source = excluded.source,
                        synced_at = excluded.synced_at
                    """,
                    rows,
                )
        return len(rows)

    @staticmethod
    async def query_bbox(
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
        limit: int = 2000,
    ) -> list[ExternalMapNode]:
        """Return located nodes inside a lat/lon bounding box, newest first.

        Capped at ``limit`` rows (ordered by ``last_seen`` desc) to keep the map
        responsive when a wide view spans many nodes.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT pubkey, name, role, lat, lon, last_seen, advert_count, mobile
                FROM external_map_nodes
                WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                ORDER BY last_seen DESC
                LIMIT ?
                """,
                (min_lat, max_lat, min_lon, max_lon, limit),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            ExternalMapNode(
                pubkey=row["pubkey"],
                name=row["name"],
                role=row["role"],
                lat=row["lat"],
                lon=row["lon"],
                last_seen=row["last_seen"],
                advert_count=row["advert_count"],
                mobile=bool(row["mobile"]),
            )
            for row in rows
        ]

    @staticmethod
    async def status() -> tuple[int, int | None]:
        """Return ``(count, last_synced_at)`` for the cached node set."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) AS c, MAX(synced_at) AS m FROM external_map_nodes"
            ) as cursor:
                row = await cursor.fetchone()
        if not row:
            return 0, None
        return int(row["c"] or 0), row["m"]
