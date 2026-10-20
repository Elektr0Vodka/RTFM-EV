"""Node names and advertised positions served to wardrive drivers.

Public broadcast data only: public key, advertised name, role, advertised
position and when it was last seen. Never the owner's manual positions,
notes, owner info, paths or favourites.
"""

from typing import Any

from app.repository.external_map import ExternalMapRepository
from app.repository.wardrive import WardriveNodeRepository

MAX_NODES = 20000
MAX_SPAN_LAT = 4.0
MAX_SPAN_LON = 6.0

# Contact ``type`` as the radio advertises it, named as the page's decoder names roles.
_CONTACT_ROLES = {1: "Chat Node", 2: "Repeater", 3: "Room Server", 4: "Sensor"}
_EXTERNAL_ROLES = (
    ("repeater", "Repeater"),
    ("room", "Room Server"),
    ("sensor", "Sensor"),
    ("companion", "Chat Node"),
    ("chat", "Chat Node"),
)


def external_role(role: str | None) -> str | None:
    text = (role or "").casefold()
    return next((name for part, name in _EXTERNAL_ROLES if part in text), None)


def _position(lat: float | None, lon: float | None) -> tuple[float | None, float | None]:
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None, None
    return lat, lon


async def _contacts() -> list[dict[str, Any]]:
    nodes = []
    for row in await WardriveNodeRepository.full_key_contacts():
        lat, lon = _position(row["lat"], row["lon"])
        nodes.append(
            {
                "public_key": row["public_key"].lower(),
                "name": row["name"] or None,
                "role": _CONTACT_ROLES.get(row["type"]),
                "lat": lat,
                "lon": lon,
                "seen": row["last_advert"],
            }
        )
    return nodes


def _newer(a: int | None, b: int | None) -> bool:
    """Whether ``a`` is newer than ``b`` (an unknown time is the oldest)."""
    return (a if a is not None else -1) > (b if b is not None else -1)


async def nodes_in_box(
    min_lat: float, max_lat: float, min_lon: float, max_lon: float
) -> dict[str, Any]:
    """Every contact with a full key plus the imported map nodes inside the box,
    merged by key: the name of the newest source, the contact's position when
    it has one. Newest first, at most ``MAX_NODES``."""
    merged: dict[str, dict[str, Any]] = {n["public_key"]: n for n in await _contacts()}
    external = await ExternalMapRepository.query_bbox(
        min_lat, min_lon, max_lat, max_lon, limit=MAX_NODES + 1
    )
    for ext in external:
        key = ext.pubkey.lower()
        lat, lon = _position(ext.lat, ext.lon)
        node = {
            "public_key": key,
            "name": ext.name or None,
            "role": external_role(ext.role),
            "lat": lat,
            "lon": lon,
            "seen": ext.last_seen,
        }
        contact = merged.get(key)
        if contact is None:
            merged[key] = node
            continue
        if _newer(node["seen"], contact["seen"]):
            contact["name"] = node["name"] or contact["name"]
            contact["seen"] = node["seen"]
        contact["role"] = contact["role"] or node["role"]
        if contact["lat"] is None:
            contact["lat"], contact["lon"] = lat, lon
    ordered = sorted(
        merged.values(),
        key=lambda n: (n["seen"] is None, -(n["seen"] or 0)),
    )
    return {"nodes": ordered[:MAX_NODES], "truncated": len(ordered) > MAX_NODES}
