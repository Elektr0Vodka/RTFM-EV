# Notification sound on mentions & DMs — Design

Date: 2026-09-13
Branch: `claude/notification-sound-mentions-6faa39`

## Goal

Play an audible cue when the user is mentioned in a channel or receives a direct
message, with a global on/off toggle, a choice of bundled preset sounds, a
volume control, and the ability to upload a custom sound. Independent of the
existing per-conversation desktop-notification opt-in.

## Non-goals

- No change to the existing visual `MentionTicker` or to desktop
  (OS) notifications.
- No re-use of, or change to, the packet `signalAudioEngine` (Web Audio packet
  synthesis). That feature is unrelated and stays as-is.
- No push/service-worker background sound. The cue only plays while the app tab
  is open in a browser (same reliability envelope as the existing in-tab
  desktop notifications).

## Definitions

- **Qualifying message**: a new, incoming, non-outgoing message that is not from
  a muted channel and passes the trigger rules below.
- **Mention (CHAN)**: message text contains `@[myname]` — the exact condition
  already used by `checkMention` / the mention ticker
  (`messageContainsMention`).
- **DM (PRIV)**: any incoming private message counts (a DM is inherently
  directed at the user).

## Trigger rules

Hook into the existing WebSocket message path in
`frontend/src/hooks/useRealtimeAppState.ts` `onMessage`, alongside the existing
`notifyIncomingMessage` / `onChannelMention` calls.

Play the sound when ALL of these hold:

1. Global setting `mention_sound_enabled` is true.
2. Message is new (`isNewMessage`) and not outgoing (`!msg.outgoing`).
3. Message is not from a muted channel (`isMutedChannel` already computed
   upstream — muted channels are skipped, matching the ticker/notification
   behaviour).
4. The conversation is not sound-muted (new per-conversation `localStorage`
   set, see below).
5. Trigger type:
   - CHAN: `checkMention(msg.text)` is true, OR
   - PRIV: always (any incoming DM).
6. Focus rule — SUPPRESS when the user is actively viewing this exact
   conversation with the tab focused. Reuse the same signal the desktop
   notification uses (`document.visibilityState === 'visible' &&
   document.hasFocus()`) combined with an active-conversation check
   (`isForActiveConversation`). If both "focused" and "this is the active
   conversation" are true, do not play. Otherwise play (background tab, other
   conversation open, etc.).

Rationale: (3)+(5) mean channel mentions use the same gate as the ticker, so
behaviour is consistent; DMs are broader because they are personal.

## Settings — global (server-side)

New migration `app/migrations/_088_add_mention_sound.py` (idempotent, mirrors
`_084`). Adds three scalar columns to `app_settings`:

- `mention_sound_enabled INTEGER NOT NULL DEFAULT 0`
- `mention_sound_choice TEXT NOT NULL DEFAULT 'beep'` — a preset id
  (`beep`|`bingbong`|`bong`|`tuduludu`|`uh-oh`) or the literal `custom`.
- `mention_sound_volume INTEGER NOT NULL DEFAULT 80` — 0..100.

Wire through the existing settings stack the same way `show_mention_ticker` is:

- `app/repository/settings.py`: SELECT columns, parse in the row->model builder,
  add params to the create-defaults and update paths.
- `app/models.py`: add the three fields to the `AppSettings` model
  (class at line ~1130; `show_mention_ticker` is a field on it, ~1216).
- `app/routers/settings.py`: add the three optional fields to the update request
  model and the update kwargs mapping (mirror `show_mention_ticker` at
  lines ~144 and ~413).

The custom sound BLOB is deliberately NOT stored in `app_settings` — see below —
so the settings GET payload stays small.

## Custom sound storage — dedicated table + endpoints

New table (created in the same `_088` migration):

```
CREATE TABLE IF NOT EXISTS mention_sound (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data BLOB NOT NULL,
    content_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
)
```

Single-row table (id always 1). Travels with the SQLite DB backup for free.

Repository: `app/repository/mention_sound.py` with `get()`, `set(data,
content_type, filename)`, `delete()`.

Endpoints in `app/routers/settings.py` (or a small dedicated router):

- `POST /api/settings/mention-sound` — multipart file upload.
  - Validate content type in {`audio/mpeg`, `audio/wav`/`audio/x-wav`,
    `audio/ogg`, `audio/mp4`/`audio/x-m4a`}. Also accept by extension
    (`.mp3/.wav/.ogg/.m4a`) as a fallback since browsers vary.
  - Enforce size cap **256 KB** (reject 413 with a clear message).
  - Store the blob; set `mention_sound_choice = 'custom'` in `app_settings`.
  - Return the new metadata (filename, size, content_type).
- `GET /api/settings/mention-sound` — stream the blob with its `Content-Type`
  and a long `Cache-Control` plus an ETag/`updated_at`-based validator so the
  browser can cache it and only re-fetch after replacement. 404 if none.
- `DELETE /api/settings/mention-sound` — drop the blob. If
  `mention_sound_choice == 'custom'`, reset it to the default preset (`beep`).

Size/type validation lives server-side (authoritative); the frontend also
pre-checks for a fast error.

## Preset assets

The five user-provided MP3s are committed to `frontend/public/sounds/` with ID3
tags stripped and normalized names:

| id         | file                          |
|------------|-------------------------------|
| `beep`     | `frontend/public/sounds/beep.mp3`     |
| `bingbong` | `frontend/public/sounds/bingbong.mp3` |
| `bong`     | `frontend/public/sounds/bong.mp3`     |
| `tuduludu` | `frontend/public/sounds/tuduludu.mp3` |
| `uh-oh`    | `frontend/public/sounds/uh-oh.mp3`    |

Tag stripping: remove leading ID3v2 (per the syncsafe size header) and any
trailing ID3v1 128-byte `TAG` block. Audio frames untouched (no re-encode). A
one-off Python step does this at import time; the committed files are the
stripped result (no build-time processing).

Referenced from the frontend as `./sounds/<id>.mp3` (same relative-path
convention as `./favicon-256x256.png`). The preset id list is a single source
of truth constant in the frontend.

Note: the service worker (`frontend/public/sw.js`) is not required to precache
these; presets load on demand and the browser caches them normally. No sw
change planned unless testing shows a caching gap.

## Playback module (frontend)

New `frontend/src/lib/mentionSound.ts` — a tiny wrapper around a single reused
`HTMLAudioElement`:

- `setSource(url)` — set `audio.src` (preset path or the custom GET endpoint).
- `setVolume(0..1)`.
- `play()` — reset `currentTime = 0` and `play()`, swallowing the autoplay
  rejection promise so a blocked play never throws into the WS handler.
- `unlock()` — called once from the first user gesture (any click/keydown on the
  app) to satisfy the browser autoplay policy: a muted 0-volume `play()`/`pause()`
  primes the element so later programmatic `play()` calls are allowed.

Coalescing: ignore repeat plays within a short window (e.g. 300 ms) so a burst
of mentions/DMs is one cue, not a machine-gun. (Simple wall-clock guard.)

Limitation (documented in code + changelog): a tab that has NEVER received a
user gesture may have its first `play()` blocked by the browser. In normal use
the user has clicked in the app, so the element is unlocked for the session.

### Hook wiring

A small hook `frontend/src/hooks/useMentionSound.ts` (or extend an existing
settings-consuming area) owns the module instance, keeps its source/volume in
sync with `appSettings` (`mention_sound_enabled`, `mention_sound_choice`,
`mention_sound_volume`) and exposes `playForMessage(msg)` applying the trigger
rules. `App.tsx` passes `playForMessage` into `useRealtimeAppState` as a new
optional callback (mirroring `notifyIncomingMessage` / `onChannelMention`), and
the `onMessage` handler calls it under the gate in "Trigger rules".

## Per-conversation sound-mute

Mirror the existing per-conversation notification map in
`useBrowserNotifications.ts` (localStorage, keyed by `getStateKey(type, id)`):

- New `localStorage` key
  `meshcore_mention_sound_muted_by_conversation` -> `Record<stateKey, true>`.
- Helper `isConversationSoundMuted(type, id)` and
  `toggleConversationSoundMuted(type, id)`.
- Surface a "mute sound" toggle next to the existing per-conversation
  notification toggle (same place in the conversation header / info pane where
  `toggleConversationNotifications` is used).

This gives the "Global + per-conversation override" behaviour for both channels
and DMs without a backend migration for per-conversation state, and is
consistent with how per-conversation notification enablement is already stored.

## UI — settings

New subsection in `frontend/src/components/settings/SettingsLocalSection.tsx`
(the same file that already hosts notification/mention-ticker settings):

- Enable toggle -> `mention_sound_enabled`.
- Preset dropdown (5 presets + "Custom" when a custom sound exists) ->
  `mention_sound_choice`.
- Volume slider (0..100) -> `mention_sound_volume`.
- Test button — plays the currently-selected sound at the current volume
  (counts as a user gesture, so it also unlocks playback).
- Custom sound: file input (accept mp3/wav/ogg/m4a, 256 KB), showing current
  custom filename/size if present, with Replace and Remove actions calling the
  POST/DELETE endpoints. Selecting Custom in the dropdown requires a custom
  upload to exist.

Settings mutations use the existing settings update API (`PATCH`/`POST` app
settings) for the three scalars; the custom blob uses its own endpoints.

## i18n

All new user-facing strings get `t()` keys added to `en.json`, `nl.json`,
`de.json` (enforced by the eslint rule + parity test). Keys grouped under an
existing settings namespace (e.g. `settings_mention_sound_*`).

## Testing

Frontend (vitest):

- `mentionSound` module: source/volume set, coalescing window, play swallows
  rejection.
- Trigger logic: CHAN with/without mention, PRIV always, muted channel skipped,
  sound-muted conversation skipped, focus+active-conversation suppression,
  disabled global setting -> no play. Extend `useRealtimeAppState.test.ts`
  patterns (mock the new callback like `notifyIncomingMessage`).
- Per-conversation sound-mute helpers (localStorage read/write/toggle).
- Settings section render + interactions (mirror `settingsModal` /
  `settingsLocalSection` tests): toggle, dropdown, volume, test, upload
  validation error path.
- i18n parity test covers the new keys.

Backend (pytest):

- Migration `_088` idempotency (columns + table created once, safe re-run).
- Settings repository: defaults, round-trip of the three scalars.
- `mention_sound` repository: set/get/delete round-trip.
- Endpoints: POST accepts valid small file and sets choice=custom; rejects
  oversize (413) and wrong type (415/400); GET streams with correct
  content-type and 404 when absent; DELETE clears and resets choice.

## Docs

- `CHANGELOG-DMC-EV.md`: entry under the frontend/chat area describing the
  feature (grouped, referencing the PR/commit) — including the autoplay
  limitation.
- `README.md` (and README_ADVANCED.md if it enumerates chat/notification
  features): add the mention/DM sound to the feature list and settings docs.

## Risks / limitations

- Autoplay policy: first play may be blocked on a tab with no prior user
  gesture. Mitigated by unlock-on-first-gesture and the Test button; documented.
- Preset MP3 licensing: files supplied by the maintainer for the fork; treated
  as cleared. No third-party assets pulled in.
- 256 KB cap constrains custom sound length/bitrate; surfaced clearly in the UI
  and enforced server-side.

## Out of scope / future

- Distinct sounds for mentions vs DMs.
- Push/service-worker background playback.
- Do-not-disturb schedule.
