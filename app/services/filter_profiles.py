"""The filter library: named profiles of filter settings, one library per kind.

A profile is a saved set of values that the user applies by hand and can share
as a file. What the values are, and how they reach the running feature, is the
kind's business (``app/filter_profiles/kinds.py``). This module stores, lists,
imports, exports and applies profiles and remembers the one in use per kind.
Nothing here transmits.
"""

from __future__ import annotations

from typing import Any

from app.filter_profiles.format import (
    ProfileFile,
    clean_name,
    export_document,
    export_filename,
)
from app.filter_profiles.kinds import ProfileError, ProfileKind
from app.repository.filter_profiles import FilterProfileRepository
from app.services.filter_profile_spam import SpamGuardProfiles

MAX_PROFILES_PER_KIND = 100


class FilterProfileService:
    def __init__(self) -> None:
        self._kinds: dict[str, ProfileKind] = {}

    def register(self, kind: ProfileKind) -> None:
        self._kinds[kind.kind] = kind

    def _kind(self, name: str) -> ProfileKind:
        kind = self._kinds.get(name)
        if kind is None:
            raise ProfileError("unknown_kind")
        return kind

    async def _require(self, profile_id: int) -> dict[str, Any]:
        row = await FilterProfileRepository.get(profile_id)
        # A row of a kind this build does not have cannot be shown or applied.
        if row is None or row["kind"] not in self._kinds:
            raise ProfileError("not_found", status=404)
        return row

    @staticmethod
    async def _check_room(kind: str) -> None:
        if await FilterProfileRepository.count(kind) >= MAX_PROFILES_PER_KIND:
            raise ProfileError("too_many_profiles")

    async def snapshot(self, kind: str) -> dict[str, Any]:
        """The profiles of a kind and which one is in use."""
        adapter = self._kind(kind)
        profiles = await FilterProfileRepository.list_kind(kind)
        used_id = await FilterProfileRepository.in_use(kind)
        used = next((profile for profile in profiles if profile["id"] == used_id), None)
        in_use: dict[str, Any] | None = None
        if used is not None:
            try:
                modified = not await adapter.matches(used["payload"])
            except ValueError:
                # A stored payload this release no longer accepts cannot match.
                modified = True
            in_use = {"profile_id": used["id"], "modified": modified}
        return {
            "kind": kind,
            "profiles": profiles,
            "in_use": in_use,
            "limits": {"per_kind": MAX_PROFILES_PER_KIND},
        }

    async def create(self, kind: str, name: str, description: str = "") -> dict[str, Any]:
        """Save the live values as a new profile. It is the one in use."""
        adapter = self._kind(kind)
        await self._check_room(kind)
        payload = adapter.validate(await adapter.capture())
        new_id = await FilterProfileRepository.create(
            kind, clean_name(name), description.strip(), "local", payload
        )
        await FilterProfileRepository.set_in_use(kind, new_id)
        return {**await self.snapshot(kind), "created_id": new_id}

    async def update(
        self,
        profile_id: int,
        *,
        name: str | None = None,
        description: str | None = None,
        capture: bool = False,
    ) -> dict[str, Any]:
        """Rename, describe, or (``capture``) overwrite with the live values."""
        row = await self._require(profile_id)
        payload: dict[str, Any] | None = None
        if capture:
            adapter = self._kind(row["kind"])
            payload = adapter.validate(await adapter.capture())
        await FilterProfileRepository.update(
            profile_id,
            name=None if name is None else clean_name(name),
            description=None if description is None else description.strip(),
            payload=payload,
        )
        if capture:
            await FilterProfileRepository.set_in_use(row["kind"], profile_id)
        return await self.snapshot(row["kind"])

    async def delete(self, profile_id: int) -> dict[str, Any]:
        row = await self._require(profile_id)
        await FilterProfileRepository.delete(profile_id)
        return await self.snapshot(row["kind"])

    async def import_file(self, parsed: ProfileFile) -> dict[str, Any]:
        """Store a profile from a file as an own copy. Importing never applies."""
        adapter = self._kind(parsed.kind)
        try:
            payload = adapter.validate(parsed.payload)
        except ValueError as exc:
            raise ProfileError("invalid_file", f"payload: {exc}") from exc
        await self._check_room(parsed.kind)
        new_id = await FilterProfileRepository.create(
            parsed.kind, parsed.name, parsed.description.strip(), "local", payload
        )
        return {**await self.snapshot(parsed.kind), "created_id": new_id}

    async def export(self, profile_id: int) -> tuple[str, dict[str, Any]]:
        """Download name and file document of a profile."""
        row = await self._require(profile_id)
        return export_filename(row["kind"], row["name"]), export_document(row)

    async def changes(self, profile_id: int) -> dict[str, Any]:
        """What applying the profile would change, for the user to read first."""
        row = await self._require(profile_id)
        adapter = self._kind(row["kind"])
        try:
            found = await adapter.changes(row["payload"])
        except ValueError as exc:
            raise ProfileError("invalid_profile", str(exc), status=422) from exc
        return {"profile_id": profile_id, "changes": found}

    async def apply(self, profile_id: int, *, confirmed: bool) -> dict[str, Any]:
        row = await self._require(profile_id)
        adapter = self._kind(row["kind"])
        try:
            await adapter.apply(row["payload"], confirmed=confirmed)
        except ValueError as exc:
            raise ProfileError("invalid_profile", str(exc), status=422) from exc
        await FilterProfileRepository.set_in_use(row["kind"], profile_id)
        return await self.snapshot(row["kind"])


filter_profiles = FilterProfileService()
filter_profiles.register(SpamGuardProfiles())
