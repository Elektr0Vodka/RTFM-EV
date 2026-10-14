import json
import time
from typing import Any

from app.database import db

# Columns beside the document. The order is the INSERT order.
CONFIG_FIELDS: tuple[str, ...] = (
    "kind",
    "source",
    "profile",
    "role",
    "firmware_version",
    "label",
)
# The ones that may be corrected after a config was stored.
CONFIG_EDITABLE: tuple[str, ...] = ("profile", "role", "firmware_version", "label")

TEMPLATE_FIELDS: tuple[str, ...] = ("name", "description", "profile", "role")

_CONFIG_SELECT = (
    f"SELECT id, asset_id, {', '.join(CONFIG_FIELDS)}, document, created_at FROM fleet_configs"
)
_TEMPLATE_SELECT = (
    f"SELECT id, {', '.join(TEMPLATE_FIELDS)}, document, variables, created_at, updated_at "
    "FROM fleet_config_templates"
)


def _row_to_config(row) -> dict[str, Any]:
    config: dict[str, Any] = {"id": row["id"], "asset_id": row["asset_id"]}
    for field in CONFIG_FIELDS:
        config[field] = row[field]
    config["document"] = json.loads(row["document"])
    config["created_at"] = row["created_at"]
    return config


def _row_to_template(row) -> dict[str, Any]:
    template: dict[str, Any] = {"id": row["id"]}
    for field in TEMPLATE_FIELDS:
        template[field] = row[field]
    template["document"] = json.loads(row["document"])
    template["variables"] = json.loads(row["variables"])
    template["created_at"] = row["created_at"]
    template["updated_at"] = row["updated_at"]
    return template


class FleetConfigRepository:
    """Stored config documents of fleet assets.

    A document handed in here must already be free of secret values
    (``app.services.fleet_config.split_secrets``). It is never updated.
    """

    @staticmethod
    async def get_for_asset(asset_id: int) -> list[dict[str, Any]]:
        """The asset's configs, newest first."""
        async with db.readonly() as conn:
            async with conn.execute(
                _CONFIG_SELECT + " WHERE asset_id = ? ORDER BY created_at DESC, id DESC",
                (asset_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_config(row) for row in rows]

    @staticmethod
    async def get(config_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(_CONFIG_SELECT + " WHERE id = ?", (config_id,)) as cursor:
                row = await cursor.fetchone()
        return _row_to_config(row) if row else None

    @staticmethod
    async def create(asset_id: int, fields: dict[str, Any], document: dict[str, Any]) -> int:
        """Store a document. ``fields`` holds ``CONFIG_FIELDS`` keys."""
        async with db.tx() as conn:
            async with conn.execute(
                f"""
                INSERT INTO fleet_configs (asset_id, {", ".join(CONFIG_FIELDS)}, document,
                                           created_at)
                VALUES (?, {", ".join("?" for _ in CONFIG_FIELDS)}, ?, ?)
                """,
                (
                    asset_id,
                    *(fields.get(field) for field in CONFIG_FIELDS),
                    json.dumps(document),
                    int(time.time()),
                ),
            ) as cursor:
                new_id = cursor.lastrowid
        assert new_id is not None
        return new_id

    @staticmethod
    async def update_details(config_id: int, changes: dict[str, Any]) -> None:
        """Set ``CONFIG_EDITABLE`` columns. The document is never touched."""
        columns = [field for field in CONFIG_EDITABLE if field in changes]
        if not columns:
            return
        async with db.tx() as conn:
            await conn.execute(
                f"UPDATE fleet_configs SET {', '.join(f'{column} = ?' for column in columns)} "
                "WHERE id = ?",
                (*(changes[column] for column in columns), config_id),
            )

    @staticmethod
    async def delete(config_id: int) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM fleet_configs WHERE id = ?", (config_id,)
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0


class FleetConfigTemplateRepository:
    @staticmethod
    async def get_all() -> list[dict[str, Any]]:
        async with db.readonly() as conn:
            async with conn.execute(_TEMPLATE_SELECT + " ORDER BY name COLLATE NOCASE, id") as cur:
                rows = await cur.fetchall()
        return [_row_to_template(row) for row in rows]

    @staticmethod
    async def get(template_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(_TEMPLATE_SELECT + " WHERE id = ?", (template_id,)) as cursor:
                row = await cursor.fetchone()
        return _row_to_template(row) if row else None

    @staticmethod
    async def create(
        fields: dict[str, Any], document: dict[str, Any], variables: list[dict[str, Any]]
    ) -> int:
        """Store a template. ``fields`` holds ``TEMPLATE_FIELDS`` keys."""
        now = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                f"""
                INSERT INTO fleet_config_templates ({", ".join(TEMPLATE_FIELDS)}, document,
                                                    variables, created_at, updated_at)
                VALUES ({", ".join("?" for _ in TEMPLATE_FIELDS)}, ?, ?, ?, ?)
                """,
                (
                    *(fields.get(field) for field in TEMPLATE_FIELDS),
                    json.dumps(document),
                    json.dumps(variables),
                    now,
                    now,
                ),
            ) as cursor:
                new_id = cursor.lastrowid
        assert new_id is not None
        return new_id

    @staticmethod
    async def save(template_id: int, template: dict[str, Any]) -> None:
        """Write every editable column of an existing template."""
        async with db.tx() as conn:
            await conn.execute(
                f"""
                UPDATE fleet_config_templates
                   SET {", ".join(f"{field} = ?" for field in TEMPLATE_FIELDS)},
                       document = ?, variables = ?, updated_at = ?
                 WHERE id = ?
                """,
                (
                    *(template.get(field) for field in TEMPLATE_FIELDS),
                    json.dumps(template["document"]),
                    json.dumps(template["variables"]),
                    int(time.time()),
                    template_id,
                ),
            )

    @staticmethod
    async def delete(template_id: int) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM fleet_config_templates WHERE id = ?", (template_id,)
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0
