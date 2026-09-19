"""Read queries backing the advert-links map layer."""

from app.database import db
from app.services.advert_links import AdvertPathRow, LocatedNode

# Cap on advert_events rows scanned per request (newest first) to bound work.
DEFAULT_EVENT_LIMIT = 5000


def _is_placed(lat: float | None, lon: float | None) -> bool:
    """True when a coordinate pair is set. (0, 0) is the Atlantic-Ocean
    "unset GPS" sentinel and is treated as not placed."""
    return lat is not None and lon is not None and not (lat == 0 and lon == 0)


def _effective_latlon(
    lat: float | None,
    lon: float | None,
    manual_lat: float | None,
    manual_lon: float | None,
) -> tuple[float, float] | None:
    """Advertised coordinates win; fall back to the manual override; else None.
    Mirrors the frontend ``getEffectiveLocation`` helper so a node with only a
    manual location override is placed on the advert-links layer."""
    if _is_placed(lat, lon):
        return (lat, lon)  # type: ignore[return-value]
    if _is_placed(manual_lat, manual_lon):
        return (manual_lat, manual_lon)  # type: ignore[return-value]
    return None


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
                  AND NOT (lat = 0 AND lon = 0)
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["pubkey"] or "").lower()
                    if pk:
                        by_pk[pk] = LocatedNode(pk, r["lat"], r["lon"], "external")
            async with conn.execute(
                """
                SELECT public_key, lat, lon, manual_lat, manual_lon FROM contacts
                WHERE (lat IS NOT NULL AND lon IS NOT NULL)
                   OR (manual_lat IS NOT NULL AND manual_lon IS NOT NULL)
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["public_key"] or "").lower()
                    if not pk:
                        continue
                    loc = _effective_latlon(r["lat"], r["lon"], r["manual_lat"], r["manual_lon"])
                    if loc is not None:
                        by_pk[pk] = LocatedNode(pk, loc[0], loc[1], "contact")
        return list(by_pk.values())
