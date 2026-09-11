# In-app Update Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an in-app "update available" indicator (with a button to the GitHub `main` compare view) when the running commit is behind the fork's `main` HEAD.

**Architecture:** A backend endpoint `GET /api/update-status` calls the GitHub compare API once and caches the result in-memory (6h TTL). The frontend fetches it once per session via a shared `useUpdateStatus` hook, rendering a full indicator + button in Settings -> About and a small dot on the StatusBar settings button. Detect-and-notify only; no self-update.

**Tech Stack:** FastAPI, `httpx.AsyncClient` (existing dep), Pydantic settings; React + TypeScript, Vitest, i18next.

**Commits:** Committing feature work on this branch is authorized for this session. Do NOT push or open PRs without a further explicit instruction. No attribution/co-author lines in commit messages.

**Repository under check:** `Elektr0Vodka/RTFM-EV` (the fork).

---

## File Structure

**Backend**
- Create: `app/services/update_check.py` — GitHub compare call, interpretation, in-memory cache.
- Create: `app/routers/update_status.py` — `/update-status` endpoint + response model.
- Modify: `app/config.py` — add `update_check_enabled` setting.
- Modify: `app/main.py` — register the router.
- Modify: `docker-compose.example.yml` — document the opt-out env var.
- Create: `tests/test_update_check.py` — service tests.
- Create: `tests/test_update_status_api.py` — endpoint test.

**Frontend**
- Modify: `frontend/src/types.ts` — `UpdateStatus` type.
- Modify: `frontend/src/api.ts` — `getUpdateStatus()`.
- Create: `frontend/src/hooks/useUpdateStatus.ts` — shared, session-cached fetch hook.
- Modify: `frontend/src/components/settings/SettingsAboutSection.tsx` — indicator + button.
- Modify: `frontend/src/components/StatusBar.tsx` — dot on settings button.
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json` — new strings.
- Create: `frontend/src/test/useUpdateStatus.test.ts` — hook caching test.
- Modify: `frontend/src/test/settingsAboutSection.test.tsx` — indicator tests.

---

## Task 1: Config setting `update_check_enabled`

**Files:**
- Modify: `app/config.py:34` (after the `vapid_subject` field)

- [ ] **Step 1: Add the setting field**

In `app/config.py`, inside `class Settings`, add after the `vapid_subject` line:

```python
    update_check_enabled: bool = True
```

(The class already sets `env_prefix="MESHCORE_"`, so the env var is `MESHCORE_UPDATE_CHECK_ENABLED`.)

- [ ] **Step 2: Verify it imports**

Run: `uv run python -c "from app.config import settings; print(settings.update_check_enabled)"`
Expected: prints `True`

- [ ] **Step 3: Commit**

```bash
git add app/config.py
git commit -m "feat(update-check): add update_check_enabled setting"
```

---

## Task 2: Update-check service

Interprets `git compare` semantics: calling `compare/<local>...main` returns `ahead_by` = number of commits `main` is ahead of `<local>`, which is our "commits behind".

**Files:**
- Create: `app/services/update_check.py`
- Test: `tests/test_update_check.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_update_check.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.update_check as uc


@pytest.fixture(autouse=True)
def _reset_cache():
    uc.reset_cache()
    yield
    uc.reset_cache()


def _mock_response(status_code=200, payload=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=payload or {})
    return resp


def _patch_build_info(commit_hash):
    info = MagicMock()
    info.commit_hash = commit_hash
    return patch.object(uc, "get_app_build_info", return_value=info)


def _patch_get(resp):
    client = AsyncMock()
    client.get = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch.object(uc.httpx, "AsyncClient", return_value=ctx), client


@pytest.mark.asyncio
async def test_update_available_when_main_ahead():
    payload = {
        "status": "ahead",
        "ahead_by": 7,
        "commits": [{"sha": "a1b2c3d4e5f6"}],
    }
    get_patch, client = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is True
    assert result["commits_behind"] == 7
    assert result["current_commit"] == "dc11fbe0"
    assert result["latest_commit"] == "a1b2c3d4"
    assert result["compare_url"] == (
        "https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main"
    )
    client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_up_to_date_when_identical():
    payload = {"status": "identical", "ahead_by": 0, "commits": []}
    get_patch, _ = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False
    assert result["commits_behind"] == 0


@pytest.mark.asyncio
async def test_diverged_is_not_an_update():
    payload = {"status": "diverged", "ahead_by": 3, "commits": []}
    get_patch, _ = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_http_404_is_not_an_update():
    get_patch, _ = _patch_get(_mock_response(404, {}))
    with _patch_build_info("deadbeef"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_no_commit_hash_skips_network():
    with _patch_build_info(None) as bi:
        client_patch, client = _patch_get(_mock_response(200, {}))
        with client_patch:
            result = await uc.get_update_status()
        client.get.assert_not_awaited()
    assert result["check_enabled"] is True
    assert result["update_available"] is False
    assert result["current_commit"] is None


@pytest.mark.asyncio
async def test_disabled_setting_skips_network(monkeypatch):
    monkeypatch.setattr(uc.settings, "update_check_enabled", False)
    client_patch, client = _patch_get(_mock_response(200, {}))
    with _patch_build_info("dc11fbe0"), client_patch:
        result = await uc.get_update_status()
    client.get.assert_not_awaited()
    assert result["check_enabled"] is False
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_result_is_cached_within_ttl():
    payload = {"status": "ahead", "ahead_by": 2, "commits": [{"sha": "aabbccdd"}]}
    get_patch, client = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        await uc.get_update_status()
        await uc.get_update_status()
    client.get.assert_awaited_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_update_check.py -n0 -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.update_check'`

- [ ] **Step 3: Implement the service**

Create `app/services/update_check.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_update_check.py -n0 -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/update_check.py tests/test_update_check.py
git commit -m "feat(update-check): add cached GitHub main-compare service"
```

---

## Task 3: `/update-status` endpoint

**Files:**
- Create: `app/routers/update_status.py`
- Modify: `app/main.py:209` (router registration block)
- Test: `tests/test_update_status_api.py`

- [ ] **Step 1: Write failing endpoint test**

Create `tests/test_update_status_api.py`:

```python
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_update_status_endpoint_returns_payload():
    payload = {
        "check_enabled": True,
        "update_available": True,
        "current_commit": "dc11fbe0",
        "latest_commit": "a1b2c3d4",
        "commits_behind": 7,
        "compare_url": "https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main",
        "checked_at": 1757600000,
    }
    with patch(
        "app.routers.update_status.get_update_status",
        new=AsyncMock(return_value=payload),
    ):
        from app.main import app

        client = TestClient(app)
        response = client.get("/api/update-status")

    assert response.status_code == 200
    data = response.json()
    assert data["update_available"] is True
    assert data["commits_behind"] == 7
    assert data["compare_url"].endswith("compare/dc11fbe0...main")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_update_status_api.py -n0 -q`
Expected: FAIL — endpoint 404 / module import error.

- [ ] **Step 3: Implement the router**

Create `app/routers/update_status.py`:

```python
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.update_check import get_update_status

router = APIRouter(tags=["update"])


class UpdateStatusResponse(BaseModel):
    check_enabled: bool
    update_available: bool
    current_commit: str | None = None
    latest_commit: str | None = None
    commits_behind: int = 0
    compare_url: str | None = None
    checked_at: int


@router.get("/update-status", response_model=UpdateStatusResponse)
async def update_status() -> UpdateStatusResponse:
    """Report whether the fork's main branch is ahead of the running commit."""
    data = await get_update_status()
    return UpdateStatusResponse(**data)
```

- [ ] **Step 4: Register the router**

In `app/main.py`, the routers are imported as one alphabetical group
`from app.routers import ( ... )` (lines 63-81). Add `update_status` between
`statistics,` and `ws,`:

```python
    statistics,
    update_status,
    ws,
)
```

Then add the registration after the `health.router` line
(`app.include_router(health.router, prefix="/api")`):

```python
app.include_router(update_status.router, prefix="/api")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_update_status_api.py -n0 -q`
Expected: PASS (1 passed)

- [ ] **Step 6: Commit**

```bash
git add app/routers/update_status.py app/main.py tests/test_update_status_api.py
git commit -m "feat(update-check): expose /api/update-status endpoint"
```

---

## Task 4: Document the opt-out env var

**Files:**
- Modify: `docker-compose.example.yml` (Security block, around line 47)

- [ ] **Step 1: Add commented env var**

In `docker-compose.example.yml`, under the `environment:` section (e.g. after the `# Security` block), add:

```yaml
      # Update check
      # The app checks GitHub once every 6h to see if the fork's main branch is
      # ahead of the running build, and shows an in-app indicator. Set to "false"
      # to disable the outbound request (air-gapped / privacy-conscious setups).
      # MESHCORE_UPDATE_CHECK_ENABLED: "false"
```

- [ ] **Step 2: Verify YAML still parses**

Run: `uv run python -c "import yaml,sys; yaml.safe_load(open('docker-compose.example.yml')); print('ok')"`
Expected: prints `ok`
(If PyYAML is unavailable, skip: the added lines are comments only.)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.example.yml
git commit -m "docs(update-check): document MESHCORE_UPDATE_CHECK_ENABLED"
```

---

## Task 5: Frontend type + API method

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts:114` (near `getHealth`)

- [ ] **Step 1: Add the type**

In `frontend/src/types.ts`, add:

```typescript
export interface UpdateStatus {
  check_enabled: boolean;
  update_available: boolean;
  current_commit: string | null;
  latest_commit: string | null;
  commits_behind: number;
  compare_url: string | null;
  checked_at: number;
}
```

- [ ] **Step 2: Add the API method**

In `frontend/src/api.ts`, add `UpdateStatus` to the type import list from `./types`, then add next to `getHealth`:

```typescript
  getUpdateStatus: () => fetchJson<UpdateStatus>('/update-status'),
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npm run build`
Expected: build succeeds (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(update-check): add UpdateStatus type and api method"
```

---

## Task 6: Shared `useUpdateStatus` hook

Session-cached so multiple consumers trigger only one request.

**Files:**
- Create: `frontend/src/hooks/useUpdateStatus.ts`
- Test: `frontend/src/test/useUpdateStatus.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/useUpdateStatus.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { useUpdateStatus, __resetUpdateStatusCache } from '../hooks/useUpdateStatus';

const sample = {
  check_enabled: true,
  update_available: true,
  current_commit: 'dc11fbe0',
  latest_commit: 'a1b2c3d4',
  commits_behind: 7,
  compare_url: 'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main',
  checked_at: 1757600000,
};

afterEach(() => {
  __resetUpdateStatusCache();
  vi.restoreAllMocks();
});

describe('useUpdateStatus', () => {
  it('fetches once and shares the result across hook instances', async () => {
    const spy = vi.spyOn(api, 'getUpdateStatus').mockResolvedValue(sample);

    const first = renderHook(() => useUpdateStatus());
    const second = renderHook(() => useUpdateStatus());

    await waitFor(() => expect(first.result.current?.update_available).toBe(true));
    await waitFor(() => expect(second.result.current?.commits_behind).toBe(7));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns null when the request fails', async () => {
    vi.spyOn(api, 'getUpdateStatus').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toBeNull());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/useUpdateStatus.test.ts`
Expected: FAIL — cannot resolve `../hooks/useUpdateStatus`.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useUpdateStatus.ts`:

```typescript
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { UpdateStatus } from '../types';

let cached: Promise<UpdateStatus | null> | null = null;

function load(): Promise<UpdateStatus | null> {
  if (!cached) {
    cached = api.getUpdateStatus().catch(() => null);
  }
  return cached;
}

/** Test helper: clear the module-level session cache. */
export function __resetUpdateStatusCache(): void {
  cached = null;
}

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/useUpdateStatus.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useUpdateStatus.ts frontend/src/test/useUpdateStatus.test.ts
git commit -m "feat(update-check): add shared useUpdateStatus hook"
```

---

## Task 7: i18n strings (EN / NL / DE)

This codebase uses a **custom** i18n (`frontend/src/i18n/i18n.ts`): interpolation is
single-brace `{count}` (NOT `{{count}}`), and plurals are **nested objects**
`{ "one": "...", "other": "..." }` selected by `Intl.PluralRules`. Match that exact
shape (see `a11y_unread_count` / the `one`/`other` entries in `en.json`).

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/nl.json`
- Modify: `frontend/src/i18n/locales/de.json`

- [ ] **Step 1: Add keys to en.json**

In `frontend/src/i18n/locales/en.json`, add next to the `settings_about_*` keys:

```json
  "settings_about_update_available": "Update available",
  "settings_about_update_commits_behind": {
    "one": "{count} commit behind",
    "other": "{count} commits behind"
  },
  "settings_about_update_view_changes": "View changes",
  "a11y_update_available": "An update is available",
```

- [ ] **Step 2: Add the same keys to nl.json**

In `frontend/src/i18n/locales/nl.json`, add:

```json
  "settings_about_update_available": "Update beschikbaar",
  "settings_about_update_commits_behind": {
    "one": "{count} commit achter",
    "other": "{count} commits achter"
  },
  "settings_about_update_view_changes": "Wijzigingen bekijken",
  "a11y_update_available": "Er is een update beschikbaar",
```

- [ ] **Step 3: Add the same keys to de.json**

In `frontend/src/i18n/locales/de.json`, add:

```json
  "settings_about_update_available": "Update verfügbar",
  "settings_about_update_commits_behind": {
    "one": "{count} Commit zurück",
    "other": "{count} Commits zurück"
  },
  "settings_about_update_view_changes": "Änderungen ansehen",
  "a11y_update_available": "Ein Update ist verfügbar",
```

- [ ] **Step 4: Run i18n parity test**

Run: `cd frontend && npx vitest run src/test/i18nParity.test.ts`
Expected: PASS (all three locales have identical key sets).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(update-check): add i18n strings for update indicator"
```

---

## Task 8: About-section indicator + button

**Files:**
- Modify: `frontend/src/components/settings/SettingsAboutSection.tsx`
- Test: `frontend/src/test/settingsAboutSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace the contents of `frontend/src/test/settingsAboutSection.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsAboutSection } from '../components/settings/SettingsAboutSection';

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

const health = {
  status: 'ok',
  radio_connected: true,
  radio_initializing: false,
  connection_info: 'Serial: /dev/ttyUSB0',
  app_info: { version: '3.2.0-test', commit_hash: 'deadbeef' },
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  bots_disabled: false,
} as const;

describe('SettingsAboutSection', () => {
  beforeEach(() => {
    useUpdateStatusMock.mockReset();
  });

  it('renders the debug support snapshot link', () => {
    useUpdateStatusMock.mockReturnValue(null);
    render(<SettingsAboutSection health={health} />);
    const link = screen.getByRole('link', { name: /Open debug support snapshot/i });
    expect(link).toHaveAttribute('href', './api/debug');
  });

  it('shows the update indicator with a button to the compare url', () => {
    useUpdateStatusMock.mockReturnValue({
      check_enabled: true,
      update_available: true,
      current_commit: 'dc11fbe0',
      latest_commit: 'a1b2c3d4',
      commits_behind: 7,
      compare_url: 'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main',
      checked_at: 1757600000,
    });
    render(<SettingsAboutSection health={health} />);
    expect(screen.getByText(/Update available/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View changes/i });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main'
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders no update indicator when up to date', () => {
    useUpdateStatusMock.mockReturnValue({
      check_enabled: true,
      update_available: false,
      current_commit: 'dc11fbe0',
      latest_commit: null,
      commits_behind: 0,
      compare_url: null,
      checked_at: 1757600000,
    });
    render(<SettingsAboutSection health={health} />);
    expect(screen.queryByText(/Update available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View changes/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/test/settingsAboutSection.test.tsx`
Expected: FAIL — "Update available" / "View changes" not found.

- [ ] **Step 3: Implement the indicator**

In `frontend/src/components/settings/SettingsAboutSection.tsx`:

Add imports at the top:

```typescript
import { useUpdateStatus } from '../../hooks/useUpdateStatus';
```

Inside the component body, after `const commit = health?.app_info?.commit_hash;`, add:

```typescript
  const updateStatus = useUpdateStatus();
  const showUpdate = updateStatus?.update_available && updateStatus.compare_url;
```

Then, immediately after the closing `</div>` of the version block (the block ending right before the first `<Separator />`), insert:

```tsx
        {showUpdate ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <span className="font-medium text-primary">
              {t('settings_about_update_available')}
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {t('settings_about_update_commits_behind', {
                  count: updateStatus!.commits_behind,
                })}
              </span>
            </span>
            <a
              href={updateStatus!.compare_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('settings_about_update_view_changes')}
            </a>
          </div>
        ) : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/test/settingsAboutSection.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 5: Lint (i18n rule) and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no i18next `no-literal-string` errors on the new block; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/SettingsAboutSection.tsx frontend/src/test/settingsAboutSection.test.tsx
git commit -m "feat(update-check): show update indicator and button in About"
```

---

## Task 9: StatusBar settings-button dot

**Files:**
- Modify: `frontend/src/components/StatusBar.tsx:280-290` (the settings `<button>`)
- Test: `frontend/src/test/statusBarUpdateDot.test.tsx` (new)

- [ ] **Step 1: Write failing test**

Create `frontend/src/test/statusBarUpdateDot.test.tsx`. `StatusBarProps` is
`{ health: HealthStatus | null; config: RadioConfig | null; settingsMode?: boolean;
onSettingsClick: () => void; onMenuClick?: () => void }`, so the props below are
complete. `useT()` returns English synchronously in tests (same as the existing
`settingsAboutSection.test.tsx`), so no provider wrapper is needed.

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

import { StatusBar } from '../components/StatusBar';

const baseProps = {
  health: null,
  config: null,
  settingsMode: false,
  onSettingsClick: () => {},
};

describe('StatusBar update dot', () => {
  beforeEach(() => useUpdateStatusMock.mockReset());

  it('shows the update dot when an update is available', () => {
    useUpdateStatusMock.mockReturnValue({ update_available: true });
    render(<StatusBar {...baseProps} />);
    expect(screen.getByLabelText(/update is available/i)).toBeInTheDocument();
  });

  it('hides the update dot when up to date', () => {
    useUpdateStatusMock.mockReturnValue({ update_available: false });
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByLabelText(/update is available/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/statusBarUpdateDot.test.tsx`
Expected: FAIL — no element labelled "update is available".

- [ ] **Step 3: Implement the dot**

In `frontend/src/components/StatusBar.tsx`:

Add the import near the other imports:

```typescript
import { useUpdateStatus } from '../hooks/useUpdateStatus';
```

Inside the component, near the top with the other hooks, add:

```typescript
  const updateStatus = useUpdateStatus();
```

Change the settings `<button>` (currently at lines 280-290) to add `relative` to its `className` and insert the dot as a child before the closing `</button>`:

```tsx
      <button
        onClick={onSettingsClick}
        className={cn(
          'relative px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          settingsMode
            ? 'bg-status-connected/15 border border-status-connected/30 text-status-connected hover:bg-status-connected/25'
            : 'bg-secondary border border-border text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        {settingsMode ? t('nav_back_to_chat') : t('nav_settings_heading')}
        {updateStatus?.update_available ? (
          <span
            aria-label={t('a11y_update_available')}
            className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary"
          />
        ) : null}
      </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/statusBarUpdateDot.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 5: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no lint errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StatusBar.tsx frontend/src/test/statusBarUpdateDot.test.tsx
git commit -m "feat(update-check): show update dot on StatusBar settings button"
```

---

## Task 10: Full verification

- [ ] **Step 1: Backend tests**

Run: `uv run pytest tests/test_update_check.py tests/test_update_status_api.py tests/test_version_info.py -n0 -q`
Expected: PASS (all).

- [ ] **Step 2: Frontend targeted tests**

Run: `cd frontend && npx vitest run src/test/useUpdateStatus.test.ts src/test/settingsAboutSection.test.tsx src/test/statusBarUpdateDot.test.tsx src/test/i18nParity.test.ts`
Expected: PASS (all).

- [ ] **Step 3: Frontend build + lint**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual runtime check (required — compiling is not proof)**

Start the app (or rebuild the local Docker container per project docs), open Settings -> About, and confirm:
- With a build behind `main`: the "Update available - N commits behind" block and "View changes" button appear, and the button opens the correct GitHub compare URL.
- The dot appears on the StatusBar settings button.
- Confirm the outbound call happens at most once (check `GET /api/update-status` in the network tab / server logs).

Record the observed result. If the running build's commit equals `main`, temporarily point `REPO`/`BRANCH` or use a known-behind commit to observe the positive case, then revert.

---

## Notes on the plan vs. spec

- Comparison basis is `compare/<local>...main`; `ahead_by` maps to `commits_behind`. (Spec: Backend step 5.)
- `update_check_enabled` default `true`, opt-out via env. (Spec: Config.)
- Graceful degradation for `commit_hash is None`, 404, diverged, and network errors — all return `update_available: false`. (Spec: Backend degradation.)
- Primary About indicator + real button, secondary StatusBar dot, i18n EN/NL/DE. (Spec: Frontend.)
