"""Spam Guard evidence log: record shapes, export and parsing (pure, no I/O).

While the evidence log is on, every analysed channel message and every "This is
spam" / "Not spam" answer is kept as one small JSON record. The log exists to
look back at a spam wave, to share it, and to try other settings on it
(``app/spam/replay.py``).

Two record types:

- ``msg``: what the detector was given (time, route, sender, text, packet
  length) and what it made of it at that moment (name signals, known, matched
  block, spam flag).
- ``label``: the user's verdict on one message, ``spam`` or ``genuine``.

A record never holds a channel key. The channel is a short one-way id of the
key, enough to tell channels apart in a replay; the name is kept next to it for
the reader.

An export is JSON Lines with a ``meta`` first line. A scrambled export replaces
every sender name, and every ``@[name]`` mention in a text, with a code that is
the same throughout that export and different in the next one, and drops the
channel names. Names typed into a text without the mention form cannot be
recognised and stay as written.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from app.spam.detector import Event
from app.spam.settings import SpamConfig, SpamTunables, effective
from app.spam.text import is_disguised

FORMAT_VERSION = 1
RECORD_MESSAGE = "msg"
RECORD_LABEL = "label"
RECORD_META = "meta"
Label = Literal["spam", "genuine"]
# Upper bound on the records one replay or upload may hold.
MAX_RECORDS = 200_000

_MENTION = re.compile(r"@\[([^\]\n]{1,48})\]")


def channel_id(key: str) -> str:
    """A short one-way id for a channel key (never the key itself)."""
    return hashlib.sha256(bytes.fromhex(key)).hexdigest()[:12].upper()


def message_record(event: Event, *, known: bool, channel_name: str = "") -> dict[str, Any]:
    """One analysed message, as stored."""
    return {
        "type": RECORD_MESSAGE,
        "ts": event.ts,
        "channel": channel_id(event.channel),
        "channel_name": channel_name,
        "sender": event.sender,
        "text": event.text,
        "path": list(event.path),
        "length": event.length,
        "message_id": event.message_id,
        # Kept so a scrambled export can still be replayed: the name is gone
        # there, what it looked like is not.
        "name_score": event.name_score,
        "name_disguised": is_disguised(event.sender, name=True),
        "random": event.random,
        "known": known,
        "exempt": event.exempt,
        "matched": event.matched,
        "spam": event.spam,
    }


def label_record(
    *, ts: float, label: Label, message_id: int | None, sender: str, text: str, channel: str
) -> dict[str, Any]:
    """The user's verdict on one message."""
    return {
        "type": RECORD_LABEL,
        "ts": ts,
        "label": label,
        "message_id": message_id,
        "sender": sender,
        "text": text,
        "channel": channel_id(channel) if channel else "",
    }


class Scrambler:
    """Replaces names by codes that are stable within one export."""

    def __init__(self, salt: bytes | None = None) -> None:
        self._salt = salt if salt is not None else secrets.token_bytes(16)
        self._codes: dict[str, str] = {}

    def code(self, name: str) -> str:
        code = self._codes.get(name)
        if code is None:
            digest = hashlib.sha256(self._salt + name.encode("utf-8")).hexdigest()
            code = self._codes[name] = f"user-{digest[:8]}"
        return code

    def text(self, text: str) -> str:
        return _MENTION.sub(lambda match: f"@[{self.code(match.group(1))}]", text)

    def record(self, record: dict[str, Any]) -> dict[str, Any]:
        out = {key: value for key, value in record.items() if key != "channel_name"}
        if isinstance(out.get("sender"), str):
            out["sender"] = self.code(out["sender"])
        if isinstance(out.get("text"), str):
            out["text"] = self.text(out["text"])
        return out


def meta_record(*, now: float, days: int, scrambled: bool) -> dict[str, Any]:
    return {
        "type": RECORD_META,
        "version": FORMAT_VERSION,
        "exported_at": now,
        "days": days,
        "scrambled": scrambled,
    }


def export_line(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"


def export_lines(
    records: Iterable[dict[str, Any]], *, scramble: bool, now: float, days: int
) -> Iterator[str]:
    """The export as JSON Lines: a ``meta`` line, then one line per record."""
    scrambler = Scrambler() if scramble else None
    yield export_line(meta_record(now=now, days=days, scrambled=scramble))
    for record in records:
        yield export_line(scrambler.record(record) if scrambler else record)


@dataclass
class Parsed:
    records: list[dict[str, Any]] = field(default_factory=list)
    # From the ``meta`` line: names are codes, so only the recorded name
    # signals say what a name looked like.
    scrambled: bool = False
    skipped: int = 0


def _usable(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    if record.get("type") == RECORD_MESSAGE:
        return (
            isinstance(record.get("ts"), int | float)
            and isinstance(record.get("sender"), str)
            and isinstance(record.get("text"), str)
        )
    if record.get("type") == RECORD_LABEL:
        return record.get("label") in ("spam", "genuine")
    return False


def parse_lines(text: str, *, limit: int = MAX_RECORDS) -> Parsed:
    """Read an export back. Lines that are not usable records are counted, not fatal.

    Raises ``ValueError`` when there are more than ``limit`` records.
    """
    out = Parsed()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            out.skipped += 1
            continue
        if isinstance(record, dict) and record.get("type") == RECORD_META:
            out.scrambled = bool(record.get("scrambled"))
            continue
        if not _usable(record):
            out.skipped += 1
            continue
        if len(out.records) >= limit:
            raise ValueError(f"an evidence file holds at most {limit} records")
        out.records.append(record)
    return out


def retention_days(stored_settings: dict[str, Any] | None) -> int:
    """How many days of evidence to keep, from the stored settings document."""
    if stored_settings:
        try:
            return effective(SpamConfig.model_validate(stored_settings)).evidence_days
        except ValidationError:
            pass
    return SpamTunables().evidence_days
