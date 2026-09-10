import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create link_signal for per-link signal history (X2b).

    Stores per-neighbor signal samples from two perspectives:
    - source='repeater_query': SNR a repeater reported for its neighbours,
      observer_pubkey = the queried repeater's full key, subject_pubkey = the
      neighbour pubkey prefix, secs_ago set, rssi NULL.
    - source='traffic': SNR/RSSI our own node measured on a 0-hop advert,
      observer_pubkey = our own key, subject_pubkey = the advertiser full key,
      rssi set, secs_ago NULL.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS link_signal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            observer_pubkey TEXT NOT NULL,
            subject_pubkey TEXT NOT NULL,
            source TEXT NOT NULL,
            snr REAL NOT NULL,
            rssi INTEGER,
            secs_ago INTEGER,
            observed_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_lookup "
        "ON link_signal(observer_pubkey, subject_pubkey, observed_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_subject "
        "ON link_signal(subject_pubkey, observed_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_observed_at "
        "ON link_signal(observed_at)"
    )
    await conn.commit()
