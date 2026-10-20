"""Overall state of the backend for the Performance page header.

``ok``, ``degraded`` or ``critical``, with one reason per finding. Reason
keys are stable: the frontend translates them (``perf_reason_<key>``) and
fills in ``detail``.
"""

import time

STALL_WINDOW_S = 300
STALL_DEGRADED_MS = 500
LAG_P95_DEGRADED_MS = 100
MEMORY_CRITICAL_SHARE = 0.9

_RANK = {"ok": 0, "degraded": 1, "critical": 2}


def evaluate(snapshot: dict, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    reasons: list[dict] = []

    def add(key: str, detail: str, severity: str = "degraded") -> None:
        reasons.append({"key": key, "detail": detail, "severity": severity})

    for task in snapshot.get("tasks", []):
        if task["state"] == "overdue":
            add("loop_overdue", task["name"])
        elif task["state"] == "error":
            add("loop_failing", task["name"])

    stalls = snapshot.get("loop", {}).get("stalls", [])
    recent = [
        s
        for s in stalls
        if s["at"] >= now - STALL_WINDOW_S and (s["duration_ms"] or 0) >= STALL_DEGRADED_MS
    ]
    if recent:
        worst = max(recent, key=lambda s: s["duration_ms"] or 0)
        add("stall", f"{worst['duration_ms']:.0f} ms")

    latest = snapshot.get("latest") or {}
    lag_p95 = latest.get("lag_p95")
    if lag_p95 is not None and lag_p95 >= LAG_P95_DEGRADED_MS:
        add("lag_high", f"{lag_p95:.0f} ms")

    for output in snapshot.get("outputs", {}).get("modules", []):
        if output.get("status") == "error":
            add("output_error", output.get("name") or output.get("id", ""))

    radio = snapshot.get("radio", {})
    if radio.get("desired") and not radio.get("connected"):
        add("radio_disconnected", radio.get("connection_info") or "")

    process = snapshot.get("process", {})
    rss, limit = process.get("rss_mb"), process.get("mem_limit_mb")
    if rss is not None and limit and rss >= limit * MEMORY_CRITICAL_SHARE:
        add("memory_high", f"{rss:.0f} / {limit:.0f} MB", "critical")

    state = "ok"
    for reason in reasons:
        if _RANK[reason["severity"]] > _RANK[state]:
            state = reason["severity"]
    return {"state": state, "reasons": reasons}
