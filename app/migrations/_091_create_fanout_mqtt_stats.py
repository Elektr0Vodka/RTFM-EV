import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``fanout_mqtt_stats``: per-broker cumulative MQTT publish counters.

    One row per ``fanout_configs.id`` (MQTT modules only). Counts are cumulative
    totals written by the publisher's periodic flush as ``baseline + session``.
    Idempotent: ``CREATE TABLE IF NOT EXISTS`` and independent of other tables.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fanout_mqtt_stats (
            config_id TEXT PRIMARY KEY,
            messages_published INTEGER NOT NULL DEFAULT 0,
            publish_failures INTEGER NOT NULL DEFAULT 0,
            reconnects INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT
        )
        """
    )
    await conn.commit()
