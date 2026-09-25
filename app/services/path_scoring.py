"""Scored path history for direct messages (plan 28 item 1.15, display only).

Port of meshcore-open ``lib/services/path_history_service.dart``
(``_scorePathRecord`` / ``_getRankedPaths``): every route a DM to a contact was
sent on gets a score in [0, 1] from four terms

- reliability ``(successes + 1) / (attempts + 2)`` (Laplace estimate),
- latency ``fastest_trip / this_trip`` (0.6 when no trip time is known),
- freshness ``1 / (1 + days since the last success)``,
- route weight normalised by the best weight among the contact's paths,

weighted 0.45 / 0.25 / 0.1 / 0.2. RTFM-EV only displays the ranking; DM routing
stays firmware direct path, then flood (meshcore-open also picks retry paths
from it). Pure functions, no I/O.
"""

from __future__ import annotations

import time

from app.models import ContactPathOutcome, ContactPathScore

UNKNOWN_LATENCY_SCORE = 0.6
W_RELIABILITY, W_LATENCY, W_FRESHNESS, W_WEIGHT = 0.45, 0.25, 0.1, 0.2


def score_terms(
    row: ContactPathOutcome, *, fastest_trip_ms: int | None, highest_weight: float, now: float
) -> tuple[float, float, float, float, float]:
    """``(score, reliability, latency, freshness, weight)`` for one path row."""
    attempts = row.success_count + row.failure_count
    reliability = (row.success_count + 1) / (attempts + 2)
    if fastest_trip_ms is None or row.last_trip_ms is None or row.last_trip_ms <= 0:
        latency = UNKNOWN_LATENCY_SCORE
    else:
        latency = max(0.0, min(1.0, fastest_trip_ms / row.last_trip_ms))
    if row.last_success is None:
        freshness = 0.0
    else:
        minutes = max(0.0, (now - row.last_success) / 60.0)
        freshness = 1.0 / (1.0 + minutes / 60.0 / 24.0)
    weight = max(0.0, min(1.0, row.route_weight / highest_weight))
    score = (
        reliability * W_RELIABILITY
        + latency * W_LATENCY
        + freshness * W_FRESHNESS
        + weight * W_WEIGHT
    )
    return score, reliability, latency, freshness, weight


def score_paths(rows: list[ContactPathOutcome], now: float | None = None) -> list[ContactPathScore]:
    """Rank a contact's path rows the way meshcore-open ranks its path history."""
    if not rows:
        return []
    now = time.time() if now is None else now
    known_trips = [
        r.last_trip_ms for r in rows if r.last_trip_ms is not None and r.last_trip_ms > 0
    ]
    fastest = min(known_trips) if known_trips else None
    highest = max((r.route_weight for r in rows), default=1.0)
    if highest <= 0:
        highest = 1.0

    scored: list[ContactPathScore] = []
    for row in rows:
        score, reliability, latency, freshness, weight = score_terms(
            row, fastest_trip_ms=fastest, highest_weight=highest, now=now
        )
        scored.append(
            ContactPathScore(
                **row.model_dump(),
                score=round(score, 4),
                reliability=round(reliability, 4),
                latency=round(latency, 4),
                freshness=round(freshness, 4),
                weight=round(weight, 4),
            )
        )

    def sort_key(p: ContactPathScore) -> tuple:
        # Ties: higher weight, faster trip (unknown last), most recent success first.
        trip = p.last_trip_ms if p.last_trip_ms else 999_999
        return (-p.score, -p.route_weight, trip, -(p.last_success or 0))

    scored.sort(key=sort_key)
    return scored
