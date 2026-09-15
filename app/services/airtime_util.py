"""Derive per-bin TX/RX airtime utilization % from cumulative airtime samples.

Input samples are cumulative-from-boot counters (seconds). Utilization for a
pair of consecutive samples is 100 * delta_airtime / delta_wallclock. Pairs
that straddle a counter reset (negative delta) or a long gap (radio was
disconnected) are dropped so they do not create false spikes.
"""

# Drop a pair whose wall-clock gap exceeds this multiple of the sample interval.
GAP_SANITY_MULTIPLE = 5


def compute_airtime_utilization(
    samples: list[dict],
    start_ts: int,
    end_ts: int,
    bin_count: int,
    sample_interval: int,
) -> list[dict]:
    if bin_count < 1 or end_ts <= start_ts or len(samples) < 2:
        return []

    bin_width = (end_ts - start_ts) / bin_count
    max_gap = GAP_SANITY_MULTIPLE * sample_interval
    acc: dict[int, dict] = {}

    for a, b in zip(samples, samples[1:], strict=False):
        dt = b["timestamp"] - a["timestamp"]
        if dt <= 0 or dt > max_gap:
            continue
        d_tx = b["tx_air_secs"] - a["tx_air_secs"]
        d_rx = b["rx_air_secs"] - a["rx_air_secs"]
        if d_tx < 0 or d_rx < 0:
            continue  # counter reset / reboot
        tx_pct = min(100.0, 100.0 * d_tx / dt)
        rx_pct = min(100.0, 100.0 * d_rx / dt)
        # Bin each pair by its start timestamp: the interval (a, b] belongs to
        # the bin that a falls in.
        idx = int((a["timestamp"] - start_ts) / bin_width)
        if idx < 0:
            continue
        if idx >= bin_count:
            idx = bin_count - 1
        slot = acc.setdefault(idx, {"tx": 0.0, "rx": 0.0, "n": 0})
        slot["tx"] += tx_pct
        slot["rx"] += rx_pct
        slot["n"] += 1

    out: list[dict] = []
    for idx in sorted(acc):
        slot = acc[idx]
        n = slot["n"]
        out.append(
            {
                "_bin": idx,
                "timestamp": int(start_ts + (idx + 0.5) * bin_width),
                "tx_pct": round(slot["tx"] / n, 2),
                "rx_pct": round(slot["rx"] / n, 2),
            }
        )
    return out


def map_openhop_airtime_buckets(data: dict) -> list[dict]:
    """Map OpenHop's ``airtime_chart_data`` payload to chart points.

    OpenHop returns pre-bucketed ``rx_ms``/``tx_ms`` per ``bucket_seconds`` slot
    (from its packet DB, so RX is real). Convert each bucket to channel
    utilization %: ``100 * ms / (bucket_seconds * 1000)``, capped at 100, in the
    same ``{timestamp, tx_pct, rx_pct}`` shape the local computation returns.
    """
    bucket_seconds = data.get("bucket_seconds") or 0
    denom = bucket_seconds * 1000
    out: list[dict] = []
    for bucket in data.get("buckets") or []:
        ts = bucket.get("timestamp")
        if ts is None:
            continue
        if denom > 0:
            tx_pct = min(100.0, 100.0 * (bucket.get("tx_ms", 0.0) / denom))
            rx_pct = min(100.0, 100.0 * (bucket.get("rx_ms", 0.0) / denom))
        else:
            tx_pct = rx_pct = 0.0
        out.append(
            {
                "timestamp": int(ts),
                "tx_pct": round(tx_pct, 2),
                "rx_pct": round(rx_pct, 2),
            }
        )
    out.sort(key=lambda p: p["timestamp"])
    return out
