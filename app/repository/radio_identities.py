"""Radio identity registry (plan 18 Phase 1).

One ``radio_identities`` row per radio that has fed this install, keyed by its
full public key (read from ``mc.self_info`` at connect). The self-radio stat
series (``battery_history``, ``noise_floor_samples``, ``airtime_history``)
carry the id of the radio that measured each sample; rows recorded before the
registry existed have ``radio_identity_id`` NULL ("unassigned").

A replacement is stored on the OLD row (``replaced_by`` + ``carry_*`` flags)
and applied at read time by walking the chain (``lineage_ids``). No stat or
contact row is re-keyed, so a link can be edited or removed later.

Every state change is one ``db.tx()``: a failure rolls the whole step back.
SQLite foreign keys are off app-wide, so link integrity (no self link, no
second replacement of the same radio, no radio replacing two, no cycle) is
checked here, inside the same transaction.
"""

from dataclasses import dataclass, field
from typing import Literal

import aiosqlite

from app.database import db
from app.models import RadioIdentity

SCOPED_STAT_TABLES = ("battery_history", "noise_floor_samples", "airtime_history")

LineageKind = Literal["stats", "owned"]

_COLUMNS = (
    "id, public_key, name, notes, first_connected, last_connected, status, "
    "pending_reason, replaced_by, carry_stats, carry_owned, is_active"
)


class RadioIdentityNotFound(LookupError):
    """No radio identity with that id."""


class RadioIdentityConflict(ValueError):
    """The requested change does not fit the identity's current state."""


@dataclass(frozen=True)
class StatScope:
    """Which radio's samples a stat range read returns.

    ``unassigned`` selects the rows recorded before radio tracking; otherwise
    ``ids`` limits the read to those radios. The default (neither) returns
    every row, as before the registry existed.
    """

    ids: list[int] = field(default_factory=list)
    unassigned: bool = False

    def where(self) -> tuple[str, tuple[int, ...]]:
        """SQL condition (with a leading ``AND``) and its parameters."""
        if self.unassigned:
            return " AND radio_identity_id IS NULL", ()
        if self.ids:
            marks = ", ".join("?" for _ in self.ids)
            return f" AND radio_identity_id IN ({marks})", tuple(self.ids)
        return "", ()


def _row_to_identity(row: aiosqlite.Row) -> RadioIdentity:
    return RadioIdentity(
        id=row["id"],
        public_key=row["public_key"],
        name=row["name"],
        notes=row["notes"],
        first_connected=row["first_connected"],
        last_connected=row["last_connected"],
        status=row["status"],
        pending_reason=row["pending_reason"],
        replaced_by=row["replaced_by"],
        carry_stats=bool(row["carry_stats"]),
        carry_owned=bool(row["carry_owned"]),
        is_active=bool(row["is_active"]),
    )


async def _fetch(conn: aiosqlite.Connection, identity_id: int) -> RadioIdentity:
    async with conn.execute(
        f"SELECT {_COLUMNS} FROM radio_identities WHERE id = ?", (identity_id,)
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise RadioIdentityNotFound(f"radio identity {identity_id} not found")
    return _row_to_identity(row)


async def _fetch_by_key(conn: aiosqlite.Connection, public_key: str) -> RadioIdentity | None:
    async with conn.execute(
        f"SELECT {_COLUMNS} FROM radio_identities WHERE public_key = ?", (public_key,)
    ) as cursor:
        row = await cursor.fetchone()
    return _row_to_identity(row) if row else None


async def _count(conn: aiosqlite.Connection, sql: str, params: tuple = ()) -> int:
    async with conn.execute(sql, params) as cursor:
        row = await cursor.fetchone()
    return int(row[0]) if row else 0


async def _has_unassigned(conn: aiosqlite.Connection) -> bool:
    for table in SCOPED_STAT_TABLES:
        sql = (
            f"SELECT COUNT(*) FROM (SELECT 1 FROM {table} WHERE radio_identity_id IS NULL LIMIT 1)"
        )
        if await _count(conn, sql):
            return True
    return False


async def _historical_own_keys(conn: aiosqlite.Connection) -> set[str]:
    """Own public keys this install recorded before the registry existed.

    Two sources store the radio's own key per row: outgoing channel messages
    (``messages.sender_key``) and 0-hop traffic signal samples
    (``link_signal`` source ``traffic``, observer = own key). The latter
    stores the literal ``self`` when key export is disabled; that is ignored.
    """
    keys: set[str] = set()
    async with conn.execute(
        "SELECT DISTINCT lower(sender_key) FROM messages "
        "WHERE outgoing = 1 AND type = 'CHAN' AND sender_key IS NOT NULL AND sender_key != ''"
    ) as cursor:
        keys.update(row[0] for row in await cursor.fetchall())
    async with conn.execute(
        "SELECT DISTINCT lower(observer_pubkey) FROM link_signal "
        "WHERE source = 'traffic' AND observer_pubkey != 'self'"
    ) as cursor:
        keys.update(row[0] for row in await cursor.fetchall())
    return keys


async def _adopt_unassigned(conn: aiosqlite.Connection, identity_id: int) -> None:
    """Assign every unassigned stat sample to ``identity_id``."""
    for table in SCOPED_STAT_TABLES:
        async with conn.execute(
            f"UPDATE {table} SET radio_identity_id = ? WHERE radio_identity_id IS NULL",
            (identity_id,),
        ):
            pass


async def _copy_note(conn: aiosqlite.Connection, old: RadioIdentity, new: RadioIdentity) -> None:
    """Copy the old radio's note to the new radio when the new one has none."""
    if not old.notes or new.notes:
        return
    async with conn.execute(
        "UPDATE radio_identities SET notes = ? WHERE id = ?", (old.notes, new.id)
    ):
        pass


async def _release_samples(
    conn: aiosqlite.Connection, identity_id: int, *, delete_stats: bool
) -> None:
    """Delete ``identity_id``'s stat samples, or leave them owned by no radio."""
    for table in SCOPED_STAT_TABLES:
        sql = (
            f"DELETE FROM {table} WHERE radio_identity_id = ?"
            if delete_stats
            else f"UPDATE {table} SET radio_identity_id = NULL WHERE radio_identity_id = ?"
        )
        async with conn.execute(sql, (identity_id,)):
            pass


async def _set_confirmed(conn: aiosqlite.Connection, identity_id: int) -> None:
    async with conn.execute(
        "UPDATE radio_identities SET status = 'confirmed', pending_reason = NULL WHERE id = ?",
        (identity_id,),
    ):
        pass


async def _predecessor(conn: aiosqlite.Connection, identity_id: int) -> RadioIdentity | None:
    async with conn.execute(
        f"SELECT {_COLUMNS} FROM radio_identities WHERE replaced_by = ?", (identity_id,)
    ) as cursor:
        row = await cursor.fetchone()
    return _row_to_identity(row) if row else None


async def _successor_chain(conn: aiosqlite.Connection, identity: RadioIdentity) -> set[int]:
    """Ids reachable by following ``replaced_by`` forward from ``identity``."""
    seen: set[int] = set()
    current = identity
    while current.replaced_by is not None and current.replaced_by not in seen:
        seen.add(current.replaced_by)
        current = await _fetch(conn, current.replaced_by)
    return seen


def _require_pending(identity: RadioIdentity, reason: str) -> None:
    if identity.status != "pending" or identity.pending_reason != reason:
        raise RadioIdentityConflict(
            f"radio identity {identity.id} is not waiting for a {reason} answer"
        )


class RadioIdentityRepository:
    @staticmethod
    async def register_connect(public_key: str, name: str | None, now: int) -> RadioIdentity:
        """Record a connect of the radio with ``public_key`` and mark it active.

        A known radio only gets ``last_connected``/``name`` updated (a pending
        radio stays pending). An unknown radio is added:

        - first radio ever, no unassigned samples: confirmed.
        - first radio ever with unassigned samples: if every own key found in
          the history is this radio's, the samples are assigned to it and it
          is confirmed; with no evidence or another key it is pending
          ``legacy_history``.
        - any later unknown radio: pending ``new_key``.
        """
        key = (public_key or "").strip().lower()
        if not key:
            raise ValueError("public_key must not be blank")
        clean_name = (name or "").strip() or None

        async with db.tx() as conn:
            existing = await _fetch_by_key(conn, key)
            if existing is not None:
                async with conn.execute(
                    "UPDATE radio_identities SET last_connected = ?, "
                    "name = COALESCE(?, name) WHERE id = ?",
                    (now, clean_name, existing.id),
                ):
                    pass
                identity_id = existing.id
            else:
                status = "confirmed"
                reason: str | None = None
                adopt = False
                if await _count(conn, "SELECT COUNT(*) FROM radio_identities"):
                    status, reason = "pending", "new_key"
                elif await _has_unassigned(conn):
                    evidence = await _historical_own_keys(conn)
                    if evidence and evidence == {key}:
                        adopt = True
                    else:
                        status, reason = "pending", "legacy_history"
                async with conn.execute(
                    "INSERT INTO radio_identities (public_key, name, first_connected, "
                    "last_connected, status, pending_reason) VALUES (?, ?, ?, ?, ?, ?)",
                    (key, clean_name, now, now, status, reason),
                ) as cursor:
                    identity_id = int(cursor.lastrowid or 0)
                if adopt:
                    await _adopt_unassigned(conn, identity_id)

            async with conn.execute(
                "UPDATE radio_identities SET is_active = (id = ?)", (identity_id,)
            ):
                pass
            return await _fetch(conn, identity_id)

    @staticmethod
    async def get(identity_id: int) -> RadioIdentity | None:
        async with db.readonly() as conn:
            try:
                return await _fetch(conn, identity_id)
            except RadioIdentityNotFound:
                return None

    @staticmethod
    async def get_active() -> RadioIdentity | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM radio_identities WHERE is_active = 1 LIMIT 1"
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_identity(row) if row else None

    @staticmethod
    async def list_all() -> list[RadioIdentity]:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM radio_identities ORDER BY last_connected DESC, id DESC"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_identity(row) for row in rows]

    @staticmethod
    async def has_unassigned_history() -> bool:
        async with db.readonly() as conn:
            return await _has_unassigned(conn)

    @staticmethod
    async def confirm_new(identity_id: int) -> RadioIdentity:
        """Answer "new radio" for a pending ``new_key`` identity."""
        async with db.tx() as conn:
            identity = await _fetch(conn, identity_id)
            _require_pending(identity, "new_key")
            await _set_confirmed(conn, identity_id)
            return await _fetch(conn, identity_id)

    @staticmethod
    async def resolve_legacy(identity_id: int, *, adopt: bool) -> RadioIdentity:
        """Answer "does the existing history belong to this radio?"."""
        async with db.tx() as conn:
            identity = await _fetch(conn, identity_id)
            _require_pending(identity, "legacy_history")
            if adopt:
                await _adopt_unassigned(conn, identity_id)
            await _set_confirmed(conn, identity_id)
            return await _fetch(conn, identity_id)

    @staticmethod
    async def link_replacement(
        new_id: int,
        old_id: int,
        *,
        carry_stats: bool,
        carry_owned: bool,
        carry_note: bool,
    ) -> RadioIdentity:
        """Record that ``new_id`` replaces ``old_id`` and confirm ``new_id``.

        Allowed for a pending or confirmed new radio. Returns the new radio.
        """
        if new_id == old_id:
            raise RadioIdentityConflict("a radio cannot replace itself")
        async with db.tx() as conn:
            new = await _fetch(conn, new_id)
            old = await _fetch(conn, old_id)
            if old.replaced_by is not None:
                raise RadioIdentityConflict(f"radio identity {old_id} is already replaced")
            if await _predecessor(conn, new_id) is not None:
                raise RadioIdentityConflict(f"radio identity {new_id} already replaces a radio")
            if old_id in await _successor_chain(conn, new):
                raise RadioIdentityConflict("that link would create a loop")
            async with conn.execute(
                "UPDATE radio_identities SET replaced_by = ?, carry_stats = ?, "
                "carry_owned = ? WHERE id = ?",
                (new_id, int(carry_stats), int(carry_owned), old_id),
            ):
                pass
            if carry_note:
                await _copy_note(conn, old, new)
            await _set_confirmed(conn, new_id)
            return await _fetch(conn, new_id)

    @staticmethod
    async def update_link(old_id: int, *, carry_stats: bool, carry_owned: bool) -> RadioIdentity:
        """Change what the replacing radio inherits from ``old_id``."""
        async with db.tx() as conn:
            old = await _fetch(conn, old_id)
            if old.replaced_by is None:
                raise RadioIdentityConflict(f"radio identity {old_id} is not replaced")
            async with conn.execute(
                "UPDATE radio_identities SET carry_stats = ?, carry_owned = ? WHERE id = ?",
                (int(carry_stats), int(carry_owned), old_id),
            ):
                pass
            return await _fetch(conn, old_id)

    @staticmethod
    async def remove_link(old_id: int) -> RadioIdentity:
        """Undo a replacement: ``old_id`` stands alone again."""
        async with db.tx() as conn:
            old = await _fetch(conn, old_id)
            if old.replaced_by is None:
                raise RadioIdentityConflict(f"radio identity {old_id} is not replaced")
            async with conn.execute(
                "UPDATE radio_identities SET replaced_by = NULL, carry_stats = 0, "
                "carry_owned = 0 WHERE id = ?",
                (old_id,),
            ):
                pass
            return await _fetch(conn, old_id)

    @staticmethod
    async def delete(identity_id: int, *, delete_stats: bool) -> None:
        """Remove a radio from the registry. The active radio cannot be removed.

        ``delete_stats`` deletes its stat samples; otherwise they stay and
        become unassigned. A replacement link that pointed at this radio is
        cleared, so the older radio stands alone again.
        """
        async with db.tx() as conn:
            identity = await _fetch(conn, identity_id)
            if identity.is_active:
                raise RadioIdentityConflict(
                    f"radio identity {identity_id} is the current radio and cannot be removed"
                )
            async with conn.execute(
                "UPDATE radio_identities SET replaced_by = NULL, carry_stats = 0, "
                "carry_owned = 0 WHERE replaced_by = ?",
                (identity_id,),
            ):
                pass
            await _release_samples(conn, identity_id, delete_stats=delete_stats)
            async with conn.execute("DELETE FROM radio_identities WHERE id = ?", (identity_id,)):
                pass

    @staticmethod
    async def set_notes(identity_id: int, notes: str | None) -> RadioIdentity:
        clean = (notes or "").strip() or None
        async with db.tx() as conn:
            await _fetch(conn, identity_id)
            async with conn.execute(
                "UPDATE radio_identities SET notes = ? WHERE id = ?", (clean, identity_id)
            ):
                pass
            return await _fetch(conn, identity_id)

    @staticmethod
    async def lineage(identity_id: int, kind: LineageKind) -> list[RadioIdentity]:
        """``identity_id`` followed by the radios it inherits ``kind`` from, newest first.

        Walks back through predecessors while the link carries ``kind``.
        """
        flag = "carry_stats" if kind == "stats" else "carry_owned"
        async with db.readonly() as conn:
            chain = [await _fetch(conn, identity_id)]
            seen = {identity_id}
            while True:
                pred = await _predecessor(conn, chain[-1].id)
                if pred is None or pred.id in seen or not getattr(pred, flag):
                    break
                chain.append(pred)
                seen.add(pred.id)
        return chain

    @staticmethod
    async def lineage_ids(identity_id: int, kind: LineageKind) -> list[int]:
        return [i.id for i in await RadioIdentityRepository.lineage(identity_id, kind)]

    @staticmethod
    async def lineage_keys(identity_id: int, kind: LineageKind) -> list[str]:
        return [i.public_key for i in await RadioIdentityRepository.lineage(identity_id, kind)]
