# Chat Entity Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PROJECT GIT RULES (override the skill's commit rhythm):** This repo's CLAUDE.md says *never commit unless explicitly instructed*. The `Commit` step in each task is written out so the diff is staged and a message is ready, but the executor MUST get the user's explicit go-ahead before actually running `git commit`. Do not add AI attribution/co-author lines (a PreToolUse hook enforces this). Never push/PR without explicit instruction.

**Goal:** Parse public keys, GPS coordinates, and URLs in chat messages into rich, actionable UI (contact/analyzer lookup, map preview cards, clickable links, and messenger-style link previews), each gated by a server-side setting.

**Architecture:** A single pure `tokenizeMessageText` tokenizer replaces the nested text scanners in `MessageList`; new pure finders detect pubkeys and coordinates. A new SSRF-guarded backend `GET /api/unfurl` endpoint supplies OpenGraph metadata for link previews. Four boolean columns are added to `app_settings` and threaded to the chat via existing prop patterns.

**Tech Stack:** Backend FastAPI + aiosqlite + httpx + stdlib `html.parser`/`ipaddress`/`socket`; frontend React + TypeScript + vitest; i18n EN/NL/DE.

---

## File Structure

**Backend (create):**
- `app/migrations/_082_add_chat_entity_settings.py` — four boolean columns.
- `app/services/url_safety.py` — SSRF guard (scheme + resolved-IP validation).
- `app/services/unfurl.py` — HTML metadata parse + guarded fetch + TTL cache.
- `app/routers/unfurl.py` — `GET /api/unfurl` endpoint.
- `tests/test_url_safety.py`, `tests/test_unfurl_service.py`, `tests/test_unfurl_router.py`.

**Backend (modify):**
- `app/models.py` — add four fields to `AppSettings`.
- `app/repository/settings.py` — SELECT, parse, `_apply_updates`, `update()`.
- `app/routers/settings.py` — `AppSettingsUpdate` fields + mapping.
- `app/main.py` (or wherever routers are registered) — include the unfurl router.
- `tests/test_settings_router.py` — round-trip the four settings.

**Frontend (create):**
- `frontend/src/utils/chatEntities.ts` — `findPubkeys`, `findCoordinates`, `tokenizeMessageText`, `ChatToken`.
- `frontend/src/components/UrlPreviewCard.tsx` — lazy link preview.
- `frontend/src/test/chatEntities.test.ts`, `frontend/src/test/urlPreviewCard.test.tsx`.

**Frontend (modify):**
- `frontend/src/components/MessageList.tsx` — use tokenizer + `renderTokens`; new pubkey/coordinate renderers; accept new props.
- `frontend/src/components/ConversationPane.tsx` — thread new props.
- `frontend/src/App.tsx` — derive new props from `appSettings`.
- `frontend/src/types.ts` — `AppSettings` + `AppSettingsUpdate` fields.
- `frontend/src/api.ts` — `unfurl(url)` method.
- `frontend/src/components/settings/*` — new "Chat" settings toggles.
- `frontend/src/i18n/locales/{en,nl,de}.json` — new keys.

---

## Test commands (project conventions)

- **Backend** (run in the live container; the worktree is bind-mounted at `/work`, venv at `/app/.venv`; avoids the ~14 pre-existing Windows-only failures):

```bash
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_url_safety.py -v
```

- **Frontend** (vitest, path-filtered):

```bash
npm --prefix frontend run test:run -- src/test/chatEntities.test.ts
```

- **Frontend gates before any push:**

```bash
npm --prefix frontend run lint && npm --prefix frontend run format:check
```

---

## Task 1: Backend settings columns (migration + model + repository + router)

**Files:**
- Create: `app/migrations/_082_add_chat_entity_settings.py`
- Modify: `app/models.py:1100` (AppSettings), `app/repository/settings.py` (SELECT ~44, parse ~195, `_apply_updates` ~271, `update()` ~421), `app/routers/settings.py:36` (AppSettingsUpdate) and mapping (~345)
- Test: `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing round-trip tests**

Append to `tests/test_settings_router.py` inside `class TestUpdateSettings`:

```python
    @pytest.mark.asyncio
    async def test_chat_entity_settings_defaults(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.chat_parse_pubkeys is False
        assert result.chat_parse_coordinates is False
        assert result.chat_url_previews is False
        assert result.chat_linkify_urls is True

    @pytest.mark.asyncio
    async def test_chat_entity_settings_round_trip(self, test_db):
        await update_settings(
            AppSettingsUpdate(
                chat_parse_pubkeys=True,
                chat_parse_coordinates=True,
                chat_url_previews=True,
                chat_linkify_urls=False,
            )
        )
        fresh = await AppSettingsRepository.get()
        assert fresh.chat_parse_pubkeys is True
        assert fresh.chat_parse_coordinates is True
        assert fresh.chat_url_previews is True
        assert fresh.chat_linkify_urls is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py::TestUpdateSettings::test_chat_entity_settings_defaults -v`
Expected: FAIL (`AppSettingsUpdate` has no `chat_parse_pubkeys`, or `AppSettings` has no attribute).

- [ ] **Step 3: Create the migration**

`app/migrations/_082_add_chat_entity_settings.py`:

```python
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add chat entity-parsing settings to ``app_settings``.

    - chat_parse_pubkeys (default off): parse 64-hex public keys in chat.
    - chat_parse_coordinates (default off): parse GPS coordinates into cards.
    - chat_url_previews (default off): fetch OpenGraph previews for URLs.
    - chat_linkify_urls (default on): render URLs as clickable links.

    Idempotent: each column is added only if absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}

    additions = [
        ("chat_parse_pubkeys", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_parse_coordinates", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_url_previews", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_linkify_urls", "INTEGER NOT NULL DEFAULT 1"),
    ]
    for name, decl in additions:
        if name not in settings_columns:
            await conn.execute(f"ALTER TABLE app_settings ADD COLUMN {name} {decl}")

    await conn.commit()
```

- [ ] **Step 4: Add fields to `app/models.py` `AppSettings`**

Insert after `auto_add_mentioned_channels` (or anywhere in the class, before the closing of `AppSettings`):

```python
    chat_parse_pubkeys: bool = Field(
        default=False,
        description="Parse 64-hex public keys in chat into contact/analyzer lookups",
    )
    chat_parse_coordinates: bool = Field(
        default=False,
        description="Parse GPS coordinates in chat text into location cards",
    )
    chat_url_previews: bool = Field(
        default=False,
        description="Fetch OpenGraph link previews for URLs in chat (server-side fetch)",
    )
    chat_linkify_urls: bool = Field(
        default=True,
        description="Render URLs in chat as clickable links",
    )
```

- [ ] **Step 5: Wire the repository** (`app/repository/settings.py`)

Add the four columns to the SELECT list in `_get_in_conn` (after `auto_add_mentioned_channels,`):

```python
                   chat_parse_pubkeys, chat_parse_coordinates,
                   chat_url_previews, chat_linkify_urls,
```

Add parsing before the final `return AppSettings(` (mirroring `auto_add_mentioned_channels`):

```python
        try:
            chat_parse_pubkeys = bool(row["chat_parse_pubkeys"])
        except (KeyError, TypeError):
            chat_parse_pubkeys = False
        try:
            chat_parse_coordinates = bool(row["chat_parse_coordinates"])
        except (KeyError, TypeError):
            chat_parse_coordinates = False
        try:
            chat_url_previews = bool(row["chat_url_previews"])
        except (KeyError, TypeError):
            chat_url_previews = False
        try:
            chat_linkify_urls = bool(row["chat_linkify_urls"])
        except (KeyError, TypeError):
            chat_linkify_urls = True
```

Add to the `AppSettings(...)` constructor call:

```python
            chat_parse_pubkeys=chat_parse_pubkeys,
            chat_parse_coordinates=chat_parse_coordinates,
            chat_url_previews=chat_url_previews,
            chat_linkify_urls=chat_linkify_urls,
```

Add to `_apply_updates` signature (keyword args, all `bool | None = None`) and body:

```python
        chat_parse_pubkeys: bool | None = None,
        chat_parse_coordinates: bool | None = None,
        chat_url_previews: bool | None = None,
        chat_linkify_urls: bool | None = None,
```

```python
        if chat_parse_pubkeys is not None:
            updates.append("chat_parse_pubkeys = ?")
            params.append(1 if chat_parse_pubkeys else 0)
        if chat_parse_coordinates is not None:
            updates.append("chat_parse_coordinates = ?")
            params.append(1 if chat_parse_coordinates else 0)
        if chat_url_previews is not None:
            updates.append("chat_url_previews = ?")
            params.append(1 if chat_url_previews else 0)
        if chat_linkify_urls is not None:
            updates.append("chat_linkify_urls = ?")
            params.append(1 if chat_linkify_urls else 0)
```

Add the same four keyword params to the public `update(...)` signature and forward them in its `_apply_updates(conn, ...)` call.

- [ ] **Step 6: Wire the router** (`app/routers/settings.py`)

Add to `AppSettingsUpdate`:

```python
    chat_parse_pubkeys: bool | None = Field(default=None, description="Parse 64-hex pubkeys in chat")
    chat_parse_coordinates: bool | None = Field(
        default=None, description="Parse GPS coordinates in chat"
    )
    chat_url_previews: bool | None = Field(default=None, description="Fetch link previews in chat")
    chat_linkify_urls: bool | None = Field(
        default=None, description="Render URLs as clickable links"
    )
```

Add to the mapping block in `update_settings`:

```python
    if update.chat_parse_pubkeys is not None:
        kwargs["chat_parse_pubkeys"] = update.chat_parse_pubkeys
    if update.chat_parse_coordinates is not None:
        kwargs["chat_parse_coordinates"] = update.chat_parse_coordinates
    if update.chat_url_previews is not None:
        kwargs["chat_url_previews"] = update.chat_url_previews
    if update.chat_linkify_urls is not None:
        kwargs["chat_linkify_urls"] = update.chat_linkify_urls
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py -v`
Expected: PASS (new tests + existing settings tests).

- [ ] **Step 8: Commit** (await user go-ahead per Git Rules)

```bash
git add app/migrations/_082_add_chat_entity_settings.py app/models.py app/repository/settings.py app/routers/settings.py tests/test_settings_router.py
git commit -m "feat(settings): add chat entity-parsing toggles (pubkeys, coordinates, url previews, linkify)"
```

---

## Task 2: SSRF guard util

**Files:**
- Create: `app/services/url_safety.py`
- Test: `tests/test_url_safety.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_url_safety.py`:

```python
import pytest

from app.services.url_safety import UnsafeUrlError, assert_public_http_url


def test_rejects_non_http_scheme():
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("ftp://example.com/x")
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("file:///etc/passwd")


def test_rejects_missing_host():
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("http:///nohost")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://localhost/x",
        "http://169.254.169.254/latest/meta-data",  # link-local (cloud metadata)
        "http://10.0.0.5/x",
        "http://192.168.1.1/x",
        "http://[::1]/x",
    ],
)
def test_rejects_private_and_loopback(url, monkeypatch):
    # Force localhost to resolve to loopback deterministically.
    import socket

    def fake_getaddrinfo(host, *args, **kwargs):
        mapping = {
            "localhost": "127.0.0.1",
            "127.0.0.1": "127.0.0.1",
            "169.254.169.254": "169.254.169.254",
            "10.0.0.5": "10.0.0.5",
            "192.168.1.1": "192.168.1.1",
            "::1": "::1",
        }
        ip = mapping.get(host, host)
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 0, "", (ip, 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url(url)


def test_allows_public_host(monkeypatch):
    import socket

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))],
    )
    # Should not raise.
    assert_public_http_url("https://example.com/page")
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_url_safety.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/services/url_safety.py`**

```python
"""Guards outbound fetches of untrusted URLs against SSRF.

Chat messages can contain arbitrary URLs. Before the server fetches one (for a
link preview), we require an http(s) URL whose host resolves only to public IP
addresses, blocking loopback, private, link-local, and reserved ranges (which
includes cloud metadata endpoints such as 169.254.169.254).
"""

import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeUrlError(ValueError):
    """Raised when a URL is not a safe, public http(s) target."""


def _ip_is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def assert_public_http_url(url: str) -> str:
    """Return the URL if it is a safe public http(s) target, else raise.

    Resolves the host and requires every resolved address to be public.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"scheme not allowed: {parts.scheme!r}")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("URL has no host")

    # A literal IP host is checked directly; a name is resolved.
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"host does not resolve: {host}") from exc

    resolved = {info[4][0] for info in infos}
    if not resolved:
        raise UnsafeUrlError(f"host does not resolve: {host}")
    for ip in resolved:
        if not _ip_is_public(ip):
            raise UnsafeUrlError(f"host resolves to non-public address: {ip}")
    return url
```

- [ ] **Step 4: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_url_safety.py -v`
Expected: PASS.

- [ ] **Step 5: Commit** (await go-ahead)

```bash
git add app/services/url_safety.py tests/test_url_safety.py
git commit -m "feat(unfurl): add SSRF guard for outbound URL fetches"
```

---

## Task 3: Unfurl HTML metadata parser

**Files:**
- Create: `app/services/unfurl.py` (parser first; fetch added in Task 4)
- Test: `tests/test_unfurl_service.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_unfurl_service.py`:

```python
from app.services.unfurl import LinkPreview, parse_link_preview


def test_parses_opengraph():
    html = """
    <html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Desc">
      <meta property="og:image" content="https://cdn.example.com/i.png">
      <meta property="og:site_name" content="Example">
      <title>Fallback Title</title>
    </head><body>x</body></html>
    """
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "OG Title"
    assert preview.description == "OG Desc"
    assert preview.image == "https://cdn.example.com/i.png"
    assert preview.site_name == "Example"


def test_falls_back_to_title_tag():
    html = "<html><head><title>Just A Title</title></head><body>x</body></html>"
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "Just A Title"
    assert preview.description is None
    assert preview.image is None


def test_twitter_card_fallback():
    html = """
    <html><head>
      <meta name="twitter:title" content="Tw Title">
      <meta name="twitter:image" content="https://cdn.example.com/t.png">
    </head><body>x</body></html>
    """
    preview = parse_link_preview(html, "https://example.com/p")
    assert preview.title == "Tw Title"
    assert preview.image == "https://cdn.example.com/t.png"


def test_empty_when_no_metadata():
    preview = parse_link_preview("<html><body>nothing</body></html>", "https://example.com/p")
    assert preview.title is None
    assert preview.is_empty()
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_unfurl_service.py -v`
Expected: FAIL (module/functions not defined).

- [ ] **Step 3: Implement the parser in `app/services/unfurl.py`**

```python
"""Server-side link unfurl: fetch a URL and extract OpenGraph-style metadata.

Only used for chat link previews, gated by the ``chat_url_previews`` setting.
All outbound fetches go through ``url_safety.assert_public_http_url`` and are
size/time capped. HTML parsing uses the stdlib ``html.parser`` (no new dep).
"""

from dataclasses import dataclass
from html.parser import HTMLParser


@dataclass
class LinkPreview:
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None

    def is_empty(self) -> bool:
        return not (self.title or self.description or self.image)


class _MetaExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        key = a.get("property") or a.get("name")
        content = a.get("content")
        if key and content and key.lower() not in self.meta:
            self.meta[key.lower()] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)

    @property
    def title_tag(self) -> str | None:
        text = "".join(self._title_parts).strip()
        return text or None


def parse_link_preview(html: str, url: str) -> LinkPreview:
    p = _MetaExtractor()
    p.feed(html)
    m = p.meta

    def pick(*keys: str) -> str | None:
        for k in keys:
            if m.get(k):
                return m[k].strip()
        return None

    return LinkPreview(
        url=url,
        title=pick("og:title", "twitter:title") or p.title_tag,
        description=pick("og:description", "twitter:description", "description"),
        image=pick("og:image", "twitter:image", "twitter:image:src"),
        site_name=pick("og:site_name"),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_unfurl_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit** (await go-ahead)

```bash
git add app/services/unfurl.py tests/test_unfurl_service.py
git commit -m "feat(unfurl): parse OpenGraph/twitter/title metadata from HTML"
```

---

## Task 4: Unfurl fetch + cache + router endpoint

**Files:**
- Modify: `app/services/unfurl.py` (add `fetch_link_preview`)
- Create: `app/routers/unfurl.py`
- Modify: router registration (find where other routers are `include_router`ed, e.g. `app/main.py`)
- Test: `tests/test_unfurl_router.py`

- [ ] **Step 1: Write the failing router test**

`tests/test_unfurl_router.py`:

```python
import pytest

from app.routers.unfurl import get_unfurl
from app.services.url_safety import UnsafeUrlError


@pytest.mark.asyncio
async def test_rejects_unsafe_url(monkeypatch):
    from app.routers import unfurl as unfurl_router
    from fastapi import HTTPException

    async def boom(url):
        raise UnsafeUrlError("blocked")

    monkeypatch.setattr(unfurl_router, "fetch_link_preview", boom)
    with pytest.raises(HTTPException) as exc:
        await get_unfurl(url="http://127.0.0.1/x")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_returns_preview(monkeypatch):
    from app.routers import unfurl as unfurl_router
    from app.services.unfurl import LinkPreview

    async def fake(url):
        return LinkPreview(url=url, title="T", description="D", image=None, site_name="S")

    monkeypatch.setattr(unfurl_router, "fetch_link_preview", fake)
    result = await get_unfurl(url="https://example.com/p")
    assert result.title == "T"
    assert result.site_name == "S"
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_unfurl_router.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Add `fetch_link_preview` to `app/services/unfurl.py`**

Append:

```python
import asyncio
import logging
import time

import httpx

from app.services.url_safety import UnsafeUrlError, assert_public_http_url

logger = logging.getLogger(__name__)

_FETCH_TIMEOUT = 6.0
_MAX_BYTES = 256 * 1024
_MAX_REDIRECTS = 3
_CACHE_TTL = 3600.0
_USER_AGENT = "RTFM-EV-LinkPreview/1.0 (+https://github.com/Elektr0Vodka/RTFM-EV)"

# url -> (expires_at, LinkPreview)
_cache: dict[str, tuple[float, LinkPreview]] = {}
_cache_lock = asyncio.Lock()


async def fetch_link_preview(url: str) -> LinkPreview:
    """Fetch ``url`` (SSRF-guarded, size/redirect capped) and extract a preview.

    Raises ``UnsafeUrlError`` for disallowed targets. Returns an empty preview
    when the content is not HTML or carries no usable metadata.
    """
    now = time.monotonic()
    async with _cache_lock:
        hit = _cache.get(url)
        if hit and hit[0] > now:
            return hit[1]

    current = url
    async with httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT, follow_redirects=False
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            assert_public_http_url(current)
            resp = await client.get(
                current, headers={"User-Agent": _USER_AGENT, "Accept": "text/html"}
            )
            if resp.is_redirect and resp.headers.get("location"):
                current = str(resp.next_request.url) if resp.next_request else ""
                if not current:
                    raise UnsafeUrlError("redirect without location")
                continue
            content_type = resp.headers.get("content-type", "")
            if "html" not in content_type.lower():
                preview = LinkPreview(url=url)
                break
            body = resp.content[:_MAX_BYTES]
            preview = parse_link_preview(body.decode(resp.encoding or "utf-8", "replace"), url)
            break
        else:
            raise UnsafeUrlError("too many redirects")

    async with _cache_lock:
        _cache[url] = (time.monotonic() + _CACHE_TTL, preview)
    return preview
```

- [ ] **Step 4: Create `app/routers/unfurl.py`**

```python
"""Chat link-preview (unfurl) endpoint."""

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.unfurl import LinkPreview, fetch_link_preview
from app.services.url_safety import UnsafeUrlError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/unfurl", tags=["unfurl"])


class UnfurlResponse(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None


@router.get("", response_model=UnfurlResponse)
async def get_unfurl(url: str = Query(..., max_length=2048)) -> UnfurlResponse:
    try:
        preview: LinkPreview = await fetch_link_preview(url)
    except UnsafeUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - previews are best-effort
        logger.info("unfurl failed for %s: %s", url, exc)
        raise HTTPException(status_code=502, detail="preview unavailable") from exc
    return UnfurlResponse(
        url=preview.url,
        title=preview.title,
        description=preview.description,
        image=preview.image,
        site_name=preview.site_name,
    )
```

- [ ] **Step 5: Register the router**

Find the existing `include_router` calls (grep: `grep -rn "include_router" app`) and add, alongside the others:

```python
from app.routers import unfurl as unfurl_router
app.include_router(unfurl_router.router, prefix="/api")
```

Match the exact prefix/style used by neighboring routers (e.g. `settings`, `external_map`) so the path is `/api/unfurl`.

- [ ] **Step 6: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_unfurl_router.py -v`
Expected: PASS.

- [ ] **Step 7: Commit** (await go-ahead)

```bash
git add app/services/unfurl.py app/routers/unfurl.py tests/test_unfurl_router.py
git commit -m "feat(unfurl): add GET /api/unfurl endpoint with guarded fetch + cache"
```

---

## Task 5: Frontend entity finders (`findPubkeys`, `findCoordinates`)

**Files:**
- Create: `frontend/src/utils/chatEntities.ts`
- Test: `frontend/src/test/chatEntities.test.ts`

- [ ] **Step 1: Write the failing tests**

`frontend/src/test/chatEntities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findPubkeys, findCoordinates } from '../utils/chatEntities';

const KEY = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

describe('findPubkeys', () => {
  it('finds a standalone 64-hex key', () => {
    const r = findPubkeys(`node ${KEY} seen`);
    expect(r).toEqual([{ value: KEY, start: 5, end: 5 + 64 }]);
  });
  it('ignores 63- and 65-hex runs', () => {
    expect(findPubkeys('a'.repeat(63))).toEqual([]);
    expect(findPubkeys('a'.repeat(65))).toEqual([]);
  });
  it('ignores hex embedded in a longer hex run', () => {
    expect(findPubkeys('0'.repeat(128))).toEqual([]);
  });
});

describe('findCoordinates', () => {
  it('finds a bare decimal pair', () => {
    const r = findCoordinates('here: 52.724169,6.997483 end');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(52.724169);
    expect(r[0].lon).toBeCloseTo(6.997483);
  });
  it('finds coords at the end of a wardriving prefix', () => {
    const r = findCoordinates('MM:8PH-GxBKXg:49.49266,-2.54089');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(49.49266);
    expect(r[0].lon).toBeCloseTo(-2.54089);
  });
  it('finds coords in a geo: URI', () => {
    const r = findCoordinates('ping geo:52.72,6.99 now');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(52.72);
  });
  it('rejects out-of-range values', () => {
    expect(findCoordinates('120.5,6.9')).toEqual([]); // lat > 90
    expect(findCoordinates('52.7,200.0')).toEqual([]); // lon > 180
  });
  it('requires decimals (ignores bare integer pairs)', () => {
    expect(findCoordinates('score 3,4 today')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/chatEntities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement finders in `frontend/src/utils/chatEntities.ts`**

```ts
// Pure detectors for chat entities. Each returns non-overlapping matches with
// absolute [start, end) offsets into the input text. Used by tokenizeMessageText.

export interface PubkeyMatch {
  value: string;
  start: number;
  end: number;
}

export interface CoordinateMatch {
  lat: number;
  lon: number;
  start: number;
  end: number;
  raw: string;
}

// Exactly 64 hex chars not adjacent to more hex (so a 128-hex blob is not two keys).
const PUBKEY_PATTERN = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

// A decimal lat,lon pair. Both numbers must have a fractional part to avoid
// matching scores/versions. Covers bare, PREFIX:lat,lon, and geo: forms, since
// each contains a decimal pair.
const COORD_PATTERN = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;

export function findPubkeys(text: string): PubkeyMatch[] {
  const out: PubkeyMatch[] = [];
  PUBKEY_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PUBKEY_PATTERN.exec(text)) !== null) {
    out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function findCoordinates(text: string): CoordinateMatch[] {
  const out: CoordinateMatch[] = [];
  COORD_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COORD_PATTERN.exec(text)) !== null) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ lat, lon, start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/chatEntities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (await go-ahead)

```bash
git add frontend/src/utils/chatEntities.ts frontend/src/test/chatEntities.test.ts
git commit -m "feat(chat): add pure pubkey/coordinate finders"
```

---

## Task 6: `tokenizeMessageText`

**Files:**
- Modify: `frontend/src/utils/chatEntities.ts`
- Test: `frontend/src/test/chatEntities.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/test/chatEntities.test.ts`:

```ts
import { tokenizeMessageText } from '../utils/chatEntities';

const OPTS = { parsePubkeys: true, parseCoordinates: true, linkifyUrls: true };
const KEY2 = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

describe('tokenizeMessageText', () => {
  it('splits text, mention, url, hashtag', () => {
    const tokens = tokenizeMessageText('hi @[Bob] see https://x.com #nl-cluster', OPTS);
    expect(tokens.map((t) => t.kind)).toEqual([
      'text', 'mention', 'text', 'url', 'text', 'hashtag',
    ]);
  });
  it('emits pubkey and coordinate tokens', () => {
    const tokens = tokenizeMessageText(`k ${KEY2} at 52.72,6.99`, OPTS);
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain('pubkey');
    expect(kinds).toContain('coordinate');
  });
  it('URL wins over a coordinate inside it (overlap priority)', () => {
    const tokens = tokenizeMessageText('https://x.com/52.7,6.9', OPTS);
    expect(tokens.map((t) => t.kind)).toEqual(['url']);
  });
  it('suppresses entity kinds when toggled off', () => {
    const tokens = tokenizeMessageText(`k ${KEY2} at 52.72,6.99 https://x.com`, {
      parsePubkeys: false,
      parseCoordinates: false,
      linkifyUrls: false,
    });
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).not.toContain('pubkey');
    expect(kinds).not.toContain('coordinate');
    expect(kinds).not.toContain('url');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/chatEntities.test.ts`
Expected: FAIL (`tokenizeMessageText` not exported).

- [ ] **Step 3: Implement the tokenizer**

Add to `frontend/src/utils/chatEntities.ts` (reuse existing `findLinkedChannelReferences` from `messageParser` and the same URL regex used today so URL/hashtag behavior is byte-identical):

```ts
import { findLinkedChannelReferences } from './messageParser';

export type ChatToken =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; name: string }
  | { kind: 'url'; value: string }
  | { kind: 'hashtag'; label: string }
  | { kind: 'pubkey'; value: string }
  | { kind: 'coordinate'; lat: number; lon: number; raw: string };

export interface TokenizeOptions {
  parsePubkeys: boolean;
  parseCoordinates: boolean;
  linkifyUrls: boolean;
}

// Same URL pattern MessageList uses today (kept in sync).
const URL_PATTERN =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const MENTION_PATTERN = /@\[([^\]]+)\]/g;

interface RawMatch {
  start: number;
  end: number;
  priority: number; // lower wins on same start
  make: () => ChatToken;
}

export function tokenizeMessageText(text: string, opts: TokenizeOptions): ChatToken[] {
  const raw: RawMatch[] = [];

  MENTION_PATTERN.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = MENTION_PATTERN.exec(text)) !== null) {
    const name = mm[1];
    raw.push({
      start: mm.index,
      end: mm.index + mm[0].length,
      priority: 0,
      make: () => ({ kind: 'mention', name }),
    });
  }

  if (opts.linkifyUrls) {
    URL_PATTERN.lastIndex = 0;
    let um: RegExpExecArray | null;
    while ((um = URL_PATTERN.exec(text)) !== null) {
      const value = um[0];
      raw.push({
        start: um.index,
        end: um.index + value.length,
        priority: 1,
        make: () => ({ kind: 'url', value }),
      });
    }
  }

  if (opts.parseCoordinates) {
    for (const c of findCoordinates(text)) {
      raw.push({
        start: c.start,
        end: c.end,
        priority: 2,
        make: () => ({ kind: 'coordinate', lat: c.lat, lon: c.lon, raw: c.raw }),
      });
    }
  }

  if (opts.parsePubkeys) {
    for (const k of findPubkeys(text)) {
      raw.push({
        start: k.start,
        end: k.end,
        priority: 3,
        make: () => ({ kind: 'pubkey', value: k.value }),
      });
    }
  }

  for (const ref of findLinkedChannelReferences(text)) {
    raw.push({
      start: ref.start,
      end: ref.end,
      priority: 4,
      make: () => ({ kind: 'hashtag', label: ref.label }),
    });
  }

  raw.sort((a, b) => a.start - b.start || a.priority - b.priority);

  const tokens: ChatToken[] = [];
  let cursor = 0;
  for (const match of raw) {
    if (match.start < cursor) continue; // overlaps an accepted match
    if (match.start > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, match.start) });
    }
    tokens.push(match.make());
    cursor = match.end;
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'text', value: text.slice(cursor) });
  }
  return tokens;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/chatEntities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (await go-ahead)

```bash
git add frontend/src/utils/chatEntities.ts frontend/src/test/chatEntities.test.ts
git commit -m "feat(chat): add tokenizeMessageText unifying chat entities"
```

---

## Task 7: Refactor `MessageList` text rendering onto the tokenizer

**Files:**
- Modify: `frontend/src/components/MessageList.tsx` (replace `renderTextWithMentions`/`linkifyText`/`renderChannelReferences` with a `renderTokens` mapper)
- Test: `frontend/src/test/messageList.test.tsx` (existing regression tests must stay green)

**Goal of this task:** identical output for mentions, URLs, and hashtags as today, now produced by `tokenizeMessageText`. New pubkey/coordinate rendering is added in Task 8; here they render as plain text (pass all three toggles as currently-effective values, i.e. `linkifyUrls: true`, others `false`) so behavior is unchanged.

- [ ] **Step 1: Run the existing MessageList tests to capture the green baseline**

Run: `npm --prefix frontend run test:run -- src/test/messageList.test.tsx`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Replace the render helpers with a token mapper**

In `MessageList.tsx`:
- Import: `import { tokenizeMessageText, type ChatToken } from '../utils/chatEntities';`
- Keep `HashtagRenderCtx` and the hashtag styling/`+`-capture logic; move the hashtag rendering into a `renderHashtag(label, key, ctx)` helper extracted from the current `renderChannelReferences` body (one `<button>`/`<span>` + optional `+`).
- Replace `renderTextWithMentions` with:

```tsx
function renderTokens(
  text: string,
  radioName: string | undefined,
  ctx: HashtagRenderCtx,
  entityOpts: { parsePubkeys: boolean; parseCoordinates: boolean; linkifyUrls: boolean }
): ReactNode {
  const tokens = tokenizeMessageText(text, entityOpts);
  return tokens.map((tok, i) => renderToken(tok, i, radioName, ctx));
}

function renderToken(
  tok: ChatToken,
  i: number,
  radioName: string | undefined,
  ctx: HashtagRenderCtx
): ReactNode {
  switch (tok.kind) {
    case 'text':
      return tok.value;
    case 'mention': {
      const isOwn = radioName ? tok.name === radioName : false;
      return (
        <span
          key={`mention-${i}`}
          className={cn('rounded px-0.5', isOwn ? 'bg-primary/30 text-primary font-medium' : 'bg-muted-foreground/20')}
        >
          @[{tok.name}]
        </span>
      );
    }
    case 'url':
      return (
        <a
          key={`url-${i}`}
          href={tok.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
        >
          {tok.value}
        </a>
      );
    case 'hashtag':
      return renderHashtag(tok.label, `hashtag-${i}`, ctx);
    case 'pubkey':
      return tok.value; // Task 8 replaces this with <PubkeyToken>
    case 'coordinate':
      return tok.raw; // Task 8 replaces this with <CoordinateToken>
    default:
      return null;
  }
}
```

- Update every caller of `renderTextWithMentions(text, radioName, ctx)` to `renderTokens(text, radioName, ctx, entityOpts)`. For this task pass a constant `entityOpts = { parsePubkeys: false, parseCoordinates: false, linkifyUrls: true }` (behavior-preserving). The real per-setting values arrive in Task 8.
- Delete the now-unused `linkifyText` and `renderChannelReferences` (their logic now lives in `tokenizeMessageText` + `renderHashtag`). Keep `URL_PATTERN` deletion in mind — it now lives in `chatEntities.ts`; remove the duplicate in `MessageList.tsx`.

- [ ] **Step 3: Run the regression tests**

Run: `npm --prefix frontend run test:run -- src/test/messageList.test.tsx`
Expected: PASS (unchanged behavior). If a test asserts on `renderChannelReferences`/`linkifyText` directly, update it to call `tokenizeMessageText`/`renderTokens`.

- [ ] **Step 4: Typecheck + lint + format**

Run: `npm --prefix frontend run lint && npm --prefix frontend run format:check`
Expected: PASS.

- [ ] **Step 5: Commit** (await go-ahead)

```bash
git add frontend/src/components/MessageList.tsx frontend/src/test/messageList.test.tsx frontend/src/utils/chatEntities.ts
git commit -m "refactor(chat): render message text via tokenizeMessageText"
```

---

## Task 8: Pubkey + coordinate token renderers, prop threading, analyzer lookup

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`, `frontend/src/components/ConversationPane.tsx`, `frontend/src/App.tsx`
- Test: `frontend/src/test/messageList.test.tsx`

- [ ] **Step 1: Write failing tests for the new renderers**

Add to `frontend/src/test/messageList.test.tsx` (follow the file's existing render/prop helpers):

```tsx
it('renders a known pubkey as a contact button', async () => {
  const KEY = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';
  const onOpenContactInfo = vi.fn();
  renderMessageList({
    messages: [makeMessage({ text: `node ${KEY}` })],
    contacts: [makeContact({ public_key: KEY, name: 'Alice' })],
    parsePubkeys: true,
    onOpenContactInfo,
  });
  await userEvent.click(screen.getByRole('button', { name: /Alice|contact/i }));
  expect(onOpenContactInfo).toHaveBeenCalledWith(KEY);
});

it('renders an unknown pubkey with an analyzer lookup link', () => {
  const KEY = 'a'.repeat(64);
  renderMessageList({
    messages: [makeMessage({ text: `node ${KEY}` })],
    contacts: [],
    parsePubkeys: true,
    analyzerSites: [{ name: 'radar', node_url_template: 'https://r.example/{pubkey}' }],
  });
  const link = screen.getByRole('link', { name: /look up|analyzer/i });
  expect(link).toHaveAttribute('href', `https://r.example/${KEY}`);
});
```

(Extend `renderMessageList`/`makeContact` helpers with the new optional props/fields if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/messageList.test.tsx`
Expected: FAIL (props/renderers not present).

- [ ] **Step 3: Add props to `MessageListProps`**

```ts
  parsePubkeys?: boolean;
  parseCoordinates?: boolean;
  linkifyUrls?: boolean;
  analyzerSites?: AnalyzerSite[];
```

Destructure with defaults in the component: `parsePubkeys = false, parseCoordinates = false, linkifyUrls = true, analyzerSites = [],`. Import `AnalyzerSite` from `../types` and `buildNodeLookupUrl` from `../utils/analyzerLink`.

- [ ] **Step 4: Implement the renderers**

Add components:

```tsx
function PubkeyToken({
  value,
  contacts,
  onOpenContactInfo,
  analyzerSites,
}: {
  value: string;
  contacts: Contact[];
  onOpenContactInfo?: (publicKey: string, fromChannel?: boolean) => void;
  analyzerSites: AnalyzerSite[];
}) {
  const t = useT();
  const known = contacts.find((c) => c.public_key.toLowerCase() === value.toLowerCase());
  const short = `${value.slice(0, 6)}…${value.slice(-6)}`;
  if (known && onOpenContactInfo) {
    return (
      <button
        type="button"
        className="rounded px-0.5 font-mono text-primary underline hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t('chat_pubkey_open_contact', { name: known.name || short })}
        onClick={() => onOpenContactInfo(value)}
      >
        {known.name || short}
      </button>
    );
  }
  const site = analyzerSites[0];
  const url = site ? buildNodeLookupUrl(site, value) : null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-muted-foreground" title={value}>{short}</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-border px-1 text-[0.625rem] leading-none text-muted-foreground hover:bg-accent"
          title={t('chat_pubkey_lookup_analyzer', { site: site.name })}
          aria-label={t('chat_pubkey_lookup_analyzer', { site: site.name })}
        >
          {t('chat_pubkey_lookup_action')}
        </a>
      )}
    </span>
  );
}
```

For coordinates, reuse the existing `MarkerMessage` card by constructing a `ParsedMarker`-shaped object (`{ lat, lon, label: '' }`) and passing `onCoordinateClick`:

```tsx
case 'coordinate':
  return (
    <MarkerMessage
      key={`coord-${i}`}
      marker={{ lat: tok.lat, lon: tok.lon, label: '' }}
      onCoordinateClick={onCoordinateClick}
    />
  );
```

Wire `renderToken`/`renderTokens` to receive `contacts`, `onOpenContactInfo`, `analyzerSites`, and `onCoordinateClick` (thread them through, or build the `renderToken` closure inside the component so it closes over these). Replace the Task-7 placeholder `pubkey`/`coordinate` cases with `<PubkeyToken .../>` and the `MarkerMessage` case. Pass the real `entityOpts = { parsePubkeys, parseCoordinates, linkifyUrls }` at every `renderTokens` call site.

Confirm `ParsedMarker` type accepts `label: ''` (it does — label is a string in `meshcoreOpenPayloads`). If `MarkerMessage` treats empty label specially, that's fine (it only renders the label line when truthy).

- [ ] **Step 5: Thread props through `ConversationPane` and `App`**

`ConversationPane.tsx`: add `parsePubkeys?`, `parseCoordinates?`, `linkifyUrls?`, `analyzerSites?` to its props interface, destructure them, and pass them to `<MessageList ... parsePubkeys={parsePubkeys} parseCoordinates={parseCoordinates} linkifyUrls={linkifyUrls} analyzerSites={analyzerSites} />`.

`App.tsx`: in the props object that currently sets `autoAddMentionedChannels: appSettings?.auto_add_mentioned_channels ?? false`, add:

```ts
    parsePubkeys: appSettings?.chat_parse_pubkeys ?? false,
    parseCoordinates: appSettings?.chat_parse_coordinates ?? false,
    linkifyUrls: appSettings?.chat_linkify_urls ?? true,
    analyzerSites: appSettings?.analyzer_sites ?? [],
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/messageList.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + format**

Run: `npm --prefix frontend run lint && npm --prefix frontend run format:check`
Expected: PASS.

- [ ] **Step 8: Commit** (await go-ahead)

```bash
git add frontend/src/components/MessageList.tsx frontend/src/components/ConversationPane.tsx frontend/src/App.tsx frontend/src/test/messageList.test.tsx
git commit -m "feat(chat): resolve pubkeys to contacts/analyzer and coordinates to map cards"
```

---

## Task 9: URL preview card + api method + gating

**Files:**
- Create: `frontend/src/components/UrlPreviewCard.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/components/MessageList.tsx`
- Test: `frontend/src/test/urlPreviewCard.test.tsx`

- [ ] **Step 1: Add the api method** (`frontend/src/api.ts`)

Near `getSettings`:

```ts
  unfurl: (url: string, signal?: AbortSignal) =>
    fetchJson<UrlPreview>(`/unfurl?url=${encodeURIComponent(url)}`, { signal }),
```

Add to `frontend/src/types.ts`:

```ts
export interface UrlPreview {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}
```

- [ ] **Step 2: Write the failing card test**

`frontend/src/test/urlPreviewCard.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UrlPreviewCard } from '../components/UrlPreviewCard';
import { api } from '../api';

vi.mock('../api', () => ({ api: { unfurl: vi.fn() } }));

describe('UrlPreviewCard', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders title and site after fetch', async () => {
    (api.unfurl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://x.com',
      title: 'Hello',
      site_name: 'X',
    });
    render(<UrlPreviewCard url="https://x.com" />);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
  });
  it('renders nothing on failure', async () => {
    (api.unfurl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const { container } = render(<UrlPreviewCard url="https://x.com" />);
    await waitFor(() => expect(api.unfurl).toHaveBeenCalled());
    expect(container.querySelector('a')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/urlPreviewCard.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 4: Implement `frontend/src/components/UrlPreviewCard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UrlPreview } from '../types';

// Lazily fetches an OpenGraph preview for a URL when mounted. Renders nothing on
// failure or when there is no usable metadata (the plain link remains in text).
export function UrlPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    api
      .unfurl(url, controller.signal)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch(() => {
        if (active) setPreview(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);

  if (loading) {
    return <span className="mt-1 block h-12 max-w-sm rounded border border-border bg-muted/30 animate-pulse" />;
  }
  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex max-w-sm gap-2 overflow-hidden rounded-md border border-border bg-background/50 p-2 no-underline hover:bg-accent"
    >
      {preview.image && (
        <img src={preview.image} alt="" loading="lazy" className="h-14 w-14 flex-shrink-0 rounded object-cover" />
      )}
      <span className="flex min-w-0 flex-col">
        {preview.site_name && (
          <span className="truncate text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            {preview.site_name}
          </span>
        )}
        {preview.title && <span className="truncate font-medium leading-tight">{preview.title}</span>}
        {preview.description && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</span>
        )}
      </span>
    </a>
  );
}
```

Add the `line-clamp` utility only if the project's Tailwind config includes it; otherwise drop `line-clamp-2` and keep `truncate`.

- [ ] **Step 5: Render the card under messages when enabled**

In `MessageList.tsx`, add a prop `showUrlPreviews?: boolean` (default false), thread it from `ConversationPane`/`App` (`appSettings?.chat_url_previews ?? false`). After a message's text is rendered, when `showUrlPreviews` is on and the tokens contain at least one `url` token, render one `<UrlPreviewCard url={firstUrl} />` below the bubble (dedupe: only the first URL per message to limit fetches). Compute the URL list from `tokenizeMessageText(text, entityOpts)` (filter `kind === 'url'`).

- [ ] **Step 6: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/urlPreviewCard.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + format**

Run: `npm --prefix frontend run lint && npm --prefix frontend run format:check`
Expected: PASS.

- [ ] **Step 8: Commit** (await go-ahead)

```bash
git add frontend/src/components/UrlPreviewCard.tsx frontend/src/api.ts frontend/src/types.ts frontend/src/components/MessageList.tsx frontend/src/components/ConversationPane.tsx frontend/src/App.tsx frontend/src/test/urlPreviewCard.test.tsx
git commit -m "feat(chat): lazy messenger-style URL preview cards"
```

---

## Task 10: Settings UI (Chat toggles) + types + i18n

**Files:**
- Modify: `frontend/src/types.ts` (`AppSettings` + `AppSettingsUpdate`), a settings section component (e.g. new group in `SettingsLocalSection.tsx` or a small `SettingsChatSection.tsx`), `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/settingsModal.test.tsx` (or a new `settingsChatSection.test.tsx`)

- [ ] **Step 1: Extend frontend types** (`frontend/src/types.ts`)

Add to `AppSettings`:

```ts
  chat_parse_pubkeys: boolean;
  chat_parse_coordinates: boolean;
  chat_url_previews: boolean;
  chat_linkify_urls: boolean;
```

Add to `AppSettingsUpdate`:

```ts
  chat_parse_pubkeys?: boolean;
  chat_parse_coordinates?: boolean;
  chat_url_previews?: boolean;
  chat_linkify_urls?: boolean;
```

- [ ] **Step 2: Add i18n keys (EN/NL/DE)**

Add to `en.json` (and translated equivalents in `nl.json`, `de.json` — parity test enforces all three):

```json
"settings_chat_group_title": "Chat parsing",
"settings_chat_linkify_label": "Clickable links",
"settings_chat_linkify_desc": "Turn URLs in messages into clickable links.",
"settings_chat_url_previews_label": "Link previews",
"settings_chat_url_previews_desc": "Show a preview for links. The server fetches the linked page to build it.",
"settings_chat_parse_pubkeys_label": "Detect public keys",
"settings_chat_parse_pubkeys_desc": "Recognise 64-character public keys and resolve them to a contact or an analyzer lookup.",
"settings_chat_parse_coordinates_label": "Detect coordinates",
"settings_chat_parse_coordinates_desc": "Turn latitude,longitude in messages into a map card.",
"chat_pubkey_open_contact": "Open contact {{name}}",
"chat_pubkey_lookup_analyzer": "Look up on {{site}}",
"chat_pubkey_lookup_action": "Look up"
```

Provide natural NL and DE translations for each (no hardcoded strings; the i18n parity test and eslint rule will fail otherwise).

- [ ] **Step 3: Write the failing settings test**

In `frontend/src/test/settingsModal.test.tsx` (mirror an existing toggle test), assert the four toggles render and that toggling `chat_url_previews` calls the save handler with `{ chat_url_previews: true }`.

- [ ] **Step 4: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/settingsModal.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Add the toggle rows**

Add a "Chat parsing" group of four checkbox rows (mirror the `location-map-preview` row markup in `SettingsLocalSection.tsx:519-536`). Each `Checkbox` `checked={appSettings.chat_*}` and `onCheckedChange` calls the existing `handleSaveAppSettings({ chat_*: v })` path used by other server-side toggles. Confirm the section receives `appSettings` + the save handler (follow how `auto_add_mentioned_channels` is surfaced in settings, if it is; otherwise place the group in the section that already has `appSettings`).

- [ ] **Step 6: Run to verify it passes + i18n parity**

Run: `npm --prefix frontend run test:run -- src/test/settingsModal.test.tsx`
Then the full suite to catch the i18n parity test:
Run: `npm --prefix frontend run test:run`
Expected: PASS.

- [ ] **Step 7: Lint + format**

Run: `npm --prefix frontend run lint && npm --prefix frontend run format:check`
Expected: PASS.

- [ ] **Step 8: Commit** (await go-ahead)

```bash
git add frontend/src/types.ts frontend/src/components/settings/ frontend/src/i18n/locales/ frontend/src/test/settingsModal.test.tsx
git commit -m "feat(settings): add Chat parsing toggles UI (pubkeys, coordinates, previews, linkify)"
```

---

## Task 11: Docs + full verification

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`, `README.md` (and `README_ADVANCED.md` if it documents settings), relevant `AGENTS.md`

- [ ] **Step 1: Changelog entry** — add to `CHANGELOG-DMC-EV.md` following the existing grouped format:

```markdown
### Added
- Chat: optional parsing of public keys (resolve to contact or external analyzer),
  GPS coordinates (map card), and messenger-style URL previews; plus a toggle for
  clickable links. New server-side settings: `chat_parse_pubkeys`,
  `chat_parse_coordinates`, `chat_url_previews`, `chat_linkify_urls`. New
  SSRF-guarded `GET /api/unfurl` endpoint. (migration _082)
```

- [ ] **Step 2: README** — add the four toggles to the features/settings list; note that link previews cause the server to fetch linked pages and are off by default.

- [ ] **Step 3: AGENTS.md** — note the `/api/unfurl` endpoint + `url_safety`/`unfurl` services and the four new settings fields where architecture/settings are documented (`app/AGENTS.md`, `frontend/AGENTS.md`).

- [ ] **Step 4: Full backend suite in container**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests -v`
Expected: PASS for the new tests and no new failures (the ~14 pre-existing Windows-only failures do not apply in-container).

- [ ] **Step 5: Full frontend suite + gates**

Run: `npm --prefix frontend run test:run && npm --prefix frontend run lint && npm --prefix frontend run format:check`
Expected: PASS.

- [ ] **Step 6: Runtime verification (required — see CLAUDE.md "Never claim it works without proof")**

Rebuild/point the local `rtfm-ev-local` container at this branch, then in the browser:
1. Enable all four Chat toggles in Settings; confirm they persist across a reload (server-side).
2. Post/observe a message containing a known contact's 64-hex key (renders as a contact button that opens contact info), an unknown key (renders analyzer "Look up" link with the correct URL), a `52.72,6.99` coordinate (renders a map card; mini-map appears only if the browser-local location-preview pref is on), and a public URL (clickable; a preview card appears).
3. Toggle each setting off and confirm the corresponding parsing stops.
4. Capture at least two observations (screenshots or DOM/network evidence) per CLAUDE.md.

- [ ] **Step 7: Commit docs** (await go-ahead)

```bash
git add CHANGELOG-DMC-EV.md README.md README_ADVANCED.md app/AGENTS.md frontend/AGENTS.md
git commit -m "docs: document chat entity parsing and /api/unfurl"
```

---

## Self-Review notes

- **Spec coverage:** pubkey parse (T5,T6,T8) ✓; GPS parse three forms (T5 tests bare/prefix/geo, T8 renders) ✓; clickable-URL toggle (T6 `linkifyUrls`, T8/T10 wiring) ✓; URL previews + SSRF-guarded backend (T2,T3,T4,T9) ✓; server-side settings (T1,T10) ✓; coordinate-flag-vs-preview-pref (T8 reuses `MarkerMessage`, mini-map still gated by existing pref) ✓; analyzer uses first configured site (T8) ✓; overlap priority mention>url>coordinate>pubkey>hashtag (T6) ✓; docs (T11) ✓.
- **Naming consistency:** settings keys `chat_parse_pubkeys` / `chat_parse_coordinates` / `chat_url_previews` / `chat_linkify_urls` used identically across migration, model, repository, router, types, and `App.tsx`. Frontend props `parsePubkeys`/`parseCoordinates`/`linkifyUrls`/`showUrlPreviews`/`analyzerSites`. Service fns `assert_public_http_url`, `parse_link_preview`, `fetch_link_preview`; component `UrlPreviewCard`; util fns `findPubkeys`/`findCoordinates`/`tokenizeMessageText`.
- **Known integration points to verify during execution (not placeholders, but confirm against the live tree):** exact router-registration file/prefix for `/api/unfurl` (Task 4 Step 5); which settings component holds `appSettings` + save handler (Task 10 Step 5); presence of `line-clamp` in Tailwind config (Task 9 Step 4).
