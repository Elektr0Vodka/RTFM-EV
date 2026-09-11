# 15. Channel Registry -> existing channel-creation path -> radio

Date: 2026-09-10
Status: planning only, no code written
Category: D (Registry / list sync), extends `docs/plans/README.md` index (new entry `[15]`)

## 1. Summary

RTFM-EV is a MeshCore server + browser terminal driving a companion radio. This
plan scopes "select channels in the shipped Channel Registry and add them into
the app (and eventually onto the radio)", reusing an existing channel-creation
code path rather than writing a new bespoke one, per the task instructions.

**Load-bearing fact established below (cited):** the shipped Channel Registry
(`frontend/src/lib/channelManager.ts`) stores channel **names only**. Its
`RegistryChannel` type has no `key` field at all, and the two places that
could populate one - `GET /api/registry/sync` (which *does* return a
`{name, key}` pair) and JSON import - both discard the key on the way into
the registry. This means "add registry channels to the app" cannot literally
reuse `ChannelImportExportModal`'s text-import endpoint (`POST
/api/channels/import`) without first inventing a key for each entry, because
that endpoint's whole contract is "take the literal key on each line." The
one existing endpoint that was built for exactly "I have channel names,
derive keys, create channels" is `POST /api/channels/bulk-hashtag`, already
wired end-to-end in the frontend for the New Message modal's bulk-add tab.
Section 3 lays out both options and the tradeoff; Section 6 flags it as an
open question rather than silently picking one, because the task text asked
to prefer the import-modal path specifically.

Pushing created channels onto the physical radio is **not** part of channel
creation in this codebase today, regardless of which creation endpoint is
used - that only happens lazily at send time (`app/services/message_send.py`)
or via the not-yet-built bulk push in `docs/plans/08-channel-preset-upload.md`.
This plan does not duplicate that work; see Section 5.

## 2. Current state (cited)

### 2.1 Channel Registry: a name-only localStorage catalog

- `RegistryChannel` (`frontend/src/lib/channelManager.ts:6-28`) fields:
  `channel` (name, always `#`-prefixed by `normalizeChannelName`,
  `channelManager.ts:32-35`), `category`, `subcategory`, `region`,
  `language`, `status`, `verified`, `recommended`, `alias_of`, `notes`,
  `tags`, `scopes`, `country`, `firstSeen`, `lastHeard`, `added`, `packets`,
  `source`, `private?`. **There is no `key` field anywhere in this
  interface.**
- Persistence is pure `localStorage` (`STORAGE_KEY =
  'meshcore-channel-registry'`, `channelManager.ts:30`; `loadRegistry`/
  `saveRegistry`, `:61-72`). Nothing here is server-side state.
- Four ways entries get in, none of which store a key:
  1. **Finder discovery** (`recordFinderDiscovery`, `channelManager.ts:80-95`)
     - called from `CrackerPanel.tsx:345` via the exported
     `notifyChannelFound` helper (`ChannelRegistryView.tsx:1575-1580`) when
     the hashtag cracker brute-forces a name. The cracker *does* know the key
     at that point (it just cracked it) but `notifyChannelFound` only takes a
     `channelName` string (`ChannelRegistryView.tsx:1575`) - the key is
     dropped before it reaches the registry. (The key is used separately,
     same call site, to auto-create the channel via `POST /api/channels`
     with an explicit key - see 2.2 - that is a parallel path, not something
     the registry itself records.)
  2. **Manual add** (`addManualChannel`, `channelManager.ts:102-130`) - the
     Add Channel dialog (`ChannelRegistryView.tsx:1339-1471`) has no key
     field at all.
  3. **Radio seed** (`seedFromRadioChannels`, `channelManager.ts:266-307`) -
     one-way seed from already-existing DB channels
     (`ChannelRegistryView.tsx:655-661`, `699-706`). The seed function
     receives `RadioChannelSeed{name, key, is_hashtag, created_at}` but
     writes only `name`-derived fields into the registry row; `key` is used
     solely as a dedupe lookup key in the local `byName` map
     (`channelManager.ts:270`), never persisted onto the `RegistryChannel`
     itself.
  4. **JSON import / remote sync** - `mergeImport`
     (`channelManager.ts:150-214`, accepts the Project A/B JSON schema, which
     also has no `channel_hash`/key field on write) and `addMissingFromSync`
     (`channelManager.ts:222-246`): `for (const { name } of channels)` at
     `:230` explicitly destructures only `name` from the `{name, key}` pairs
     returned by the sync endpoint (2.3) - **the key from the sync payload is
     read and thrown away**.
- The only place a key is ever attached to a registry row, transiently, is on
  **export**: `toProjectAFormat(entries, keyByName)`
  (`channelManager.ts:402-447`) takes an *optional* `keyByName` map built at
  export time from the app's live `channels` prop
  (`ChannelRegistryView.tsx:845-851`, `buildKeyByName`), so `channel_hash` in
  an export is populated only when that name currently exists as a real DB
  channel - not from anything stored in the registry.

### 2.2 Existing channel-creation code paths (three, not one)

Three separate backend endpoints already create channels; none of them push
to the radio (`app/routers/channels.py:246` "Channels are NOT pushed to
radio on creation... loaded to the radio automatically when sending a
message"):

- **`POST /api/channels`** (`app/routers/channels.py:242-267`) - single
  channel. `_derive_channel_identity` (`app/routers/channels.py:88-130`): if
  the name starts with `#` (hashtag), the key is **always** re-derived as
  `SHA256(name)[:16]` (`:129-130`) regardless of any `key` passed in the
  request - an explicit key on a hashtag name is only honored for the
  non-hashtag / custom-key branch (`:112-127`). This is the path
  `CrackerPanel.tsx` uses via `handleCreateCrackedChannel`
  (`App.tsx:496-510`) - safe because a cracked hashtag's key is by
  definition `SHA256(name)[:16]`, so passing it is redundant, not
  overriding.
- **`POST /api/channels/bulk-hashtag`** (`app/routers/channels.py:270-342`,
  request/response models `:38-55`) - takes `channel_names: list[str]` +
  `try_historical: bool`. Same `_derive_channel_identity` derivation per
  name, skips names that already exist (`existing_count`), reports
  `invalid_names`, and can kick off a background historical-decrypt sweep
  exactly like import does. **Already wired end-to-end in the frontend**:
  `api.bulkCreateHashtagChannels` (`frontend/src/api.ts:225-229`) ->
  `handleBulkCreateHashtagChannels` (`frontend/src/hooks/useContactsAndChannels.ts:115-131`)
  -> `handleBulkAddChannels` (`App.tsx:562-568`) -> the New Message modal's
  "bulk-hashtag" tab (`NewMessageModal.tsx:270`, `:414-418`, textarea of one
  name per line). This is a *different* existing feature from the one named
  in the task ("Channel Import/Export", PR #9) but it is the one already
  built for "I only have names."
- **`POST /api/channels/import`** (`app/routers/channels.py:452-557`) - the
  PR #9 "Channel Import/Export" feature's backend. Parses
  `"#name - hexkey"` lines (`ChannelImportExportModal.tsx:37-50` export
  format, `:68-102` `parseImportFile` requiring exactly 32 lowercase hex
  chars after the last `" - "`). Critically, this endpoint does **not** call
  `_derive_channel_identity` - it upserts the **literal key parsed from the
  line** (`app/routers/channels.py:508-513`, `is_hashtag=True`
  unconditionally) with no re-derivation or validation that the key matches
  `SHA256(name)`. This is the only one of the three endpoints that can
  create a hashtag-named channel whose key is *not* the hashtag hash of its
  name (e.g. a private channel shared under a friendly display name). It is
  reached from the frontend only via `ChannelImportExportModal`'s Import tab
  (`ChannelImportExportModal.tsx:214-229`, `api.importChannels`,
  `frontend/src/api.ts:232-` - a multipart file upload, not a JSON body).
  `ChannelImportExportModal` itself is opened from the sidebar ("Channels ->
  Import", wired at `App.tsx:860-868`) and is **not currently connected to
  the Channel Registry view** in any way - confirmed by grepping both
  component names across `frontend/src`; they appear in disjoint files.

None of the three endpoints touch the radio. All three store
`on_radio=False` and broadcast a `channel` WS event
(`_broadcast_channel_update`, `app/routers/channels.py:26-27`).

### 2.3 `GET /api/registry/sync` (backend, shipped)

`app/routers/registry.py:22-75`. Reads `app_settings.registry_sync_url`
(migration `_068_add_registry_sync_url.py`), 400s if blank, fetches the URL
server-side with `httpx.AsyncClient(timeout=10.0, follow_redirects=True)`,
502s on transport error / non-200 / non-JSON / non-dict body. The remote
contract is a flat `{ "#name": "hexkey", ... }` object
(`app/routers/registry.py:24-30`), normalized into `SyncResponse{channels:
list[{name, key}]}` (`:13-19`). **The key is present and valid in this
response** - it is `addMissingFromSync` on the frontend (2.1.4) that drops
it before storing.

### 2.4 How channels actually reach the radio (cited, not re-designed here)

Per `docs/plans/08-channel-preset-upload.md` section 2.1 (verified against
the same source in this pass):

- The only place a channel key/name is written to a radio slot
  (`mc.commands.set_channel(...)`) is inside the channel-send flow,
  triggered by sending a message: `app/services/message_send.py:256-295`.
  Slot choice comes from `RadioManager.plan_channel_send_slot(...)`
  (`app/radio.py:329-353`), an LRU cache over a capacity discovered from the
  radio (`app/radio.py:318-323`), backed by `self.max_channels` (default
  `40` before `DEVICE_INFO` is read, `app/radio.py:177`, `224`).
- `app/AGENTS.md:117`: "Channel slot count comes from firmware-reported
  `DEVICE_INFO.max_channels`; do not hardcode `40`." The `~40` figure is a
  practical default/observed ceiling, not a hardcoded limit anywhere in the
  creation path.
- There is **no** existing bulk/proactive push of a set of channels to the
  radio. `sync_and_offload_channels()` (`app/radio_sync.py:301-351`) only
  runs the inverse (reads populated slots into the DB, then clears them at
  connect time). A "push these N channels now" function does not exist; the
  closest work-in-progress design for one is plan `[08]`'s proposed
  apply-now endpoint (Section 4.3 of that plan), still unimplemented.
- Consequence for this plan: **adding registry channels to the app's channel
  list (DB) and getting them onto the physical radio are two separate
  concerns**, already separated in this codebase for every other channel
  creation path (2.2). This plan's job is only the first half; see Section 5
  for how the second half is expected to be covered by `[08]`.

## 3. Design

### 3.1 Reuse target: two candidates, one recommended

Because the registry has no key (2.1), turning a selection of registry
entries into real channels means picking one of:

**Option A (recommended): reuse `POST /api/channels/bulk-hashtag`.**
Zero new backend code, zero new frontend cryptography. The registry's
`channel` field is already normalized to a `#name` hashtag form for the
overwhelming majority of entries (every non-`radio`-non-custom source
enforces the `#` prefix, `channelManager.ts:32-35`), which is exactly the
shape `bulk-hashtag` expects. The frontend plumbing already exists end to
end (2.2) and only needs a new caller: build `channelNames: string[]` from
the selected `RegistryChannel[]` (mapping `.channel`, filtering out
`.private` entries the same way `handleExport` already does,
`ChannelRegistryView.tsx:893-899`), call `api.bulkCreateHashtagChannels`
(or the already-wired `handleBulkCreateHashtagChannels`), and merge the
typed `BulkCreateHashtagChannelsResult` (`frontend/src/types.ts:297-304`)
into the existing `BulkAddChannelResultModal.tsx` UI that already renders
this exact result shape for the New Message modal's bulk-add tab. **This is
not the "Channel Import/Export" (PR #9) feature named in the task, but it is
the existing endpoint built for the registry's actual data shape (names
only).**

**Option B (task's literal instruction): reuse `ChannelImportExportModal`'s
import path, `POST /api/channels/import`.** This requires manufacturing a
key for each registry entry, since the endpoint's contract is "take the
literal key on this line" and does not derive one
(`app/routers/channels.py:508-513`). The only key that can be manufactured
without inventing a new provenance is the same hashtag derivation the
backend already applies elsewhere: `SHA256(name)[:16]`. Today, **no frontend
code computes this** (verified: no `sha256`/`crypto.subtle` hashing utility
anywhere in `frontend/src`) - it is currently a server-only computation
(`app/routers/channels.py:129-130`). Implementing Option B means adding a
new client-side SHA-256 call (`crypto.subtle.digest('SHA-256', ...)`,
available in all supported browsers over HTTPS/localhost) to build synthetic
`"#name - <hex>"` lines, wrapping them in a `Blob`/`File`, and calling
`api.importChannels` (`frontend/src/api.ts:232-`) exactly as if the user had
uploaded a `.txt` file - i.e., the *frontend* glue is new, but the backend
code path is untouched and shared with manual `.txt` import.

Both options satisfy "reuse an existing creation path, don't invent a new
endpoint." Option A needs no new hashing logic; Option B matches the task's
literal wording ("hooking up... to the existing channel export import
functionality") and gives the user the same result-shape UI
(`ChannelImportExportModal`'s already-built import summary /
duplicate-count / invalid-lines panel, `ChannelImportExportModal.tsx:385-425`)
without needing `BulkAddChannelResultModal` wiring. See Section 6, item 3 -
this is flagged as an **open question for the user**, not decided here,
because the task text explicitly asked to prefer the import-modal logic
while the facts favor the zero-new-code path.

### 3.2 UI: "Add to app" action in `ChannelRegistryView`

Regardless of which option is chosen, the new surface is the same:

- A new button next to the existing Export / Export (A) buttons in
  `ChannelRegistryView.tsx`'s header (`:962-1033`), following the exact
  selection-or-all convention already used by `handleExport`
  (`:893-899`, `selection.size > 0 ? registry.filter(...) : sorted`) and
  the same private-exclusion rule (`.filter((e) => !e.private)`).
- Label: "Add to Channels" (working title; avoid "Import" in the label if
  Option A is chosen, since bulk-hashtag is not the import feature - avoid
  ambiguity with the existing sidebar "Channels -> Import" entry point that
  opens `ChannelImportExportModal`).
- Dedupe against existing channels happens for free in both options: both
  `bulk-hashtag` (`existing_count`, checks `ChannelRepository.get_by_key`
  per derived key, `app/routers/channels.py:290-293`) and `import`
  (`duplicate_count`, same repository check on the literal key,
  `:502-505`) already skip channels whose key is already in the DB. No new
  dedupe logic is needed in the registry UI itself beyond what the chosen
  backend endpoint already does - the registry view does not need to
  pre-filter against `channels` prop before submitting.
- Result surfacing: reuse whichever typed result component already exists
  for the chosen endpoint (`BulkAddChannelResultModal.tsx` for Option A, or
  `ChannelImportExportModal`'s inline result panel for Option B) rather than
  building a third result-summary UI.

### 3.3 Typed contracts

No new types needed for Option A - `BulkCreateHashtagChannelsResult`
(`frontend/src/types.ts:297-304`) and its request signature already exist
and are already threaded through a hook (`useContactsAndChannels.ts:115-131`).

For Option B, no new backend types either (`ChannelImportResult`,
`frontend/src/types.ts:306-`, already exists) - only new frontend glue: a
small `deriveHashtagKey(name: string): Promise<string>` helper (new file or
inline in `ChannelRegistryView.tsx`) and a `buildImportFile(entries:
RegistryChannel[]): Promise<File>` helper that mirrors
`formatExportContent`'s line format (`ChannelImportExportModal.tsx:37-50`)
exactly, so the synthesized input is byte-for-byte what a real exported file
would look like.

## 4. Phasing

**Slice 1 (this plan's scope): "Add to Channels" from the registry, DB only.**

- Add the button + selection-to-request wiring in `ChannelRegistryView.tsx`
  (Section 3.2), using whichever option is chosen (Section 6, open question).
- No radio push. Created channels land with `on_radio=False`, exactly like
  every other creation path today (2.2) - consistent, not a regression.
- Result modal reuses an existing component (Option A:
  `BulkAddChannelResultModal`; Option B: the import modal's own result
  view) - no new result UI.

**Slice 2 (deferred to `[08]`, not built here): get them onto the radio.**

- Per Section 2.4, there is no existing bulk radio-push today. Once `[08]`'s
  apply-now endpoint ships (its own Section 4.3), a registry-originated
  channel is indistinguishable from any other DB channel with
  `on_radio=False` - it becomes eligible for whatever preset/apply
  mechanism `[08]` builds, with zero registry-specific code needed on the
  radio-push side. Until `[08]` ships, registry-added channels reach the
  radio the same way every channel does today: lazily, the first time
  someone sends a message to them (`app/services/message_send.py:256-295`).
- This plan does not propose an early bespoke radio-push step for registry
  channels specifically - doing so would duplicate `[08]`'s design work
  (slot planning, capacity checks, partial-failure UX) for one channel
  source out of several, which `[08]` Section 6 already identifies as risk
  territory (partial-apply UX, additive-vs-replace semantics) that should be
  solved once, generically.

## 5. Relationship to `[08]` and `[05]`

- **`[08]` (channel/contact preset upload)** owns "push a set of channels to
  the radio in one action." This plan explicitly does not duplicate that
  work (Section 4, Slice 2) - it only gets registry-selected names into the
  channels table via an existing creation endpoint, the same as manual
  add, cracker discovery, or `.txt` import already do. Once `[08]` ships its
  apply-now endpoint, it applies uniformly to channels regardless of
  which of the three creation paths (2.2) put them in the DB; no
  registry-specific integration work is anticipated on `[08]`'s side.
- **`[05]` (region-scope list sync)** shares the `GET /api/registry/sync`-
  style template (server-side proxy fetch, additive local merge) but syncs
  into `known_regions` (a flat server-side setting), not into a
  browser-local catalog. This plan does not touch that sync mechanism - it
  is downstream of it, consuming registry entries that may have arrived via
  sync (2.3) or by any other of the four intake paths (2.1). The dropped-key
  finding in 2.1.4 is specific to the Channel Registry's `addMissingFromSync`
  and has no bearing on `[05]`'s region-name sync, which carries no key
  concept at all.

## 6. Risks / open questions

1. **Capacity.** Adding channels to the DB from the registry has no
   enforced ceiling - the DB already stores channels "beyond the radio
   limits (~40 channels)" by design (`AGENTS.md:97`). A user selecting, say,
   60 registry entries and clicking "Add to Channels" will succeed at the DB
   layer with zero errors; only later, at radio-load time (2.4), does the
   firmware-reported `max_channels` ceiling become relevant, and that
   ceiling is managed by the existing LRU slot cache
   (`app/radio.py:329-395`), not by this plan's new code. No new capacity
   check is proposed here; this matches how `bulk-hashtag` and `.txt` import
   already behave (unbounded DB creation, bounded radio residency).
2. **Dedupe correctness depends on key derivation matching intent.** If
   Option A (bulk-hashtag) is chosen and a registry entry's name was
   associated, in the operator's head, with a *different* (non-hashtag-
   derived) key - e.g. it came from `mergeImport`'s Project A/B JSON schema,
   which can carry arbitrary metadata for a channel someone privately typed
   in without ever confirming it is a "real" `#`-hashtag secret - bulk-hashtag
   will silently create a channel keyed by `SHA256(name)`, which may not be
   the channel the operator actually meant. This is not a new risk
   specific to this plan (the registry never stored a key to compare
   against), but it is worth surfacing: **the registry cannot tell the
   difference between "this name is a public hashtag channel" and "this
   name is a private channel someone is tracking under a friendly label"**,
   because it never captured a key for either case. Option B does not solve
   this either, since it has to *assume* hashtag derivation to manufacture a
   key in the first place. Fixing this at the root would mean adding a
   `key` field to `RegistryChannel` and threading it through all four intake
   paths (2.1) - out of scope for "smallest change," flagged here as a
   pre-existing data-model gap, not something this plan's UI hookup should
   silently paper over.
3. **OPEN QUESTION (blocks implementation): Option A vs. Option B (Section
   3.1).** The task text asked to prefer reusing `ChannelImportExportModal`'s
   import logic, but the fact-finding in this plan shows `bulk-hashtag` is
   the endpoint actually shaped for "names only, no keys," with zero new
   crypto code, an already-built result-modal, and an already-wired
   frontend hook. Recommend Option A on "smallest change" grounds, but this
   is presented as a decision for the user/reviewer, not decided
   unilaterally, since it contradicts the letter of the task instruction.
4. **Registry entries that are not hashtag names.** `seedFromRadioChannels`
   can produce a non-`#`-prefixed entry for the canonical `Public` channel
   or any other `is_hashtag=false` seed (`channelManager.ts:276`,
   `is_hashtag === false` branch keeps the name as-is). Neither
   `bulk-hashtag` nor a synthesized `.txt` import line is designed for a
   non-hashtag custom-key channel (both assume/force `is_hashtag=True`
   semantics, `app/routers/channels.py:270-342` implicitly via
   `_derive_channel_identity`'s hashtag branch, `:508-513` explicitly). The
   "Add to Channels" action should filter out any registry entry whose
   `channel` does not start with `#` (or explicitly warn/skip it), rather
   than silently mis-creating a hashtag channel from a non-hashtag name.
   UNVERIFIED how common non-`#` registry entries are in practice (depends
   on operator usage of the radio-seed source); flagging as an edge case to
   handle explicitly in implementation, not to assume away.
5. **Next free migration.** No schema change is proposed by this plan (both
   reuse targets are existing endpoints with existing storage). For the
   record, at research time `git ls-tree -r origin/main --name-only --
   app/migrations` shows the highest file as
   `_070_create_battery_history.py`, so the next free number is **`071`**
   if a future revision of this plan needs one - this supersedes the
   `069`/`070` figures cited in plans `[05]`/`[08]`, which were written
   against an earlier `origin/main` state (highest was `_068` at the time).
   Re-verify at build time per those plans' own caveat.

## 7. Verification plan

**Backend tests** (no backend changes if Option A is chosen - existing
`bulk-hashtag` coverage should already exist; confirm before assuming a gap):

- `git grep -l bulk-hashtag tests/` (or equivalent) to confirm whether
  `POST /api/channels/bulk-hashtag` already has router test coverage to
  point new frontend tests at, before assuming new backend tests are needed.
- If Option B is chosen instead, no backend test changes are needed either
  (`POST /api/channels/import` is unmodified); only the frontend glue that
  manufactures the file needs test coverage.

**Frontend tests** (Vitest, `frontend/AGENTS.md` Testing section):

- New test for the "Add to Channels" button in a
  `ChannelRegistryView`-focused test file (none currently listed in
  `frontend/AGENTS.md`'s representative test inventory - confirm whether one
  exists before assuming a new file is needed): selection-or-all semantics,
  private-entry exclusion, and the correct API call for whichever option is
  chosen.
- If Option A: assert `api.bulkCreateHashtagChannels` is called with the
  expected `channelNames` array (mirroring
  `useContactsAndChannels.test.ts:198-209`'s existing mock pattern).
- If Option B: assert the synthesized file content matches
  `"#name - <sha256 hex>"` for a known fixture name/hash pair, and that
  `api.importChannels` receives it.

**Live/manual verification (required per repo rule - compiling/tests are
not proof of runtime behavior):**

- Add 2-3 entries to the Channel Registry (mix of finder-discovered and
  manually-added), select them, click "Add to Channels," and confirm via
  `GET /api/channels` (or the Channels sidebar) that they appear with
  `on_radio: false` and the expected key.
- Confirm duplicate handling: re-run the same action on already-added
  entries and confirm the result reports them as already-present rather
  than erroring or double-creating.
- Confirm a non-`#`-prefixed registry entry (if one exists, e.g. a
  radio-seeded "Public"-like row) is excluded or explicitly flagged rather
  than silently mis-keyed (Risk 4).
- `./scripts/quality/all_quality.sh` before calling the slice done, per root
  `AGENTS.md:7-13`.

## 8. Effort

- **Slice 1, Option A (bulk-hashtag reuse)**: small. One new button, one new
  handler in `ChannelRegistryView.tsx` calling an already-wired hook/API
  method, reusing `BulkAddChannelResultModal` for the result. No backend
  changes. Sonnet-scoped, a few hours including tests.
- **Slice 1, Option B (import-modal reuse)**: small-to-moderate. Same UI
  hookup, plus a new client-side SHA-256 derivation helper and a
  file-synthesis helper, both new (if small) frontend code with their own
  unit tests. Still no backend changes. Sonnet-scoped, slightly more than
  Option A due to the new hashing utility and its tests.
- **Slice 2 (radio push)**: not this plan's effort - tracked entirely under
  `[08]`, whose own effort estimate (`08-channel-preset-upload.md` Section
  8) already accounts for it.
