"""Check whether the fork's ``main`` is ahead of the running commit.

Detect-and-notify only. Calls the GitHub compare API at most once per TTL and
caches the interpreted result in-memory. Never raises to callers; any failure
degrades to ``update_available: False``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import settings
from app.version_info import get_app_build_info

logger = logging.getLogger(__name__)

REPO = "Elektr0Vodka/RTFM-EV"
BRANCH = "main"
API_URL = f"https://api.github.com/repos/{REPO}/compare/{{base}}...{BRANCH}"
COMPARE_URL = f"https://github.com/{REPO}/compare/{{base}}...{BRANCH}"
CACHE_TTL_SECONDS = 6 * 60 * 60
ERROR_CACHE_TTL_SECONDS = 15 * 60

_cache: dict[str, Any] | None = None
_cache_at: float = 0.0
_cache_ttl: float = 0.0
_lock = asyncio.Lock()


def reset_cache() -> None:
    """Test helper: drop the cached result."""
    global _cache, _cache_at, _cache_ttl
    _cache = None
    _cache_at = 0.0
    _cache_ttl = 0.0


def _disabled_result() -> dict[str, Any]:
    return {
        "check_enabled": False,
        "update_available": False,
        "current_commit": None,
        "latest_commit": None,
        "commits_behind": 0,
        "compare_url": None,
        "checked_at": int(time.time()),
    }


def _empty_result(current_commit: str | None) -> dict[str, Any]:
    return {
        "check_enabled": True,
        "update_available": False,
        "current_commit": current_commit,
        "latest_commit": None,
        "commits_behind": 0,
        "compare_url": None,
        "checked_at": int(time.time()),
    }


async def _fetch(current_commit: str) -> tuple[dict[str, Any], bool]:
    """Return (result, ok). ``ok`` is False for transport/HTTP/parse failures,
    which are cached for a shorter window so they self-heal."""
    url = API_URL.format(base=current_commit)
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"Accept": "application/vnd.github+json"})
    except httpx.HTTPError as exc:
        logger.info("Update check fetch failed: %s", exc)
        return _empty_result(current_commit), False

    if response.status_code != 200:
        logger.info("Update check returned HTTP %s", response.status_code)
        return _empty_result(current_commit), False

    try:
        payload = response.json()
    except Exception:
        return _empty_result(current_commit), False

    status = payload.get("status")
    ahead_by = payload.get("ahead_by", 0) or 0
    commits = payload.get("commits") or []
    latest_sha = commits[-1].get("sha") if commits else None
    latest_commit = latest_sha[:8] if isinstance(latest_sha, str) else None
    update_available = status == "ahead" and ahead_by > 0

    return (
        {
            "check_enabled": True,
            "update_available": update_available,
            "current_commit": current_commit,
            "latest_commit": latest_commit,
            "commits_behind": ahead_by if update_available else 0,
            "compare_url": COMPARE_URL.format(base=current_commit) if update_available else None,
            "checked_at": int(time.time()),
        },
        True,
    )


async def get_update_status() -> dict[str, Any]:
    """Return the cached update-status payload, refreshing past the TTL."""
    global _cache, _cache_at, _cache_ttl

    if not settings.update_check_enabled:
        return _disabled_result()

    current_commit = get_app_build_info().commit_hash
    if not current_commit:
        return _empty_result(None)

    async with _lock:
        fresh = (
            _cache is not None
            and _cache.get("current_commit") == current_commit
            and (time.time() - _cache_at) < _cache_ttl
        )
        if fresh:
            return _cache  # type: ignore[return-value]

        result, ok = await _fetch(current_commit)
        _cache = result
        _cache_at = time.time()
        _cache_ttl = CACHE_TTL_SECONDS if ok else ERROR_CACHE_TTL_SECONDS
        return result
