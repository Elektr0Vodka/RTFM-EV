# Channel-finder wordlist sync from registry + #hashtag mention handling

Status: DESIGN (awaiting user review). Date: 2026-09-12.
Branch: `claude/channel-finder-wordlist-hashtags-104950` (worktree
`rtfm-ev-quick-wins-c63eeb`).

Two independent features, groupable in one branch because both touch the
channel-finder / channel-registry surface. Either can ship on its own.

## Decisions (from brainstorming, 2026-09-12, user)

1. **Wordlist source** = Channel Registry entries (not the followed radio
   channel list).
2. **Wordlist sync mechanism** = manual button (snapshot into a persisted
   cache), not a live merge.
3. **Mention handling** = all three of: distinct highlight, auto-add to
   registry, inline add action.
4. **Add target** = registry only (mentions never auto-create a followed radio
   channel).
5. **Auto-add default** = OFF (opt-in setting). The inline "+" is the primary
   manual capture path; the setting enables passive capture.
6. **Mention source value** = new `source: 'mention'` (not reused `'imported'`).

---

## Feature 1 — Sync cracker wordlist from Channel Registry names

### Goal

Extend the browser cracker's candidate wordlist with the names of channels
already in the local Channel Registry (with the leading `#` stripped), so
locally-known / previously-discovered channel names become brute-force
candidates. Mirrors the existing bundled + remote-sync merge.

### Current state (facts, cited)

- `frontend/src/components/CrackerPanel.tsx:92-111` loads the bundled
  `ENGLISH_WORDLIST` once when the panel first becomes visible and merges it
  with the remote-synced cache via `mergeWordlists(ENGLISH_WORDLIST,
  loadSyncedWordlist())` in a single `setWordlist()` call. `setWordlist()`
  **replaces**, so the merge must be one call (per plan [09]).
- `frontend/src/lib/wordlistSync.ts` provides `loadSyncedWordlist()` /
  `saveSyncedWordlist()` (localStorage key `meshcore-wordlist-sync-cache`,
  replace semantics) and `mergeWordlists(...lists)` (case-insensitive dedupe,
  first-seen order/casing preserved).
- `frontend/src/lib/channelManager.ts` holds the registry
  (`loadRegistry()`, localStorage `meshcore-channel-registry`) and
  `addableRegistryChannelNames(entries)` (lines 81-83), which already filters to
  non-private, `#`-prefixed entries and returns their names (with `#`).

### Design

**New cache in `wordlistSync.ts`:**

```ts
const REGISTRY_STORAGE_KEY = 'meshcore-wordlist-registry-cache';
export function loadRegistryWordlist(): string[] { /* same shape as loadSyncedWordlist */ }
export function saveRegistryWordlist(words: string[]): void { /* replace semantics */ }
```

Kept separate from the remote-sync cache so the two sources stay independently
inspectable and re-syncable (matches the remote cache's replace-not-append
rationale in plan [09]).

**New sync helper** (in `wordlistSync.ts`, pure, unit-testable): given registry
entries, produce the candidate name set:

```ts
export function registryWordlistCandidates(names: string[]): string[]
// strip a single leading '#', trim, drop empties; caller passes
// addableRegistryChannelNames(loadRegistry())
```

The strip-`#` + trim + drop-empty is the only transform; `mergeWordlists`
handles dedupe/normalisation downstream.

**Button in `CrackerPanel.tsx`** ("Sync from channels"), placed with the
existing control row:

- onClick: `saveRegistryWordlist(registryWordlistCandidates(addableRegistryChannelNames(loadRegistry())))`,
  then toast `t('cracker_wordlist_synced_from_channels', { count })` describing
  the count and that it takes effect on next finder load / reload (same caveat
  the remote sync documents).
- The button label / adjacent text shows the current cached count
  (`loadRegistryWordlist().length`).

**Merge change** at `CrackerPanel.tsx:100`:

```ts
const merged = mergeWordlists(ENGLISH_WORDLIST, loadSyncedWordlist(), loadRegistryWordlist());
```

No key derivation concerns: names that crack are keyed by the cracker's existing
`SHA256("#name")[:16]` path, identical to any other wordlist hit.

### Files touched (Feature 1)

- `frontend/src/lib/wordlistSync.ts` — 3 new exports.
- `frontend/src/components/CrackerPanel.tsx` — import, button, merge line.
- `frontend/src/i18n/locales/{en,nl,de}.json` — button + toast keys.
- Tests: `frontend/src/test/wordlistSync.test.ts` (candidate transform, cache
  round-trip), `frontend/src/test/crackerPanel.test.tsx` (button syncs + count).

---

## Feature 2 — #hashtag mentions in messages

### Goal

Surface `#hashtag` channel references in chat with a state-aware highlight,
let the user capture unknown ones into the registry with one click, and
optionally auto-capture them.

### Current state (facts, cited)

- `frontend/src/utils/messageParser.ts:6,29-46` — `findLinkedChannelReferences`
  matches `#[a-z0-9-]+` tokens (word-boundary anchored) in message text.
- `frontend/src/components/MessageList.tsx:261-311` — `renderChannelReferences`
  renders each reference as a clickable `<button>` (or `<span>` if no handler)
  with a single primary/underline style, calling `onChannelReferenceClick(label)`.
  MessageList already receives the `channels` prop (line 60, 538).
- `frontend/src/App.tsx:577-594` — `handleChannelReferenceClick`: if the name is
  in `channels[]`, navigate to it; otherwise open the New Message modal
  prefilled on the hashtag tab. (Existing click behaviour — unchanged.)
- `frontend/src/components/ChannelRegistryView.tsx:1751-1756` —
  `notifyChannelFound(name)`: `recordFinderDiscovery` + `saveRegistry`. This is
  the integration-helper pattern to parallel.
- `channelManager.ts` `RegistryChannel['source']` union =
  `'finder' | 'manual' | 'imported' | 'radio'`. Source appears in
  `SOURCE_LABEL_KEYS` (`ChannelRegistryView.tsx:76-81`) and two filter
  `<select>`s (lines ~485-488, ~1201-1208).

### Design

#### 2a. New registry integration helper

`channelManager.ts`:

```ts
// Records a channel referenced in chat, if not already present. Unlike
// recordFinderDiscovery this does NOT set firstSeen/lastHeard or bump packets —
// a mention is a reference, not observed channel activity. No-op if present.
export function recordMention(channelName: string, existing: RegistryChannel[]):
  { result: RegistryChannel[]; added: boolean }
```

New entry: `source: 'mention'`, `firstSeen: null`, `lastHeard: null`,
`packets: 0`, `added: today`. Add `'mention'` to the `source` union.

`ChannelRegistryView.tsx`:

```ts
export function notifyChannelMentioned(channelName: string): boolean
// loadRegistry -> recordMention -> saveRegistry if added; returns whether added
```

#### 2b. Three-state highlight

`renderChannelReferences` (MessageList) gains awareness of two lookups derived
once per render:

- `followedNames: Set<string>` from `channels[]` (lowercased, `#`-normalised).
- `registryNames: Set<string>` from `loadRegistry()` (lowercased).

Per reference `label`:

| State | Condition | Style | Interaction |
|-------|-----------|-------|-------------|
| Followed | in `followedNames` | current primary/underline | click → navigate (existing) |
| Known | in `registryNames` only | muted/secondary token | click → existing modal path |
| Unknown | in neither | "new" token (e.g. dashed/accent) | click → existing modal path, **plus inline "+"** |

Styling uses existing token classes (see `frontend/AGENTS.md` style reference);
exact palette chosen at implementation, kept theme-aware.

`loadRegistry()` is read once per MessageList render into a memoised Set; it is a
synchronous localStorage read of a small array. If profiling shows churn, lift
it to a prop from `App.tsx`. (Assumption: per-render read is acceptable given
list virtualisation already limits mounted rows; flagged for the implementer.)

#### 2c. Inline add action

On an **Unknown** reference, render a small `+` control (icon button, aria-label
`t('chat_hashtag_add_to_registry_aria', { channel })`) adjacent to the token.
onClick → `notifyChannelMentioned(label)`, toast success, and locally flip that
token to the "Known" style (optimistic; a new `onHashtagAdded?(name)` callback
lets the parent invalidate the memoised registry Set so all rows update).

Registry only — never creates a followed radio channel (per decision 4).

#### 2d. Auto-add setting (default OFF)

- New boolean setting `auto_add_mentioned_channels` (mirror an existing frontend
  boolean setting's plumbing: `types.ts` AppSettings/AppSettingsUpdate, backend
  `models.py` + `AppSettingsUpdate` in `routers/settings.py` + repository wiring
  + a migration, following the exact pattern of an existing boolean flag —
  implementer to pick the closest precedent flag and mirror its four touch
  points). **VERIFY** the closest existing boolean-setting precedent before
  writing the migration.
- When ON: `renderChannelReferences` (or a small effect over incoming messages)
  calls `notifyChannelMentioned` for each Unknown reference as it is rendered.
  When OFF (default): no passive capture; only the inline "+" adds.
- UI toggle: a checkbox in the relevant settings section (same section as other
  chat/registry display toggles; implementer picks by proximity to existing
  mention/registry settings).

Open sub-question deferred to implementation: auto-capture on render vs. on
message-receive. Render-time is simplest (reuses the same Set + code path) and
naturally scoped to what the user actually sees; message-receive would capture
even in un-opened channels. **Recommend render-time** for scope-safety and
simplicity; note in PR.

#### 2e. Registry UI for the new source

Add `mention: 'channel_registry_source_mention_lc'` to `SOURCE_LABEL_KEYS`, a
`<option value="mention">` to both source filter selects, and the label +
`_lc` i18n keys in EN/NL/DE.

### Files touched (Feature 2)

- `frontend/src/lib/channelManager.ts` — `source` union, `recordMention`.
- `frontend/src/components/ChannelRegistryView.tsx` — `notifyChannelMentioned`,
  `SOURCE_LABEL_KEYS`, two filter `<option>`s.
- `frontend/src/components/MessageList.tsx` — three-state highlight, inline "+",
  memoised Sets, optional `onHashtagAdded` prop wiring.
- `frontend/src/App.tsx` — pass `auto_add_mentioned_channels`, wire
  `onHashtagAdded`.
- Settings section component + `Settings*` — toggle UI.
- Backend: `app/models.py`, `app/routers/settings.py`,
  `app/repository/settings.py`, `app/migrations/_0NN_add_auto_add_mentioned.py`.
- `frontend/src/types.ts` — settings field.
- `frontend/src/i18n/locales/{en,nl,de}.json` — all new keys.
- Tests: `messageParser`/`MessageList` highlight + inline-add, `channelManager`
  `recordMention`, backend settings tests mirroring an existing boolean flag.

---

## Phasing

1. Feature 1 (self-contained, frontend-only, small). Shippable alone.
2. Feature 2a + 2b + 2c (registry helper, highlight, inline "+"), frontend-only.
   Shippable without the setting (auto-add simply absent).
3. Feature 2d (auto-add setting) — the only slice needing a backend migration.
4. Feature 2e (registry source UI) — ships with 2a since the new source appears
   as soon as `recordMention` runs.

## Verification plan (per repo "never claim it works without proof")

- Frontend unit: `cd frontend && npm run test:run` — wordlistSync transforms,
  `recordMention` no-op/added semantics, three-state classification.
- `npm run lint` + prettier `format:check` (CI gates prettier separately).
- Backend (Feature 2d only): `pytest tests/test_settings_router.py` mirroring the
  precedent boolean flag; migration schema-version bump.
- Runtime (observed, not reasoned): in the local Docker instance —
  (1) add a registry entry, click "Sync from channels", reload finder, confirm
  candidate count rose and a known name cracks;
  (2) post/observe a channel message containing a followed, a known, and an
  unknown `#hashtag`, confirm three distinct styles; click the unknown's "+",
  confirm it appears in the registry with source "mention";
  (3) toggle auto-add ON, observe a new unknown mention, confirm passive capture.

## Risks / open items

- **R1 (i18n parity):** every new string needs EN/NL/DE keys or the parity test
  + eslint fail. Enumerated per feature above.
- **R2 (registry read cost in MessageList):** per-render `loadRegistry()` behind
  a memo; lift to prop if profiling shows churn. Flagged, not pre-optimised.
- **R3 (setting precedent):** the exact boolean-setting migration/plumbing must
  be copied from a verified existing flag, not invented. **VERIFY before coding.**
- **R4 (auto-add capture point):** render-time recommended; confirm in PR.
- **R5 (branch name):** current branch is `claude/...`; repo convention is
  `feat/...`. Address at PR time (memory: branch-naming-convention).
