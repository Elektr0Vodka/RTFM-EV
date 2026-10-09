"""Spam Guard: state, settings, actions, rendered rules and health.

Spam Guard detects channel spam behaviour and turns it into expiring blocks
(``app/spam``). In Protect mode the blocks become forwarding rules on the host
repeater, or in the policy of an OpenHop node when that is the connected radio;
in Monitor mode nothing is enforced and the numbers show what would have been
stopped. Nothing here transmits.
"""

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.repository.spam import SpamEvidenceRepository
from app.services.spam_guard import spam_guard
from app.spam.evidence import Scrambler, export_line, meta_record, parse_lines
from app.spam.replay import replay
from app.spam.rules import render
from app.spam.settings import SpamConfig, effective

router = APIRouter(prefix="/spam-guard", tags=["spam-guard"])

# A replay costs several milliseconds per message (measured 6 to 8 ms on a busy
# synthetic channel), so this is a minute or two at most. Fewer days fit more easily.
MAX_REPLAY_MESSAGES = 20_000
MAX_EVIDENCE_UPLOAD_CHARS = 40_000_000


class SpamGuardSaveRequest(BaseModel):
    version: int = Field(description="Settings version from the last read (409 when stale)")
    settings: SpamConfig


class SpamGuardActionRequest(BaseModel):
    op: str = Field(
        description=(
            "unblock, lockdown, block_hop, block_text, mark_spam, not_spam, extend, "
            "block_action, hop_mode, forget_path, allow_origin, unallow_origin, allow_hop, "
            "unallow_hop, allow_sender, unallow_sender, allow_text, unallow_text, "
            "clear_auto or clear_suppressed"
        )
    )
    args: dict[str, Any] = Field(default_factory=dict, description="Arguments of the action")
    message_id: int | None = Field(
        default=None,
        description=(
            "For mark_spam / not_spam: the stored message the user acted on; its chat "
            "spam flag is set or cleared"
        ),
    )


class SpamGuardActionResponse(BaseModel):
    result: dict[str, Any]
    state: dict[str, Any]


class SpamGuardReplayRequest(BaseModel):
    days: int | None = Field(
        default=None,
        ge=1,
        le=30,
        description="Replay the stored evidence of this many days (default: evidence_days)",
    )
    evidence: str | None = Field(
        default=None,
        max_length=MAX_EVIDENCE_UPLOAD_CHARS,
        description="An evidence export (JSON Lines) to replay instead of the stored log",
    )
    settings: SpamConfig | None = Field(
        default=None,
        description="Settings to try; the saved settings when left out. Never stored.",
    )


@router.get("")
async def get_spam_guard() -> dict[str, Any]:
    """Everything the Spam Guard page shows: settings, blocks, held messages,
    recent messages with their signals, numbers for the overview and health."""
    await spam_guard.ensure_loaded()
    return spam_guard.snapshot()


@router.put("/settings")
async def save_spam_guard_settings(request: SpamGuardSaveRequest) -> dict[str, Any]:
    """Save the whole settings document. 409 when ``version`` is stale."""
    await spam_guard.ensure_loaded()
    if (
        spam_guard.backend_name() == "openhop"
        and effective(request.settings).hop_match_mode == "starts_at"
    ):
        raise HTTPException(
            status_code=409,
            detail="OpenHop cannot match on the first hop; pick another repeater match mode",
        )
    version = await spam_guard.save_config(request.version, request.settings)
    if version is None:
        raise HTTPException(
            status_code=409,
            detail="Spam Guard settings were changed elsewhere; reload and try again",
        )
    return spam_guard.snapshot()


@router.post("/action", response_model=SpamGuardActionResponse)
async def run_spam_guard_action(request: SpamGuardActionRequest) -> SpamGuardActionResponse:
    """Run one user action (remove a block, lockdown, trust a name, ...). 400 on bad input."""
    await spam_guard.ensure_loaded()
    try:
        result = await spam_guard.action(request.op, request.args, message_id=request.message_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SpamGuardActionResponse(result=result, state=spam_guard.snapshot())


@router.get("/rules")
async def get_spam_guard_rules(
    preview: bool = Query(
        default=False,
        description="Render the rules Protect mode would apply, whatever the current mode",
    ),
) -> dict[str, Any]:
    """The forwarding rules for the active backend, read-only.

    Empty in Monitor mode and while paused unless ``preview`` is set.
    """
    await spam_guard.ensure_loaded()
    backend = spam_guard.backend_name()
    if backend == "openhop":
        # Exactly what is synced to the node: a private channel whose key the
        # user has not agreed to copy there is left out.
        rules = spam_guard.openhop_rules(preview=preview)
    else:
        rules = render(spam_guard.detector, "host", preview=preview)
    return {
        "backend": backend,
        "before": rules.before,
        "after": rules.after,
        "known_senders": rules.known_senders,
        "truncated": rules.truncated,
    }


@router.get("/health")
async def get_spam_guard_health() -> JSONResponse:
    """Whether Spam Guard is working. 200 when healthy or switched off, 503 otherwise."""
    await spam_guard.ensure_loaded()
    health = spam_guard.health()
    return JSONResponse(health, status_code=503 if health["state"] == "bad" else 200)


@router.get("/evidence")
async def get_spam_guard_evidence(
    days: int = Query(default=7, ge=1, le=30, description="How many days back to export"),
    scramble: bool = Query(
        default=False,
        description=(
            "Replace every sender name and @[name] mention with a code that is stable "
            "within this export, and leave the channel names out"
        ),
    ),
) -> StreamingResponse:
    """The evidence log as a JSON Lines download: a ``meta`` line, then one record per line.

    Empty apart from the ``meta`` line unless the evidence log is, or was, switched on.
    """
    now = time.time()
    scrambler = Scrambler() if scramble else None

    async def lines() -> AsyncIterator[str]:
        yield export_line(meta_record(now=now, days=days, scrambled=scramble))
        async for record in SpamEvidenceRepository.iter_since(now - days * 86400):
            yield export_line(scrambler.record(record) if scrambler else record)

    stamp = time.strftime("%Y%m%d-%H%M", time.gmtime(now))
    name = f"spam-guard-evidence-{stamp}{'-scrambled' if scramble else ''}.jsonl"
    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/replay")
async def replay_spam_guard_evidence(request: SpamGuardReplayRequest) -> dict[str, Any]:
    """Run an evidence log through a fresh detector and score it against the user's labels.

    Nothing is stored or changed: no settings, no blocks, no chat flags.
    """
    await spam_guard.ensure_loaded()
    skipped, scrambled = 0, False
    try:
        if request.evidence is not None:
            parsed = parse_lines(request.evidence, limit=MAX_REPLAY_MESSAGES)
            records, skipped, scrambled = parsed.records, parsed.skipped, parsed.scrambled
        else:
            days = request.days or spam_guard.detector.tunables.evidence_days
            records = await SpamEvidenceRepository.list_since(
                time.time() - days * 86400, limit=MAX_REPLAY_MESSAGES
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    config = request.settings or spam_guard.config
    # Detection work on a large log takes seconds: keep it off the event loop.
    result = await asyncio.to_thread(replay, records, config, scrambled=scrambled)
    return {
        **result,
        "source": "upload" if request.evidence is not None else "stored",
        "scrambled": scrambled,
        "skipped": skipped,
    }
