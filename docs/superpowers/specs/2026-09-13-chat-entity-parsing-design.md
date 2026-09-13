# Design: Chat entity parsing (pubkeys, GPS, URLs, link previews)

Date: 2026-09-13
Status: Approved (brainstorming)

## Overview

Four chat-message enhancements, each gated by a server-side setting (synced
across devices), built on a single refactored text tokenizer:

1. **Public-key parsing** — 64-hex tokens resolve against loaded contacts
   (open contact info) or, if unknown, show an external-analyzer lookup button.
2. **GPS parsing** — bare `lat,lon`, `PREFIX:lat,lon`, and `geo:lat,lon` become
   location cards (reusing the existing marker card and optional mini-map).
3. **Clickable URLs** — gate the already-existing auto-linking behavior on a
   setting (default on, preserving current behavior).
4. **URL rich previews** — a new SSRF-guarded backend unfurl endpoint feeds
   messenger-style preview cards, fetched lazily.

## Decisions locked during brainstorming

- GPS forms to parse: bare decimal pair, `PREFIX:lat,lon` wardriving form, and
  `geo:` URI.
- Pubkey match: full 64-hex only (aligns with `buildNodeLookupUrl`, which needs
  a full key; fewer false positives).
- Scope: all four features in one spec.
- Settings storage: server-side `AppSettings` (synced across devices).
- Text render approach: unified tokenizer (refactor the nested scanners).
- Coordinate flag vs. existing preview pref: the new server flag turns coords
  into a location card; the existing browser-local location-preview pref decides
  whether that card (and MeshCore marker cards) render the mini-map. One preview
  behavior, reused.
- Unfurl safety: strict SSRF guard + lazy fetch.

## Existing infrastructure reused

- `MessageList` already receives the full `contacts` list and an
  `onOpenContactInfo(publicKey)` callback, so pubkey "resolve against DB" is a
  synchronous client-side lookup — no new backend endpoint for resolution.
- `utils/analyzerLink.ts` (`buildNodeLookupUrl(site, pubkey)`) builds the
  external-analyzer URL from a configured `AnalyzerSite`.
- `LocationPreviewMap` + `useLocationPreview` context + the browser-local
  location-preview pref already render inline mini-maps for MeshCore markers.
- The `app_settings` single-row repository pattern
  (`repository/settings.py`, `models.py`, `routers/settings.py`) is the template
  for the four new boolean columns.
- `app/services/external_map.py` is the reference outbound-`httpx` pattern
  (timeout, async client). NOTE: it has no SSRF guard; the unfurl path must add
  one because it fetches URLs from arbitrary message text.

## Component architecture

### Frontend — new `utils/chatEntities.ts` (pure, unit-tested)

- `findPubkeys(text)` -> `{ value, start, end }[]` — matches `\b[0-9a-fA-F]{64}\b`.
- `findCoordinates(text)` -> `{ lat, lon, start, end, raw }[]` — three forms.
  Both numbers must carry a decimal fraction; ranges validated
  (lat in [-90, 90], lon in [-180, 180]) to cut false positives.
- `tokenizeMessageText(text, opts)` -> ordered `Token[]` where a token is one of
  `text | mention | url | hashtag | pubkey | coordinate`. One scan collects all
  matches, sorts by `start`, resolves overlaps by fixed priority
  (mention > url > coordinate > pubkey > hashtag), and emits gap `text` tokens
  between entities. Entity toggles (`opts.parsePubkeys`,
  `opts.parseCoordinates`, `opts.linkifyUrls`) suppress a finder when off.
  Mentions and hashtags are always parsed (unchanged from today).

### Frontend — `MessageList.tsx`

- Replace the nested `renderTextWithMentions` / `linkifyText` /
  `renderChannelReferences` chain with a `renderTokens(tokens, ctx)` mapper.
  Existing mention/url/hashtag rendering (styles, the `+` capture affordance,
  click handlers, `HashtagRenderCtx`) is preserved token-by-token.
- New renderers:
  - `PubkeyToken` — known (a loaded contact's `public_key` equals the value):
    render as a button that calls `onOpenContactInfo(value)`. Unknown: render a
    mono span plus an analyzer lookup button that opens
    `buildNodeLookupUrl(firstAnalyzerSite, value)` in a new tab
    (`rel="noopener noreferrer"`). The button is hidden when no `analyzer_site`
    is configured or the template is unusable.
  - `CoordinateToken` — reuses `MarkerMessage` / `LocationPreviewMap`. The
    mini-map remains governed by the existing browser-local location-preview
    pref, exactly as MeshCore markers are today.
  - `UrlPreviewCard` — feature 4 (below).
- The three entity toggles arrive as props derived from `useAppSettings`
  (threaded like the existing `autoAddMentionedChannels` prop).

### Backend — `GET /api/unfurl?url=<encoded>`

New `app/routers/unfurl.py` + `app/services/unfurl.py`.

- Response: `{ url, title?, description?, image?, site_name? }` or a 4xx.
- SSRF guard in new `app/services/url_safety.py`:
  - Require `http`/`https` scheme.
  - Resolve the host; reject if any resolved IP is private, loopback,
    link-local, reserved, or unspecified.
  - `follow_redirects=False`; follow manually up to ~3 hops, re-validating the
    host of each hop.
  - Timeout; cap the read body at ~256 KB; browser-like `User-Agent`; send no
    cookies or auth.
- Parse with stdlib `html.parser.HTMLParser` — extract OpenGraph (`og:title`,
  `og:description`, `og:image`, `og:site_name`), Twitter card equivalents, and
  the `<title>` tag as fallback. NO new dependency.
- Small in-memory TTL cache (URL -> result) so re-renders and virtualized
  scroll-back do not refetch.

## Settings (server-side)

Migration `_082` adds four columns to `app_settings`, threaded through the
standard pattern (`repository/settings.py` SELECT + parse + `_apply_updates` +
`update()`; `models.py` `AppSettings`; `routers/settings.py`
`AppSettingsUpdate`; frontend `types.ts` `AppSettings` and `AppSettingsUpdate`;
Settings UI):

- `chat_parse_pubkeys` (default 0)
- `chat_parse_coordinates` (default 0)
- `chat_url_previews` (default 0)
- `chat_linkify_urls` (default 1) — preserves today's always-on behavior

UI: a new "Chat" group of toggle rows in the settings modal, following the
existing toggle-row pattern. New i18n keys in EN/NL/DE (enforced by eslint +
the parity test). The `chat_url_previews` help text notes the privacy tradeoff
(the server fetches third-party URLs seen in messages).

## Data flow

Render path: message text -> `tokenizeMessageText(text, { parsePubkeys,
parseCoordinates, linkifyUrls })` -> `renderTokens`. Pubkey resolution is a
synchronous lookup against the already-loaded `contacts` prop.

Unfurl path: `UrlPreviewCard` mounts (only when `chat_url_previews` is on) ->
`GET /api/unfurl?url=...` -> render the preview card. A load skeleton shows
while fetching; any failure falls back silently to the plain link.

## Error handling

- Malformed coord/pubkey candidates are simply not emitted as entity tokens;
  they render as plain text.
- The analyzer button is hidden when no usable `analyzer_site` is configured.
- Unfurl failures (blocked IP, timeout, non-HTML, oversize, parse miss) -> the
  endpoint returns 4xx or an empty result -> the card renders nothing and the
  plain link remains. No error toast; previews are best-effort.

## Testing

- Unit (frontend): `chatEntities` finders + tokenizer — each GPS form, 64-hex
  boundary behavior, overlap priority, and each toggle in the off state.
  Extend `messageParser` / `messageList` tests to prove mention/url/hashtag
  rendering is unchanged after the refactor.
- Unit (backend): `url_safety` — private, loopback, link-local, reserved, and
  redirect-to-private hosts all rejected; a public host allowed. Unfurl parser —
  og/twitter/title extraction, size cap, non-HTML content type.
- Backend settings: round-trip the four new fields through repository + router.
- Backend tests run in the `rtfm-ev-local` container venv (project convention:
  worktree bind-mounted to `/work`, pytest via `/app/.venv`).
- Frontend: `prettier --check` (CI gate) before pushing.

## Docs

- `CHANGELOG-DMC-EV.md`: entry grouped by area (frontend chat + backend unfurl +
  settings), referencing the PR/commit.
- `README.md` / `README_ADVANCED.md`: update the feature list and the settings
  reference for the four new toggles.
- `AGENTS.md`: note the unfurl service/endpoint and the new settings fields if
  the architecture surface warrants it.

## Out of scope / risks

- No active pubkey-over-RF discovery; resolution is DB-only plus the external
  analyzer link.
- Privacy: URL previews cause the RTFM-EV server (not the browser) to fetch
  third-party URLs found in message text. Off by default, lazy-fetched, and
  documented in the setting's help text.
- Refactoring the text renderer carries regression risk to existing
  mention/url/hashtag rendering; mitigated by porting behavior under test first.
