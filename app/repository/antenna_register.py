"""Repository for the Dutch Antenneregister map cache (``antenna_register_sites``).

A sync is a full refresh, so :meth:`replace_all` swaps the whole table
atomically. Map reads are bounding-box scoped and return summaries; the popup
fetches one site's transmitters by id.
"""

import json

from app.database import db
from app.models import AntennaRegisterSite, AntennaRegisterSiteSummary, AntennaRegisterTransmitter


def _bands(value: str) -> list[str]:
    return [b for b in value.split(",") if b]


# A site serialised for the table, minus ``synced_at``. The sync builds these as
# it goes so ~18k sites do not sit in memory as pydantic models.
SiteRow = tuple[int, float, float, str, str, str, str, str, float | None, float | None, str]


def _site_from_row(row) -> AntennaRegisterSite:
    return AntennaRegisterSite(
        id=row["id"],
        lat=row["lat"],
        lon=row["lon"],
        municipality=row["municipality"],
        postcode=row["postcode"],
        place=row["place"],
        kinds=row["kinds"],
        bands=_bands(row["bands"]),
        max_power_dbw=row["max_power_dbw"],
        max_height_m=row["max_height_m"],
        transmitters=[
            AntennaRegisterTransmitter(**t) for t in json.loads(row["transmitters"] or "[]")
        ],
    )


class AntennaRegisterRepository:
    @staticmethod
    def to_row(s: AntennaRegisterSite) -> SiteRow:
        return (
            s.id,
            s.lat,
            s.lon,
            s.municipality,
            s.postcode,
            s.place,
            s.kinds,
            ",".join(s.bands),
            s.max_power_dbw,
            s.max_height_m,
            json.dumps([t.model_dump() for t in s.transmitters], separators=(",", ":")),
        )

    @staticmethod
    async def replace_all(sites: list[AntennaRegisterSite], synced_at: int) -> int:
        """Atomically replace the cached site set. Returns rows written."""
        rows = [AntennaRegisterRepository.to_row(s) for s in sites]
        return await AntennaRegisterRepository.replace_all_rows(rows, synced_at)

    @staticmethod
    async def replace_all_rows(rows: list[SiteRow], synced_at: int) -> int:
        """Atomically replace the cached site set from :meth:`to_row` rows."""
        async with db.tx() as conn:
            await conn.execute("DELETE FROM antenna_register_sites")
            if rows:
                await conn.executemany(
                    """
                    INSERT OR REPLACE INTO antenna_register_sites
                        (id, lat, lon, municipality, postcode, place, kinds, bands,
                         max_power_dbw, max_height_m, transmitters, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [(*row, synced_at) for row in rows],
                )
        return len(rows)

    @staticmethod
    async def query_bbox(
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
        limit: int,
    ) -> tuple[list[AntennaRegisterSiteSummary], bool]:
        """Sites inside a lat/lon box, strongest first, and whether the cap hit."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT id, lat, lon, bands, max_power_dbw, max_height_m
                FROM antenna_register_sites
                WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                ORDER BY max_power_dbw IS NULL, max_power_dbw DESC, id
                LIMIT ?
                """,
                (min_lat, max_lat, min_lon, max_lon, limit + 1),
            ) as cursor:
                rows = list(await cursor.fetchall())
        sites = [
            AntennaRegisterSiteSummary(
                id=row["id"],
                lat=row["lat"],
                lon=row["lon"],
                bands=_bands(row["bands"]),
                max_power_dbw=row["max_power_dbw"],
                max_height_m=row["max_height_m"],
            )
            for row in rows[:limit]
        ]
        return sites, len(rows) > limit

    @staticmethod
    async def query_bbox_full(
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
        limit: int,
    ) -> tuple[list[AntennaRegisterSite], bool]:
        """Full sites (with transmitters) inside a lat/lon box, strongest first,
        and whether the cap hit. For the zoomed-in radiation pattern view."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT * FROM antenna_register_sites
                WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                ORDER BY max_power_dbw IS NULL, max_power_dbw DESC, id
                LIMIT ?
                """,
                (min_lat, max_lat, min_lon, max_lon, limit + 1),
            ) as cursor:
                rows = list(await cursor.fetchall())
        return [_site_from_row(row) for row in rows[:limit]], len(rows) > limit

    @staticmethod
    async def get(site_id: int) -> AntennaRegisterSite | None:
        """One cached site with its transmitters, or ``None``."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM antenna_register_sites WHERE id = ?", (site_id,)
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return _site_from_row(row)

    @staticmethod
    async def all_compact() -> list[tuple]:
        """Every site as ``(id, lat, lon, bands, max_power_dbw, max_height_m)``.

        Plain tuples, no models: the map loads all ~26k sites at once and model
        construction dominated that request.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, lat, lon, bands, max_power_dbw, max_height_m "
                "FROM antenna_register_sites ORDER BY id"
            ) as cursor:
                rows = await cursor.fetchall()
        return [tuple(row) for row in rows]

    @staticmethod
    async def status() -> tuple[int, int | None]:
        """``(site_count, last_synced_at)`` for the cache."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) AS c, MAX(synced_at) AS m FROM antenna_register_sites"
            ) as cursor:
                row = await cursor.fetchone()
        if not row:
            return 0, None
        return int(row["c"] or 0), row["m"]
