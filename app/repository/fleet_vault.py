import time
from typing import Any

from app.database import db

_SECRET_META = "id, asset_id, kind, label, created_at, updated_at"


def _meta(row) -> dict[str, Any]:
    return {
        key: row[key] for key in ("id", "asset_id", "kind", "label", "created_at", "updated_at")
    }


class FleetVaultRepository:
    """Storage of the vault row, the encrypted secrets and the audit log.

    Everything stored here is ciphertext or metadata. Encrypting and decrypting
    happen in ``app.services.fleet_vault``.
    """

    @staticmethod
    async def get_vault() -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT kdf_opslimit, kdf_memlimit, salt, key_nonce, wrapped_key "
                "FROM fleet_vault WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "kdf_opslimit": row["kdf_opslimit"],
            "kdf_memlimit": row["kdf_memlimit"],
            "salt": bytes(row["salt"]),
            "key_nonce": bytes(row["key_nonce"]),
            "wrapped_key": bytes(row["wrapped_key"]),
        }

    @staticmethod
    async def create_vault(
        opslimit: int, memlimit: int, salt: bytes, key_nonce: bytes, wrapped_key: bytes
    ) -> bool:
        """Store the vault row. False when a vault already exists (row unchanged)."""
        now = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT OR IGNORE INTO fleet_vault
                    (id, kdf_opslimit, kdf_memlimit, salt, key_nonce, wrapped_key,
                     created_at, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                """,
                (opslimit, memlimit, salt, key_nonce, wrapped_key, now, now),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def rewrap_vault(
        opslimit: int, memlimit: int, salt: bytes, key_nonce: bytes, wrapped_key: bytes
    ) -> None:
        """Replace how the data key is wrapped (passphrase change). Secrets are untouched."""
        async with db.tx() as conn:
            await conn.execute(
                """
                UPDATE fleet_vault
                   SET kdf_opslimit = ?, kdf_memlimit = ?, salt = ?, key_nonce = ?,
                       wrapped_key = ?, updated_at = ?
                 WHERE id = 1
                """,
                (opslimit, memlimit, salt, key_nonce, wrapped_key, int(time.time())),
            )

    @staticmethod
    async def list_secrets(asset_id: int) -> list[dict[str, Any]]:
        """Kind, label and dates of an asset's secrets. Never the value."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_SECRET_META} FROM fleet_secrets WHERE asset_id = ? ORDER BY id",
                (asset_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_meta(row) for row in rows]

    @staticmethod
    async def count_secrets(asset_id: int) -> int:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) FROM fleet_secrets WHERE asset_id = ?", (asset_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    async def get_sealed(secret_id: int) -> dict[str, Any] | None:
        """One secret with its nonce and ciphertext, for decrypting."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_SECRET_META}, nonce, ciphertext FROM fleet_secrets WHERE id = ?",
                (secret_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {**_meta(row), "nonce": bytes(row["nonce"]), "ciphertext": bytes(row["ciphertext"])}

    @staticmethod
    async def all_sealed(asset_id: int | None = None) -> list[dict[str, Any]]:
        """Every secret with nonce and ciphertext (export, duplicate check)."""
        query = f"SELECT {_SECRET_META}, nonce, ciphertext FROM fleet_secrets"
        params: tuple[Any, ...] = ()
        if asset_id is not None:
            query += " WHERE asset_id = ?"
            params = (asset_id,)
        async with db.readonly() as conn:
            async with conn.execute(query + " ORDER BY id", params) as cursor:
                rows = await cursor.fetchall()
        return [
            {**_meta(row), "nonce": bytes(row["nonce"]), "ciphertext": bytes(row["ciphertext"])}
            for row in rows
        ]

    @staticmethod
    async def add_secret(
        asset_id: int, kind: str, label: str | None, nonce: bytes, ciphertext: bytes
    ) -> dict[str, Any]:
        now = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO fleet_secrets (asset_id, kind, label, nonce, ciphertext,
                                           created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (asset_id, kind, label, nonce, ciphertext, now, now),
            ) as cursor:
                new_id = cursor.lastrowid
        return {
            "id": new_id,
            "asset_id": asset_id,
            "kind": kind,
            "label": label,
            "created_at": now,
            "updated_at": now,
        }

    @staticmethod
    async def delete_secret(secret_id: int) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM fleet_secrets WHERE id = ?", (secret_id,)
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def audit(
        action: str,
        *,
        asset_id: int | None = None,
        secret_id: int | None = None,
        detail: str | None = None,
        remote_addr: str | None = None,
        auth_user: str | None = None,
    ) -> None:
        """Write one audit row. ``detail`` must never hold a secret or a passphrase."""
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO fleet_audit (ts, action, asset_id, secret_id, detail,
                                         remote_addr, auth_user)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (int(time.time()), action, asset_id, secret_id, detail, remote_addr, auth_user),
            )

    @staticmethod
    async def get_audit(limit: int) -> list[dict[str, Any]]:
        """Newest audit rows first."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT id, ts, action, asset_id, secret_id, detail, remote_addr, auth_user
                  FROM fleet_audit ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    async def known_key_prefixes(hex_chars: int) -> set[str]:
        """First ``hex_chars`` hex characters of every contact and fleet asset key."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT lower(substr(public_key, 1, ?)) FROM contacts
                 WHERE length(public_key) >= ?
                UNION
                SELECT lower(substr(public_key, 1, ?)) FROM fleet_assets
                 WHERE public_key IS NOT NULL
                """,
                (hex_chars, hex_chars, hex_chars),
            ) as cursor:
                rows = await cursor.fetchall()
        return {row[0] for row in rows}
