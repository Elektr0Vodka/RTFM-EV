"""Spam Guard: state, settings, actions, rendered rules and health.

Spam Guard detects channel spam behaviour and turns it into expiring blocks
(``app/spam``). In Protect mode the blocks become forwarding rules on the host
repeater; in Monitor mode nothing is enforced and the numbers show what would
have been stopped. Nothing here transmits.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.spam_guard import spam_guard
from app.spam.rules import render
from app.spam.settings import SpamConfig, effective

router = APIRouter(prefix="/spam-guard", tags=["spam-guard"])


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
    rules = render(
        spam_guard.detector, "openhop" if backend == "openhop" else "host", preview=preview
    )
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
