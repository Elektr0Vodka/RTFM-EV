from app.database import db
from app.models import SnmpAgentSettings


class SnmpAgentRepository:
    """Settings of RTFM-EV's own SNMP agent (table ``snmp_agent``, one row)."""

    @staticmethod
    async def get() -> SnmpAgentSettings:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT enabled, port, community FROM snmp_agent WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return SnmpAgentSettings()
        return SnmpAgentSettings(
            enabled=bool(row["enabled"]), port=int(row["port"]), community=row["community"]
        )

    @staticmethod
    async def save(settings: SnmpAgentSettings) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO snmp_agent (id, enabled, port, community) VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    enabled = excluded.enabled,
                    port = excluded.port,
                    community = excluded.community
                """,
                (int(settings.enabled), settings.port, settings.community),
            ):
                pass
