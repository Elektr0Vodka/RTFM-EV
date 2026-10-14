"""Statistics over stored channel messages for the Mesh Health "Spam & bots" tab.

Pure: rows in, report out, no I/O. ``app/repository/filter_stats.py`` reads the
rows and ``app/routers/filter_stats.py`` serves the report.

Four categories are counted per message: spam (``messages.spam``), malformed
(``messages.malformed``), duplicate (``messages.duplicate``) and bot. A bot is
counted two ways: listed now (the sender is on an enabled bot list today) and
flagged on arrival (``messages.bot``, migration _148). "Flagged" means at least
one of spam, malformed, duplicate or listed-now bot.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from hashlib import sha256
from typing import Any

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.path_utils import split_path_hex

# First hop of a message heard without a relay.
DIRECT = "DIRECT"
OUTCOMES = ("clean", "stopped", "let_through", "held")


@dataclass(frozen=True)
class MessageRow:
    """One incoming channel message, as the statistics need it."""

    id: int
    received_at: int
    channel: str
    sender_name: str | None
    sender_key: str | None
    # First relay on the path, ``DIRECT``, or None when the path is not known.
    first_hop: str | None
    spam: bool
    malformed: bool
    duplicate: bool
    bot: bool
    malformed_reason: str | None
    spam_outcome: str | None
    spam_block: str | None
    spam_enforced: bool | None
    spam_label: str | None


@dataclass(frozen=True)
class ChannelInfo:
    name: str
    public: bool


def channel_is_public(key: str, name: str) -> bool:
    """The key is public knowledge: the Public channel, or derived from a #name.

    The same test as ``ProtectedChannel.key_is_public`` in ``app/spam/settings.py``.
    """
    if key.upper() == PUBLIC_CHANNEL_KEY:
        return True
    if not name.startswith("#"):
        return False
    return sha256(name.encode("utf-8")).digest()[:16].hex().upper() == key.upper()


# A channel key inside a rule name: exactly 32 hex characters, not part of a
# longer hex run (a 64 character public key is left alone).
_CHANNEL_KEY = re.compile(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{32}(?![0-9A-Fa-f])")


def clean_policy_rules(
    rules: list[dict[str, Any]], channels: dict[str, ChannelInfo]
) -> list[dict[str, Any]]:
    """Policy rule counts with every channel key taken out of the rule names.

    Spam Guard names its OpenHop rules after the channel they guard
    (``known-people:<key>``, ``bots:<key>``, ``<block>:<key>``,
    ``app/spam/rules.py``), and the key of a private channel is its secret. A
    public channel's key becomes the channel name; any other key becomes a short
    one-way id. Rows that end up with the same action and name are added up.
    """

    def without_keys(name: str) -> str:
        def swap(match: re.Match[str]) -> str:
            key = match.group(0).upper()
            info = channels.get(key)
            if info is not None and info.public and info.name:
                return info.name
            return f"channel-{sha256(bytes.fromhex(key)).hexdigest()[:8]}"

        return _CHANNEL_KEY.sub(swap, name)

    merged: dict[tuple[str, str | None], dict[str, Any]] = {}
    for rule in rules:
        name = without_keys(rule["rule"]) if rule["rule"] else rule["rule"]
        entry = merged.setdefault(
            (rule["action"], name), {"action": rule["action"], "rule": name, "packets": 0}
        )
        entry["packets"] += rule["packets"]
    return list(merged.values())


def first_hop(paths_json: str | None) -> str | None:
    """The first relay of a message's first reception, from ``messages.paths``.

    ``DIRECT`` for an empty path, None when the stored value cannot be read.
    """
    if not paths_json:
        return None
    try:
        entries = json.loads(paths_json)
    except ValueError:
        return None
    if not isinstance(entries, list) or not entries or not isinstance(entries[0], dict):
        return None
    path = entries[0].get("path")
    if not isinstance(path, str):
        return None
    if not path:
        return DIRECT
    hop_count = entries[0].get("path_len")
    if not isinstance(hop_count, int) or hop_count <= 0:
        hop_count = len(path) // 2
    hops = split_path_hex(path, hop_count)
    return hops[0].upper() if hops else None


@dataclass
class _Counts:
    messages: int = 0
    spam: int = 0
    malformed: int = 0
    duplicate: int = 0
    bot_now: int = 0
    flagged: int = 0

    def add(self, row: MessageRow, bot_now: bool) -> None:
        self.messages += 1
        self.spam += row.spam
        self.malformed += row.malformed
        self.duplicate += row.duplicate
        self.bot_now += bot_now
        self.flagged += row.spam or row.malformed or row.duplicate or bot_now


@dataclass
class _Sender:
    counts: _Counts = field(default_factory=_Counts)
    public_key: str | None = None
    bot_flagged: int = 0
    bot_lists: set[str] = field(default_factory=set)
    channels: set[str] = field(default_factory=set)
    first_seen: int = 0
    last_seen: int = 0


@dataclass
class _Source:
    counts: _Counts = field(default_factory=_Counts)
    last_seen: int = 0


def aggregate_filter_stats(
    rows: Iterable[MessageRow],
    *,
    start_ts: int,
    end_ts: int,
    buckets: int,
    limit: int,
    bot_names: dict[str, list[str]],
    bot_keys: dict[str, list[str]],
    channels: dict[str, ChannelInfo],
    policy_rules: list[dict[str, Any]],
    channel: str | None = None,
) -> dict[str, Any]:
    """Build the report for ``[start_ts, end_ts)``.

    ``bot_names`` / ``bot_keys`` map a sender name / a lower-case public key to
    the names of the enabled bot lists that hold it (exceptions already left
    out). ``limit`` cuts the sender and source tables.
    """
    bucket_seconds = max(1, math.ceil(max(1, end_ts - start_ts) / buckets))
    series = [_Counts() for _ in range(buckets)]
    totals = _Counts()
    extra: dict[str, int] = dict.fromkeys(
        (
            "malformed_text",
            "malformed_clock",
            "malformed_both",
            "malformed_unknown",
            "bot_flagged",
            "bot_listed_later",
            "bot_no_longer_listed",
            "multi_flag",
        ),
        0,
    )
    filters: dict[str, int] = dict.fromkeys(
        (
            "analysed",
            *OUTCOMES,
            "enforced",
            "not_enforced",
            "confirmed",
            "missed",
            "false_positive",
            "flagged_later",
            "not_recorded",
        ),
        0,
    )
    blocks: dict[str, int] = {}
    senders: dict[str, _Sender] = {}
    by_channel: dict[str, _Counts] = {}
    sources: dict[str, _Source] = {}

    for row in rows:
        if not start_ts <= row.received_at < end_ts:
            continue
        lists = set(bot_names.get(row.sender_name or "", ()))
        lists.update(bot_keys.get((row.sender_key or "").lower(), ()))
        bot_now = bool(lists)

        totals.add(row, bot_now)
        series[min(buckets - 1, (row.received_at - start_ts) // bucket_seconds)].add(row, bot_now)
        by_channel.setdefault(row.channel, _Counts()).add(row, bot_now)

        if row.malformed:
            cause = (
                row.malformed_reason
                if row.malformed_reason in ("text", "clock", "both")
                else "unknown"
            )
            extra[f"malformed_{cause}"] += 1
        extra["bot_flagged"] += row.bot
        extra["bot_listed_later"] += bot_now and not row.bot
        extra["bot_no_longer_listed"] += row.bot and not bot_now
        extra["multi_flag"] += (row.spam + row.malformed + row.duplicate + bot_now) >= 2

        sender = senders.setdefault(row.sender_name or "", _Sender(first_seen=row.received_at))
        sender.counts.add(row, bot_now)
        sender.public_key = sender.public_key or (
            row.sender_key.lower() if row.sender_key else None
        )
        sender.bot_flagged += row.bot
        sender.bot_lists |= lists
        sender.channels.add(row.channel)
        sender.first_seen = min(sender.first_seen, row.received_at)
        sender.last_seen = max(sender.last_seen, row.received_at)

        if row.first_hop is not None:
            source = sources.setdefault(row.first_hop, _Source())
            source.counts.add(row, bot_now)
            source.last_seen = max(source.last_seen, row.received_at)

        outcome = row.spam_outcome if row.spam_outcome in OUTCOMES else None
        if outcome is None:
            filters["not_recorded"] += 1
        else:
            filters["analysed"] += 1
            if outcome == "clean" and row.spam:
                # Spam Guard flags earlier copies of a campaign after they settled.
                outcome = "let_through"
                filters["flagged_later"] += 1
            filters[outcome] += 1
            if outcome == "stopped":
                filters["enforced" if row.spam_enforced else "not_enforced"] += 1
            if outcome in ("stopped", "held"):
                source_name = row.spam_block or "expired"
                blocks[source_name] = blocks.get(source_name, 0) + 1
        if row.spam_label == "spam":
            filters["confirmed" if outcome == "stopped" else "missed"] += 1
        elif row.spam_label == "genuine" and outcome in ("stopped", "held", "let_through"):
            filters["false_positive"] += 1

    sender_rows = [
        {
            "name": name,
            "public_key": sender.public_key,
            **asdict(sender.counts),
            "bot_flagged": sender.bot_flagged,
            "bot_lists": sorted(sender.bot_lists),
            "channels": len(sender.channels),
            "first_seen": sender.first_seen,
            "last_seen": sender.last_seen,
        }
        for name, sender in senders.items()
        if sender.counts.flagged
    ]
    sender_rows.sort(key=lambda s: (-s["flagged"], -s["messages"], s["name"]))

    channel_rows = []
    for key, counts in by_channel.items():
        info = channels.get(key, ChannelInfo("", False))
        channel_rows.append(
            {"key": key, "name": info.name, "public": info.public, **asdict(counts)}
        )
    channel_rows.sort(key=lambda c: (-c["flagged"], -c["messages"], c["name"], c["key"]))

    source_rows = [
        {"hop": hop, **asdict(source.counts), "last_seen": source.last_seen}
        for hop, source in sources.items()
        if source.counts.flagged
    ]
    source_rows.sort(key=lambda s: (-s["flagged"], -s["messages"], s["hop"]))

    judged = filters["stopped"] + filters["let_through"]
    return {
        "window": {
            "start_ts": start_ts,
            "end_ts": end_ts,
            "bucket_seconds": bucket_seconds,
            "channel": channel,
        },
        "totals": {**asdict(totals), **extra},
        "series": [
            {"bucket_ts": start_ts + index * bucket_seconds, **asdict(counts)}
            for index, counts in enumerate(series)
        ],
        "senders": sender_rows[:limit],
        "senders_truncated": len(sender_rows) > limit,
        "channels": channel_rows,
        "sources": source_rows[:limit],
        "sources_truncated": len(source_rows) > limit,
        "filters": {
            **filters,
            "stop_rate": round(100 * filters["stopped"] / judged) if judged else None,
            "blocks": [{"source": name, "count": count} for name, count in sorted(blocks.items())],
        },
        "policy_rules": policy_rules,
    }
