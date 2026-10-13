"""Bot lists: the effective set, the shipped list, import and export.

A bot list names known bots (exact sender name, optional public key). Lists
that are enabled mark their senders in chat. With ``app_settings.hide_bots`` on
those senders are also left out of unread counts, mentions, Web Push and the
other places that skip blocked contacts. Nothing here transmits.

A list with Block forwards on also hands its reviewed names to Spam Guard
(``SpamGuardRuntime.set_bot_senders``), which renders them as drop rules for
the forwarding backend. A name a refresh added waits for the user's review.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.bot_lists.format import (
    FORMAT,
    MAX_ENTRIES,
    VERSION,
    BotEntry,
    BotListFile,
    BotListFormatError,
    parse_bot_list,
)
from app.models import AppSettings
from app.repository.bot_lists import BotListRepository
from app.services.bot_list_fetch import BotListFetchError, check_subscription_url, fetch_bot_list
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

# Names in all enabled lists together. Keeps the SQL filters that receive the
# set well under SQLite's variable limit.
MAX_EFFECTIVE = 5000
# Subscriptions: each one is an outbound request per day to a host the user chose.
MAX_SUBSCRIPTIONS = 20
REFRESH_SECONDS = 24 * 3600
SHIPPED_PATH = Path(__file__).resolve().parent.parent / "data" / "bot_list.json"
_SHIPPED_FALLBACK_NAME = "RTFM-EV bot list"


class BotListError(Exception):
    """A change the service refuses. The message is shown to the user."""


class BotListNotFound(BotListError):
    pass


class BotListReadOnly(BotListError):
    pass


class BotListLimit(BotListError):
    pass


class BotListService:
    def __init__(self) -> None:
        self._names: frozenset[str] = frozenset()
        self._keys: frozenset[str] = frozenset()
        self._forward: tuple[str, ...] = ()
        self._loaded = False
        self._refresh_lock = asyncio.Lock()

    def reset(self) -> None:
        """Forget the cached effective set (tests, or a replaced database)."""
        self._names = frozenset()
        self._keys = frozenset()
        self._forward = ()
        self._loaded = False
        self._refresh_lock = asyncio.Lock()

    async def refresh(self) -> None:
        """Recompute the effective set: enabled lists minus the exceptions.

        One at a time. Two refreshes that overlap could otherwise finish in the
        wrong order, and the one that read older rows would decide what chat
        marks and what Spam Guard keeps off the air.
        """
        async with self._refresh_lock:
            exceptions = set(await BotListRepository.exceptions())
            names: set[str] = set()
            keys: set[str] = set()
            for name, key in await BotListRepository.enabled_entries():
                if name in exceptions:
                    continue
                names.add(name)
                if key:
                    keys.add(key)
            self._names = frozenset(names)
            self._keys = frozenset(keys)
            self._forward = tuple(
                name for name in await BotListRepository.forward_names() if name not in exceptions
            )
            self._loaded = True
            self._hand_over()

    async def ensure_loaded(self) -> None:
        if not self._loaded:
            await self.refresh()

    def _hand_over(self) -> None:
        """Give Spam Guard the names to keep off the air (it renders the rules)."""
        # Imported here: Spam Guard pulls in the host repeater and its backends.
        from app.services.spam_guard import spam_guard

        spam_guard.set_bot_senders(self._forward)

    def forward_names(self) -> list[str]:
        """Names this repeater is asked not to relay, as of the last refresh."""
        return list(self._forward)

    async def hidden_senders(
        self, settings: AppSettings
    ) -> tuple[list[str] | None, list[str] | None]:
        """The (keys, names) whose incoming messages are hidden.

        Always the user's blocked contacts; with Hide bots on, also the
        effective set. Each part is None when empty, the form the message
        repository takes for ``blocked_keys`` / ``blocked_names``.
        """
        keys = set(settings.blocked_keys)
        names = set(settings.blocked_names)
        if settings.hide_bots is True:
            await self.ensure_loaded()
            keys |= self._keys
            names |= self._names
        return sorted(keys) or None, sorted(names) or None

    async def snapshot(self) -> dict[str, Any]:
        """Everything the UI shows; also the body of the ``bot_lists`` WS event."""
        from app.services.spam_guard import spam_guard

        await self.ensure_loaded()
        return {
            "lists": await BotListRepository.list_all(),
            "exceptions": await BotListRepository.exceptions(),
            "effective": {"names": sorted(self._names), "keys": sorted(self._keys)},
            "limits": {"entries_per_list": MAX_ENTRIES, "effective": MAX_EFFECTIVE},
            # What Block forwards is doing right now (Spam Guard decides).
            "forward": spam_guard.bot_forward(),
        }

    async def _changed(self) -> dict[str, Any]:
        await self.refresh()
        state = await self.snapshot()
        broadcast_event("bot_lists", state)
        return state

    async def _require(self, list_id: int) -> dict[str, Any]:
        row = await BotListRepository.get(list_id)
        if row is None:
            raise BotListNotFound("That bot list does not exist")
        return row

    async def _require_local(self, list_id: int) -> dict[str, Any]:
        row = await self._require(list_id)
        if row["source"] != "local":
            raise BotListReadOnly("This bot list cannot be edited here")
        return row

    async def _check_cap(self, adding: Iterable[str]) -> None:
        await self.ensure_loaded()
        if len(self._names | set(adding)) > MAX_EFFECTIVE:
            raise BotListLimit(f"Enabled bot lists can hold {MAX_EFFECTIVE} names in total")

    async def create_local(self, name: str, description: str = "") -> dict[str, Any]:
        """Make a local list. The answer also names it (``created_id``): lists
        are sorted by name, so the caller cannot tell which one is new."""
        list_id = await BotListRepository.create(name, description, "local")
        state = await self._changed()
        return {**state, "created_id": list_id}

    async def update(
        self,
        list_id: int,
        *,
        name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        block_forward: bool | None = None,
    ) -> dict[str, Any]:
        row = await self._require(list_id)
        fields: dict[str, Any] = {}
        if name is not None or description is not None:
            if row["source"] != "local":
                raise BotListReadOnly("This bot list cannot be renamed here")
            if name is not None:
                fields["name"] = name
            if description is not None:
                fields["description"] = description
        if enabled is not None and enabled != row["enabled"]:
            if enabled:
                await self._check_cap(e["name"] for e in await BotListRepository.entries(list_id))
            fields["enabled"] = 1 if enabled else 0
        if block_forward is not None and block_forward != row["block_forward"]:
            fields["block_forward"] = 1 if block_forward else 0
        await BotListRepository.update(list_id, fields)
        return await self._changed()

    async def delete(self, list_id: int) -> dict[str, Any]:
        row = await self._require(list_id)
        if row["source"] == "shipped":
            raise BotListReadOnly("The shipped bot list cannot be deleted")
        await BotListRepository.delete(list_id)
        return await self._changed()

    async def entries(self, list_id: int) -> list[dict[str, Any]]:
        await self._require(list_id)
        return await BotListRepository.entries(list_id)

    async def replace_entries(self, list_id: int, entries: list[BotEntry]) -> dict[str, Any]:
        row = await self._require_local(list_id)
        if len(entries) > MAX_ENTRIES:
            raise BotListLimit(f"A bot list holds at most {MAX_ENTRIES} entries")
        names = [entry.name for entry in entries]
        if len(set(names)) != len(names):
            raise BotListError("A name may appear once in a list")
        if row["enabled"]:
            await self._check_cap(names)
        await BotListRepository.replace_entries(list_id, [e.model_dump() for e in entries])
        return await self._changed()

    async def add_entry(self, list_id: int, entry: BotEntry) -> dict[str, Any]:
        row = await self._require_local(list_id)
        if row["entry_count"] >= MAX_ENTRIES:
            raise BotListLimit(f"A bot list holds at most {MAX_ENTRIES} entries")
        if row["enabled"]:
            await self._check_cap([entry.name])
        await BotListRepository.add_entry(list_id, entry.name, entry.public_key, entry.note)
        return await self._changed()

    async def review(self, list_id: int, names: list[str]) -> dict[str, Any]:
        """Confirm names a refresh added, so Block forwards covers them too."""
        await self._require(list_id)
        await BotListRepository.set_reviewed(list_id, names)
        return await self._changed()

    async def import_file(self, parsed: BotListFile) -> dict[str, Any]:
        """Store a validated file as a new local list. It starts switched off."""
        list_id = await BotListRepository.create(parsed.name, parsed.description, "local")
        await BotListRepository.replace_entries(list_id, [e.model_dump() for e in parsed.entries])
        await BotListRepository.update(list_id, {"file_updated": parsed.updated})
        return await self._changed()

    async def preview_url(self, url: str) -> dict[str, Any]:
        """Fetch and validate a list without storing it, for the subscribe dialog."""
        cleaned = check_subscription_url(url)
        parsed = await fetch_bot_list(cleaned)
        return {
            "url": cleaned,
            "name": parsed.name,
            "description": parsed.description,
            "updated": parsed.updated,
            "entries": [entry.model_dump() for entry in parsed.entries],
        }

    async def subscribe(self, url: str) -> dict[str, Any]:
        """Store the list at ``url`` as a read-only subscription, switched off."""
        cleaned = check_subscription_url(url)
        if await BotListRepository.find_by_url(cleaned) is not None:
            raise BotListError("That URL is already subscribed")
        if await BotListRepository.count_by_source("url") >= MAX_SUBSCRIPTIONS:
            raise BotListLimit(f"At most {MAX_SUBSCRIPTIONS} subscriptions")
        parsed = await fetch_bot_list(cleaned)
        list_id = await BotListRepository.create(parsed.name, parsed.description, "url", cleaned)
        await BotListRepository.replace_entries(list_id, [e.model_dump() for e in parsed.entries])
        await BotListRepository.update(
            list_id, {"file_updated": parsed.updated, "fetched_at": int(time.time())}
        )
        state = await self._changed()
        return {**state, "created_id": list_id}

    async def _refresh_row(self, row: dict[str, Any]) -> None:
        """Fetch one subscription and apply it; a failure only sets ``last_error``."""
        try:
            parsed = await fetch_bot_list(row["url"])
            if row["enabled"]:
                await self._check_cap(entry.name for entry in parsed.entries)
        except BotListFetchError as exc:
            logger.warning("Bot list %s refresh failed (%s): %s", row["id"], exc.code, exc.detail)
            await BotListRepository.update(row["id"], {"last_error": exc.public_text()})
            return
        except BotListLimit:
            await BotListRepository.update(row["id"], {"last_error": "over_limit"})
            return
        except Exception:
            # The other end controls the input. Whatever it provokes must not
            # stop the pass: the lists after this one still get their refresh.
            logger.exception("Bot list %s refresh failed unexpectedly", row["id"])
            await BotListRepository.update(row["id"], {"last_error": "fetch_failed"})
            return
        await BotListRepository.apply_refresh(row["id"], [e.model_dump() for e in parsed.entries])
        await BotListRepository.update(
            row["id"],
            {
                "name": parsed.name,
                "description": parsed.description,
                "file_updated": parsed.updated,
                "fetched_at": int(time.time()),
                "last_error": None,
            },
        )

    async def refresh_list(self, list_id: int) -> dict[str, Any]:
        """Refresh one subscription now. The outcome shows on the list itself."""
        row = await self._require(list_id)
        if row["source"] != "url":
            raise BotListReadOnly("Only a subscribed list can be refreshed")
        await self._refresh_row(row)
        return await self._changed()

    async def refresh_due(self, now: int | None = None) -> int:
        """Refresh every subscription whose last good fetch is a day old or older."""
        moment = int(time.time()) if now is None else now
        due = await BotListRepository.due_url_lists(moment - REFRESH_SECONDS)
        for row in due:
            await self._refresh_row(row)
        if due:
            await self._changed()
        return len(due)

    async def export(self, list_id: int) -> dict[str, Any]:
        row = await self._require(list_id)
        entries = await BotListRepository.entries(list_id)
        return {
            "format": FORMAT,
            "version": VERSION,
            "name": row["name"],
            "description": row["description"],
            "updated": time.strftime("%Y-%m-%d", time.gmtime()),
            "entries": [
                {k: entry[k] for k in ("name", "public_key", "note") if entry[k] is not None}
                for entry in entries
            ],
        }

    async def set_exceptions(self, names: list[str]) -> dict[str, Any]:
        await BotListRepository.set_exceptions(sorted({n for n in names if n.strip()}))
        return await self._changed()

    async def load_shipped(self, path: Path = SHIPPED_PATH) -> None:
        """Load the list shipped in the repo into its one read-only row.

        Entries are replaced from the file; the user's switches are kept. A
        missing or invalid file keeps the stored entries and records the error.
        """
        parsed: BotListFile | None = None
        error: str | None = None
        try:
            parsed = parse_bot_list(path.read_bytes())
        except (OSError, BotListFormatError) as exc:
            error = str(exc) or type(exc).__name__
            logger.warning("Shipped bot list could not be loaded: %s", error)

        try:
            row = await BotListRepository.get_shipped()
            if row is None:
                list_id = await BotListRepository.create(
                    parsed.name if parsed else _SHIPPED_FALLBACK_NAME,
                    parsed.description if parsed else "",
                    "shipped",
                )
            else:
                list_id = row["id"]

            if parsed is None:
                await BotListRepository.update(list_id, {"last_error": error})
            else:
                await BotListRepository.update(
                    list_id,
                    {
                        "name": parsed.name,
                        "description": parsed.description,
                        "file_updated": parsed.updated,
                        "last_error": None,
                    },
                )
                await BotListRepository.replace_entries(
                    list_id, [e.model_dump() for e in parsed.entries]
                )
        finally:
            # Whatever went wrong with the shipped row, the other lists still count:
            # chat marking and forward blocking must not wait for the next request.
            await self.refresh()


bot_lists = BotListService()
