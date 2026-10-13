import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the fleet key vault tables.

    ``fleet_vault``: one row (id 1) once a passphrase was set. It holds the
    Argon2id parameters and salt, and the data key wrapped under the key
    derived from the passphrase. Neither the passphrase nor that derived key
    is stored anywhere.

    ``fleet_secrets``: one encrypted value per row (``kind``: ``private_key``,
    ``admin_password``, ``guest_password``, ``wifi`` or ``other``), tied to a
    fleet asset. No ON DELETE CASCADE on purpose: an asset that still has
    secrets cannot be deleted, so a private key is never lost by accident.

    ``fleet_audit``: what was done with the vault and from which address. It
    never holds a secret value or a passphrase.

    The tables exist on every install; the vault only works when the server
    is started with ``MESHCORE_FLEET_VAULT_ENABLED=true``.

    Idempotent: IF NOT EXISTS on tables and indexes.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_vault (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            kdf_opslimit INTEGER NOT NULL,
            kdf_memlimit INTEGER NOT NULL,
            salt BLOB NOT NULL,
            key_nonce BLOB NOT NULL,
            wrapped_key BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES fleet_assets(id),
            kind TEXT NOT NULL,
            label TEXT,
            nonce BLOB NOT NULL,
            ciphertext BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fleet_secrets_asset ON fleet_secrets (asset_id)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            action TEXT NOT NULL,
            asset_id INTEGER,
            secret_id INTEGER,
            detail TEXT,
            remote_addr TEXT,
            auth_user TEXT
        )
        """
    )
    await conn.commit()
