import json
import time
from typing import Any

from app.database import db

# Columns the operator edits. The order is the INSERT order.
ASSET_FIELDS: tuple[str, ...] = (
    "public_key",
    "label",
    "org_serial",
    "hw_serial",
    "model",
    "role",
    "wifi_mac",
    "ble_mac",
    "assigned_to",
    "site_name",
    "status",
    "target_firmware",
    "notes",
)

EVENT_FIELDS: tuple[str, ...] = (
    "kind",
    "occurred_at",
    "summary",
    "detail",
    "actor",
    "from_value",
    "to_value",
)


def _last_event(kind: str) -> str:
    return (
        "(SELECT MAX(e.occurred_at) FROM fleet_asset_events e "
        f"WHERE e.asset_id = a.id AND e.kind = '{kind}')"
    )


# The contact position is the manual one when set, like everywhere else.
_SELECT = f"""
    SELECT a.id, {", ".join(f"a.{field}" for field in ASSET_FIELDS)},
           a.created_at, a.updated_at,
           {_last_event("maintenance")} AS last_maintenance,
           {_last_event("failure")} AS last_failure,
           c.public_key AS contact_key, c.name AS contact_name, c.type AS contact_type,
           c.last_seen AS contact_last_seen,
           COALESCE(c.manual_lat, c.lat) AS contact_lat,
           COALESCE(c.manual_lon, c.lon) AS contact_lon
      FROM fleet_assets a
      LEFT JOIN contacts c ON c.public_key = a.public_key
"""

_EVENT_SELECT = (
    f"SELECT id, asset_id, {', '.join(EVENT_FIELDS)}, created_at FROM fleet_asset_events"
)


def _row_to_asset(row) -> dict[str, Any]:
    asset: dict[str, Any] = {"id": row["id"]}
    for field in ASSET_FIELDS:
        asset[field] = row[field]
    asset["created_at"] = row["created_at"]
    asset["updated_at"] = row["updated_at"]
    asset["last_maintenance"] = row["last_maintenance"]
    asset["last_failure"] = row["last_failure"]
    asset["contact"] = (
        None
        if row["contact_key"] is None
        else {
            "name": row["contact_name"],
            "type": row["contact_type"],
            "last_seen": row["contact_last_seen"],
            "lat": row["contact_lat"],
            "lon": row["contact_lon"],
        }
    )
    return asset


def _row_to_event(row) -> dict[str, Any]:
    event: dict[str, Any] = {"id": row["id"], "asset_id": row["asset_id"]}
    for field in EVENT_FIELDS:
        event[field] = row[field]
    event["created_at"] = row["created_at"]
    return event


def _insert_event_sql(fields: dict[str, Any]) -> tuple[str, list[Any]]:
    columns = [field for field in EVENT_FIELDS if field in fields]
    sql = (
        f"INSERT INTO fleet_asset_events (asset_id, {', '.join(columns)}, created_at) "
        f"VALUES (?, {', '.join('?' for _ in columns)}, ?)"
    )
    return sql, [fields[column] for column in columns]


class FleetAssetRepository:
    @staticmethod
    async def get_all(public_key: str | None = None) -> list[dict[str, Any]]:
        """Every asset with its contact, or only the asset of one public key."""
        query = _SELECT
        params: tuple[Any, ...] = ()
        if public_key is not None:
            query += " WHERE a.public_key = ?"
            params = (public_key,)
        async with db.readonly() as conn:
            async with conn.execute(query + " ORDER BY a.id", params) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_asset(row) for row in rows]

    @staticmethod
    async def get(asset_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(_SELECT + " WHERE a.id = ?", (asset_id,)) as cursor:
                row = await cursor.fetchone()
        return _row_to_asset(row) if row else None

    @staticmethod
    async def public_key_owner(public_key: str) -> int | None:
        """Id of the asset that holds this public key, if any."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id FROM fleet_assets WHERE public_key = ?", (public_key,)
            ) as cursor:
                row = await cursor.fetchone()
        return row["id"] if row else None

    @staticmethod
    async def create(fields: dict[str, Any], events: list[dict[str, Any]] | None = None) -> int:
        """Insert an asset and its first log rows in one transaction.

        ``fields`` holds ``ASSET_FIELDS`` keys; absent ones stay NULL or take the
        column default. ``events`` hold ``EVENT_FIELDS`` keys.
        """
        now = int(time.time())
        columns = [field for field in ASSET_FIELDS if field in fields]
        async with db.tx() as conn:
            async with conn.execute(
                f"""
                INSERT INTO fleet_assets ({", ".join(columns)}, created_at, updated_at)
                VALUES ({", ".join("?" for _ in columns)}, ?, ?)
                """,
                (*(fields[column] for column in columns), now, now),
            ) as cursor:
                new_id = cursor.lastrowid
            assert new_id is not None
            for event in events or []:
                sql, values = _insert_event_sql(event)
                await conn.execute(sql, (new_id, *values, now))
        return new_id

    @staticmethod
    async def update(
        asset_id: int, changes: dict[str, Any], events: list[dict[str, Any]] | None = None
    ) -> bool:
        """Set the given ``ASSET_FIELDS`` columns and write ``events`` with them.

        One transaction: a log row never exists without the change it records.
        False when the asset does not exist.
        """
        columns = [field for field in ASSET_FIELDS if field in changes]
        if not columns:
            return await FleetAssetRepository.get(asset_id) is not None
        now = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                f"""
                UPDATE fleet_assets
                   SET {", ".join(f"{column} = ?" for column in columns)}, updated_at = ?
                 WHERE id = ?
                """,
                (*(changes[column] for column in columns), now, asset_id),
            ) as cursor:
                rowcount = cursor.rowcount
            if rowcount > 0:
                for event in events or []:
                    sql, values = _insert_event_sql(event)
                    await conn.execute(sql, (asset_id, *values, now))
        return rowcount > 0

    @staticmethod
    async def delete(asset_id: int) -> bool:
        """Delete the asset and its log rows."""
        async with db.tx() as conn:
            await conn.execute("DELETE FROM fleet_asset_events WHERE asset_id = ?", (asset_id,))
            async with conn.execute("DELETE FROM fleet_assets WHERE id = ?", (asset_id,)) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def reported_firmware() -> dict[str, dict[str, Any]]:
        """Newest firmware version each fleet node reported, by public key.

        Two stored sources: the repeater owner pane (``device_config_history``,
        kind ``owner_info``) and SNMP polls. The newer one wins. Nothing here
        asks a node anything.
        """
        sources = (
            (
                "owner_info",
                """
                SELECT h.public_key, h.timestamp, h.data
                  FROM device_config_history h
                 WHERE h.kind = 'owner_info'
                   AND h.public_key IN
                       (SELECT public_key FROM fleet_assets WHERE public_key IS NOT NULL)
                 ORDER BY h.timestamp DESC, h.id DESC
                """,
            ),
            (
                "snmp",
                """
                SELECT h.public_key, h.timestamp, h.data
                  FROM snmp_history h
                 WHERE h.public_key IN
                       (SELECT public_key FROM fleet_assets WHERE public_key IS NOT NULL)
                   AND h.timestamp = (SELECT MAX(n.timestamp) FROM snmp_history n
                                       WHERE n.public_key = h.public_key)
                 ORDER BY h.id DESC
                """,
            ),
        )
        newest: dict[str, dict[str, Any]] = {}
        async with db.readonly() as conn:
            for source, query in sources:
                seen: set[str] = set()
                async with conn.execute(query) as cursor:
                    rows = await cursor.fetchall()
                for row in rows:
                    key = row["public_key"]
                    if key in seen:
                        continue  # rows are newest first: only the first per node counts
                    seen.add(key)
                    try:
                        data = json.loads(row["data"])
                    except (TypeError, ValueError):
                        continue
                    version = data.get("firmware_version") if isinstance(data, dict) else None
                    if not isinstance(version, str) or not version.strip():
                        continue
                    current = newest.get(key)
                    if current is None or row["timestamp"] > current["firmware_at"]:
                        newest[key] = {
                            "firmware_version": version.strip(),
                            "firmware_at": row["timestamp"],
                            "firmware_source": source,
                        }
        return newest


class FleetEventRepository:
    @staticmethod
    async def get_for_asset(asset_id: int) -> list[dict[str, Any]]:
        """The asset's log, newest first."""
        async with db.readonly() as conn:
            async with conn.execute(
                _EVENT_SELECT + " WHERE asset_id = ? ORDER BY occurred_at DESC, id DESC",
                (asset_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_event(row) for row in rows]

    @staticmethod
    async def create(asset_id: int, fields: dict[str, Any]) -> dict[str, Any]:
        sql, values = _insert_event_sql(fields)
        async with db.tx() as conn:
            async with conn.execute(sql, (asset_id, *values, int(time.time()))) as cursor:
                new_id = cursor.lastrowid
            async with conn.execute(_EVENT_SELECT + " WHERE id = ?", (new_id,)) as cursor:
                row = await cursor.fetchone()
        return _row_to_event(row)

    @staticmethod
    async def delete(asset_id: int, event_id: int) -> bool:
        """Delete one log row, only when it belongs to this asset."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM fleet_asset_events WHERE id = ? AND asset_id = ?",
                (event_id, asset_id),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0


class FleetSettingsRepository:
    @staticmethod
    async def get() -> dict[str, Any]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT silent_hours, low_battery_volts FROM fleet_settings WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:  # the row is made by the migration; fall back to its defaults
            return {"silent_hours": 48, "low_battery_volts": 3.5}
        return {"silent_hours": row["silent_hours"], "low_battery_volts": row["low_battery_volts"]}

    @staticmethod
    async def save(silent_hours: int, low_battery_volts: float) -> None:
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO fleet_settings (id, silent_hours, low_battery_volts)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    silent_hours = excluded.silent_hours,
                    low_battery_volts = excluded.low_battery_volts
                """,
                (silent_hours, low_battery_volts),
            )
