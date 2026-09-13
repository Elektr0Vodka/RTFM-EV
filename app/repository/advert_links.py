"""Read queries backing the advert-links map layer."""

from app.database import db
from app.services.advert_links import AdvertPathRow, LocatedNode

# Cap on advert_events rows scanned per request (newest first) to bound work.
DEFAULT_EVENT_LIMIT = 5000


class AdvertLinksRepository:
    @staticmethod
    async def recent_events(limit: int = DEFAULT_EVENT_LIMIT) -> list[AdvertPathRow]:
        """Most recent advert transmissions, newest first, capped at ``limit``."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT public_key, path_hex, hop_width, min_path_len, first_seen
                FROM advert_events
                ORDER BY first_seen DESC
                LIMIT ?
                """,
                (limit,),
            ) as cur:
                rows = await cur.fetchall()
        return [
            AdvertPathRow(
                public_key=(r["public_key"] or "").lower(),
                path_hex=(r["path_hex"] or "").lower(),
                hop_width=r["hop_width"],
                min_path_len=r["min_path_len"] or 0,
                first_seen=r["first_seen"] or 0,
            )
            for r in rows
        ]

    @staticmethod
    async def located_nodes() -> list[LocatedNode]:
        """GPS-placed nodes: local contacts UNION analyzer nodes.

        A local contact wins over an external node with the same pubkey.
        """
        by_pk: dict[str, LocatedNode] = {}
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT pubkey, lat, lon FROM external_map_nodes
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["pubkey"] or "").lower()
                    if pk:
                        by_pk[pk] = LocatedNode(pk, r["lat"], r["lon"], "external")
            async with conn.execute(
                """
                SELECT public_key, lat, lon FROM contacts
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["public_key"] or "").lower()
                    if pk:
                        by_pk[pk] = LocatedNode(pk, r["lat"], r["lon"], "contact")
        return list(by_pk.values())
