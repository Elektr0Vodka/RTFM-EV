"""Whose stored wardrive data a user may read, set per user by the owner."""

from typing import Any

from app.repository.wardrive import WardriveGroupRepository


async def visible_user_ids(user: dict[str, Any]) -> set[int] | None:
    """``None`` means everyone. ``own`` is the user alone; ``groups`` adds
    every user sharing a group with them. Read fresh on every call, so an
    owner's change applies on the next read."""
    visibility = user["visibility"]
    if visibility == "all":
        return None
    ids = {user["id"]}
    if visibility == "groups":
        for group in await WardriveGroupRepository.list_all():
            if user["id"] in group["member_ids"]:
                ids.update(group["member_ids"])
    return ids
