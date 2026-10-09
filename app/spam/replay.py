"""Spam Guard replay: an evidence log run through a fresh detector (pure, no I/O).

"What would these settings have done to that spam wave?" The ``msg`` records of
an evidence log (``app/spam/evidence.py``) are fed, in time order, to a new
detector that starts with nothing learnt and runs on a clock driven by the
records' own timestamps. The outcome is scored against the ``label`` records,
the user's "This is spam" / "Not spam" answers:

- labelled spam: ``caught`` (stopped on arrival), ``flagged_later`` (let
  through, flagged as spam once the campaign showed) or ``missed``;
- labelled genuine: ``passed`` or ``wrongly_held``.

It follows the host repeater's timing: a block confirmed by a message also
catches that message. Things a replay cannot know are left out: blocks and
exceptions the user made by hand at the time, and anything learnt before the
log starts. A replay therefore starts cold, the way a fresh install does.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.spam.detector import SpamDetector
from app.spam.evidence import RECORD_LABEL, RECORD_MESSAGE
from app.spam.settings import SpamConfig

# The live runtime looks at expiry and settling at least this often.
TICK_SECONDS = 30.0
# Events are judged for learning once they are this old (see the detector).
SETTLE_SECONDS = 130.0
SAMPLE_LIMIT = 50
SAMPLE_TEXT = 200


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _sample(record: dict[str, Any], matched: str | None) -> dict[str, Any]:
    return {
        "ts": record["ts"],
        "sender": record["sender"],
        "text": record["text"][:SAMPLE_TEXT],
        "matched": matched,
    }


def _labels(records: Sequence[dict[str, Any]]) -> dict[Any, str]:
    """The last verdict per message id."""
    verdicts: dict[Any, str] = {}
    for record in sorted(
        (r for r in records if r.get("type") == RECORD_LABEL), key=lambda r: r.get("ts") or 0
    ):
        if record.get("message_id") is not None:
            verdicts[record["message_id"]] = record["label"]
    return verdicts


def replay(
    records: Sequence[dict[str, Any]],
    config: SpamConfig,
    *,
    scrambled: bool = False,
    sample_limit: int = SAMPLE_LIMIT,
) -> dict[str, Any]:
    """Run the messages of an evidence log through ``config`` and score the result.

    ``scrambled``: the names are codes, so the recorded name signals are used
    instead of judging the codes.
    """
    messages = sorted(
        (r for r in records if r.get("type") == RECORD_MESSAGE), key=lambda r: r["ts"]
    )
    verdicts = _labels(records)
    clock = _Clock()
    detector = SpamDetector(config, clock=clock)
    events = []
    flagged: set[int] = set()
    blocks: dict[str, tuple[str, str]] = {}
    last_decide = float("-inf")

    for index, record in enumerate(messages):
        clock.now = float(record["ts"])
        if clock.now - last_decide >= TICK_SECONDS:
            # What the periodic tick does live: end blocks, settle older messages.
            flagged |= detector.decide().flag
        signals: dict[str, Any] = {}
        if scrambled:
            if isinstance(record.get("name_score"), int):
                signals["name_score"] = record["name_score"]
            if isinstance(record.get("name_disguised"), bool):
                signals["name_disguised"] = record["name_disguised"]
        path = record.get("path")
        event = detector.ingest(
            ts=clock.now,
            path=[str(hop) for hop in path] if isinstance(path, list) else [],
            sender=record["sender"],
            text=record["text"],
            channel=str(record.get("channel") or ""),
            length=int(record.get("length") or 0),
            message_id=index,
            **signals,
        )
        flagged |= detector.decide(rematch=event).flag
        last_decide = clock.now
        events.append(event)
        for block in detector.blocks.values():
            blocks.setdefault(block.key, (block.kind, block.source))

    if messages:
        clock.now += SETTLE_SECONDS
        flagged |= detector.decide().flag

    counts = dict.fromkeys(("caught", "flagged_later", "missed", "passed", "wrongly_held"), 0)
    labels = {"spam": 0, "genuine": 0}
    missed_samples: list[dict[str, Any]] = []
    held_samples: list[dict[str, Any]] = []
    stopped = 0
    for index, (record, event) in enumerate(zip(messages, events, strict=True)):
        was_stopped = event.matched is not None
        was_flagged = event.spam or index in flagged
        stopped += was_stopped
        verdict = (
            verdicts.get(record.get("message_id")) if record.get("message_id") is not None else None
        )
        if verdict == "spam":
            labels["spam"] += 1
            outcome = "caught" if was_stopped else "flagged_later" if was_flagged else "missed"
            counts[outcome] += 1
            if outcome == "missed" and len(missed_samples) < sample_limit:
                missed_samples.append(_sample(record, None))
        elif verdict == "genuine":
            labels["genuine"] += 1
            held = was_stopped or was_flagged
            counts["wrongly_held" if held else "passed"] += 1
            if held and len(held_samples) < sample_limit:
                held_samples.append(_sample(record, event.matched))

    by_kind: dict[str, int] = {}
    duplicates = 0
    for kind, source in blocks.values():
        if source == "dedupe":
            duplicates += 1
        else:
            by_kind[kind] = by_kind.get(kind, 0) + 1

    return {
        "messages": len(messages),
        "first_ts": messages[0]["ts"] if messages else None,
        "last_ts": messages[-1]["ts"] if messages else None,
        # Would not have been forwarded on arrival.
        "stopped": stopped,
        # Marked as spam in chat, on arrival or afterwards.
        "flagged": sum(1 for index, event in enumerate(events) if event.spam or index in flagged),
        # What the detector did at the time the log was written.
        "recorded_stopped": sum(1 for record in messages if record.get("matched")),
        "blocks": by_kind,
        "duplicate_blocks": duplicates,
        "labels": labels,
        **counts,
        "missed_samples": missed_samples,
        "wrongly_held_samples": held_samples,
    }
