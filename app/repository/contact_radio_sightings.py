"""Repository for ``contact_radio_sightings`` (migration _160).

One row per contact per LoRa settings set it was heard on, so a node near a
border that bridges an SF7 and an SF8 mesh shows both. Frequency and
bandwidth are rounded to 3 decimals before storing, so float noise from the
radio does not create a second row for the same settings.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.database import db
from app.models import RadioStamp


class ContactRadioSighting(BaseModel):
    freq: float
    bw: float
    sf: int
    cr: int
    first_seen: int
    last_seen: int


def _key(stamp: RadioStamp) -> tuple[float, float, int, int]:
    return (round(stamp.freq, 3), round(stamp.bw, 3), stamp.sf, stamp.cr)


class ContactRadioSightingsRepository:
    @staticmethod
    async def record(public_key: str, stamp: RadioStamp, seen_at: int) -> bool:
        """Upsert a sighting. True when this settings set is new for the contact."""
        key = public_key.lower()
        freq, bw, sf, cr = _key(stamp)
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT OR IGNORE INTO contact_radio_sightings "
                "(public_key, freq, bw, sf, cr, first_seen, last_seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (key, freq, bw, sf, cr, seen_at, seen_at),
            ) as cursor:
                inserted = cursor.rowcount > 0
            if not inserted:
                await conn.execute(
                    "UPDATE contact_radio_sightings SET last_seen = MAX(last_seen, ?) "
                    "WHERE public_key = ? AND freq = ? AND bw = ? AND sf = ? AND cr = ?",
                    (seen_at, key, freq, bw, sf, cr),
                )
        return inserted

    @staticmethod
    async def get_all() -> dict[str, list[ContactRadioSighting]]:
        """Every contact's sightings, oldest first per contact."""
        result: dict[str, list[ContactRadioSighting]] = {}
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT public_key, freq, bw, sf, cr, first_seen, last_seen "
                "FROM contact_radio_sightings ORDER BY public_key, first_seen"
            ) as cursor:
                rows = await cursor.fetchall()
        for row in rows:
            result.setdefault(row["public_key"], []).append(
                ContactRadioSighting(
                    freq=row["freq"],
                    bw=row["bw"],
                    sf=row["sf"],
                    cr=row["cr"],
                    first_seen=row["first_seen"],
                    last_seen=row["last_seen"],
                )
            )
        return result

    @staticmethod
    async def delete_for(public_key: str) -> None:
        async with db.tx() as conn:
            await conn.execute(
                "DELETE FROM contact_radio_sightings WHERE public_key = ?",
                (public_key.lower(),),
            )
