import time

from app.database import db


class LinkSignalRepository:
    """Persistence for per-link signal samples (link_signal, X2b).

    Two perspectives distinguished by ``source``:
    - ``repeater_query``: SNR a repeater reported for its neighbours.
    - ``traffic``: SNR/RSSI our node measured on a direct (0-hop) advert.
    """

    @staticmethod
    async def record_repeater_samples(
        repeater_pubkey: str, neighbors: list[dict], observed_at: int
    ) -> None:
        """Insert one row per neighbour from a fetch_all_neighbours result.

        ``neighbors`` items use the meshcore dict shape: ``pubkey`` (hex prefix),
        ``snr`` (float), ``secs_ago`` (int). No-op on an empty list.
        """
        rows = [
            (
                repeater_pubkey,
                str(n.get("pubkey", "")),
                "repeater_query",
                float(n.get("snr", 0.0)),
                None,
                int(n.get("secs_ago", 0)),
                observed_at,
            )
            for n in neighbors
            if n.get("pubkey")
        ]
        if not rows:
            return
        async with db.tx() as conn:
            await conn.executemany(
                "INSERT INTO link_signal "
                "(observer_pubkey, subject_pubkey, source, snr, rssi, secs_ago, observed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    @staticmethod
    async def record_traffic_sample(
        observer_pubkey: str,
        subject_pubkey: str,
        snr: float | None,
        rssi: int | None,
        observed_at: int,
    ) -> None:
        """Insert one my-node 0-hop sample. Skips samples with no SNR."""
        if snr is None or not subject_pubkey:
            return
        async with db.tx() as conn:
            await conn.execute(
                "INSERT INTO link_signal "
                "(observer_pubkey, subject_pubkey, source, snr, rssi, secs_ago, observed_at) "
                "VALUES (?, ?, 'traffic', ?, ?, NULL, ?)",
                (observer_pubkey, subject_pubkey, float(snr), rssi, observed_at),
            )

    @staticmethod
    async def get_repeater_history(repeater_pubkey: str, since: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT subject_pubkey, snr, secs_ago, observed_at FROM link_signal "
                "WHERE source='repeater_query' AND observer_pubkey=? AND observed_at>=? "
                "ORDER BY subject_pubkey ASC, observed_at ASC",
                (repeater_pubkey, since),
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "subject_pubkey": r["subject_pubkey"],
                "snr": r["snr"],
                "secs_ago": r["secs_ago"],
                "observed_at": r["observed_at"],
            }
            for r in rows
        ]

    @staticmethod
    async def get_traffic_history_for_subjects(prefixes: list[str], since: int) -> list[dict]:
        """Traffic samples whose subject_pubkey starts with any given prefix."""
        clean = [p for p in prefixes if p]
        if not clean:
            return []
        like_clause = " OR ".join("subject_pubkey LIKE ?" for _ in clean)
        params: list = [since, *[f"{p}%" for p in clean]]
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT subject_pubkey, snr, rssi, observed_at FROM link_signal "
                f"WHERE source='traffic' AND observed_at>=? AND ({like_clause}) "
                "ORDER BY subject_pubkey ASC, observed_at ASC",
                params,
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "subject_pubkey": r["subject_pubkey"],
                "snr": r["snr"],
                "rssi": r["rssi"],
                "observed_at": r["observed_at"],
            }
            for r in rows
        ]

    @staticmethod
    async def prune(older_than_days: int = 30) -> int:
        cutoff = int(time.time()) - older_than_days * 86400
        async with db.tx() as conn:
            cur = await conn.execute("DELETE FROM link_signal WHERE observed_at < ?", (cutoff,))
            return cur.rowcount
