"""Repository for ``contact_radio_profiles`` (migration _160): saved per-contact settings."""

from __future__ import annotations

import time

from app.database import db
from app.models import ContactRadioProfile, RadioStamp


def _row_to_profile(row) -> ContactRadioProfile:
    return ContactRadioProfile(
        public_key=row["public_key"],
        radio=RadioStamp(freq=row["freq"], bw=row["bw"], sf=row["sf"], cr=row["cr"]),
        region=row["region"],
        duration_secs=row["duration_secs"],
        auto_switch=bool(row["auto_switch"]),
        updated_at=row["updated_at"],
    )


class ContactRadioProfilesRepository:
    @staticmethod
    async def get(public_key: str) -> ContactRadioProfile | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT * FROM contact_radio_profiles WHERE public_key = ?",
                (public_key.lower(),),
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_profile(row) if row else None

    @staticmethod
    async def get_all() -> dict[str, ContactRadioProfile]:
        async with db.readonly() as conn:
            async with conn.execute("SELECT * FROM contact_radio_profiles") as cursor:
                rows = await cursor.fetchall()
        return {row["public_key"]: _row_to_profile(row) for row in rows}

    @staticmethod
    async def upsert(
        public_key: str,
        *,
        radio: RadioStamp,
        region: str | None,
        duration_secs: int,
        auto_switch: bool,
    ) -> ContactRadioProfile:
        key = public_key.lower()
        now = int(time.time())
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO contact_radio_profiles
                    (public_key, freq, bw, sf, cr, region, duration_secs, auto_switch, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(public_key) DO UPDATE SET
                    freq = excluded.freq, bw = excluded.bw, sf = excluded.sf, cr = excluded.cr,
                    region = excluded.region, duration_secs = excluded.duration_secs,
                    auto_switch = excluded.auto_switch, updated_at = excluded.updated_at
                """,
                (
                    key,
                    radio.freq,
                    radio.bw,
                    radio.sf,
                    radio.cr,
                    region,
                    duration_secs,
                    1 if auto_switch else 0,
                    now,
                ),
            )
        return ContactRadioProfile(
            public_key=key,
            radio=radio,
            region=region,
            duration_secs=duration_secs,
            auto_switch=auto_switch,
            updated_at=now,
        )

    @staticmethod
    async def delete(public_key: str) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM contact_radio_profiles WHERE public_key = ?",
                (public_key.lower(),),
            ) as cursor:
                return cursor.rowcount > 0
