"""Suggested direct-message routes for a contact, from the paths it was heard on.

A flood packet's path grows as it travels, so a path heard from a contact reads
``contact -> path[0] -> ... -> path[n-1] -> us``. The route for sending to that
contact is the same hops in reverse (``us -> path[n-1] -> ... -> path[0] ->
contact``), which is also what the firmware learns from a PATH return. This
assumes every hop works in both directions; nothing here can check that
(``analyzer_path_check`` can, on request).

Sources are advert paths (``contact_advert_paths``) and the paths incoming direct
messages arrived on (``messages.paths``). Channel messages are left out: their
sender is matched by name, not by key. A 0-hop direct message is left out too,
because a direct-routed packet also arrives with an empty path.

Every candidate gets a score in [0, 1] from four terms

- freshness ``1 / (1 + days since last heard)``,
- heard ``times heard / most times heard among the candidates``,
- hops ``1 / (1 + hop count)``,
- delivery ``(successes + 1) / (attempts + 2)`` from ``contact_path_outcomes``
  when direct messages were already sent on that exact route (0.5 otherwise),

weighted 0.35 / 0.2 / 0.15 / 0.3. Suggest only: nothing here changes how a DM is
routed. Pure functions, no I/O.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

from app.models import ContactPathOutcome, ContactRoute, ContactRouteSuggestion
from app.path_utils import stored_path_hop_width

HeardSource = Literal["advert", "dm"]

MAX_SUGGESTIONS = 5
W_FRESHNESS, W_HEARD, W_HOPS, W_DELIVERY = 0.35, 0.2, 0.15, 0.3


@dataclass(frozen=True)
class HeardPath:
    """One path a contact was heard on, in the order the packet travelled."""

    path_hex: str
    path_len: int
    last_seen: int
    heard_count: int
    source: HeardSource


def reverse_heard_path(path_hex: str, path_len: int) -> tuple[str, int, int] | None:
    """``(route_hex, hop_count, hash_mode)`` for sending along a heard path, or None.

    None when the path does not split into ``path_len`` hops of 1, 2 or 3 bytes.
    """
    if path_len == 0 and not path_hex:
        return "", 0, 0
    width = stored_path_hop_width(path_hex, path_len)
    if width is None:
        return None
    normalized = path_hex.lower()
    try:
        bytes.fromhex(normalized)
    except ValueError:
        return None
    chars = width * 2
    hops = [normalized[i : i + chars] for i in range(0, len(normalized), chars)]
    return "".join(reversed(hops)), path_len, width - 1


def _route_text(route_hex: str, path_len: int, hash_mode: int) -> str:
    if path_len == 0:
        return "0"
    chars = (hash_mode + 1) * 2
    return ",".join(route_hex[i : i + chars] for i in range(0, len(route_hex), chars))


def suggest_routes(
    heard: list[HeardPath],
    outcomes: list[ContactPathOutcome],
    current_route: ContactRoute | None,
    now: float | None = None,
    limit: int = MAX_SUGGESTIONS,
) -> list[ContactRouteSuggestion]:
    """Rank the routes a contact could be reached on, best first."""
    timestamp = time.time() if now is None else now

    merged: dict[tuple[str, int, int], dict] = {}
    for item in heard:
        route = reverse_heard_path(item.path_hex, item.path_len)
        if route is None:
            continue
        entry = merged.setdefault(route, {"heard_count": 0, "last_seen": 0, "sources": set()})
        entry["heard_count"] += item.heard_count
        entry["last_seen"] = max(entry["last_seen"], item.last_seen)
        entry["sources"].add(item.source)
    if not merged:
        return []

    outcome_by_route = {(o.path.lower(), o.path_len): o for o in outcomes if o.path_len >= 0}
    current = (
        (current_route.path.lower(), current_route.path_len)
        if current_route is not None and current_route.path_len >= 0
        else None
    )
    most_heard = max(entry["heard_count"] for entry in merged.values())

    suggestions: list[ContactRouteSuggestion] = []
    for (route_hex, path_len, hash_mode), entry in merged.items():
        outcome = outcome_by_route.get((route_hex, path_len))
        successes = outcome.success_count if outcome else 0
        failures = outcome.failure_count if outcome else 0
        days = max(0.0, (timestamp - entry["last_seen"]) / 86400.0)
        freshness = 1.0 / (1.0 + days)
        heard_term = entry["heard_count"] / most_heard
        hops = 1.0 / (1.0 + path_len)
        delivery = (successes + 1) / (successes + failures + 2)
        suggestions.append(
            ContactRouteSuggestion(
                path=route_hex,
                path_len=path_len,
                path_hash_mode=hash_mode,
                route=_route_text(route_hex, path_len, hash_mode),
                sources=sorted(entry["sources"]),
                heard_count=entry["heard_count"],
                last_seen=entry["last_seen"],
                attempt_count=outcome.attempt_count if outcome else 0,
                success_count=successes,
                failure_count=failures,
                score=W_FRESHNESS * freshness
                + W_HEARD * heard_term
                + W_HOPS * hops
                + W_DELIVERY * delivery,
                freshness=freshness,
                heard=heard_term,
                hops=hops,
                delivery=delivery,
                is_current=current == (route_hex, path_len),
            )
        )

    suggestions.sort(key=lambda s: (-s.score, s.path_len, -s.last_seen, s.path))
    return suggestions[:limit]
