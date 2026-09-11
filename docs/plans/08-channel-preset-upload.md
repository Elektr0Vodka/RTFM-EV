# 08. Channel/Contact Preset Upload

Date: 2026-09-10
Status: planning only, no code written
Category: E (Radio provisioning), per `docs/plans/README.md` entry `[08]`

## 1. Summary

RTFM-EV is a MeshCore server + browser terminal driving a companion radio. This
plan scopes a feature to save a named **preset** (a set of channels, optionally
a set of contacts) and push it to the connected radio in one action, so an
operator can load a known-good channel/contact set just before disconnecting
and leaving the server's reach (radio then operates standalone, e.g. taken to
the field with no server nearby).

Facts established below (all cited): there is currently no server-side
mechanism that pushes a *set* of channels to the radio proactively. Channels
are loaded into radio slots lazily, one at a time, only at message-send time.
Contacts are pushed in the background by a periodic reconcile loop driven by
`max_radio_contacts` and favorite status, not by any explicit "load this named
group" action. A preset-apply feature must therefore add a new code path, not
just call an existing one.

Two open questions were identified during planning: **(a)** additive vs.
replace-slots semantics for applying a channel preset - now RESOLVED to
additive, see the Decision note below and Section 6 item 1 - and **(b)**
whether contact bundling belongs in the first slice at all given the
reconcile loop already owns contact-loading policy, which remains open. See
Section 6.

## Decision (2026-09-10, user)

Applying a preset to the radio is **additive**: it adds the preset's channels
to existing/free slots via the existing LRU slot cache (3.1), and does not
clear or replace slots already occupied by channels outside the preset. This
resolves the additive-vs-replace open question in section 6 item 1 to
**additive**, for all slices, not just as a slice-1 default. The existing
firmware-reported ~40-slot capacity handling (2.1, `max_channels` /
`get_channel_send_cache_capacity()`) stays as-is, and apply must dedupe
against channels the radio already has loaded (by channel key) rather than
redundantly reconfiguring an already-resident slot.

## 2. Current state (cited)

### 2.1 Channels are not proactively pushed to the radio

- `POST /api/channels` (create) and `POST /api/channels/import` (file import)
  both store the channel in the database with `on_radio=False` and do **not**
  call any radio command. `app/routers/channels.py:254-260` ("Store in
  database only - radio sync happens at send time") and
  `app/routers/channels.py:507-513` (import path, same `on_radio=False`
  upsert).
- The only place a channel is actually written to a radio slot
  (`mc.commands.set_channel(...)`) is inside the channel-send flow,
  triggered by an outgoing message: `app/services/message_send.py:256-295`.
  Slot choice comes from `RadioManager.plan_channel_send_slot(...)`
  (`app/radio.py:329-353`), an LRU cache over a capacity discovered from the
  radio (`app/radio.py:318-323`, backed by `self.max_channels`, default `40`,
  `app/radio.py:177`, `224`).
- At connect time, `sync_and_offload_channels()` reads every populated radio
  slot into the database, then **clears** the slot on the radio
  (`app/radio_sync.py:301-351`, especially the `set_channel(... channel_name="",
  channel_secret=bytes(16))` clear at `app/radio_sync.py:332-337`). This is
  the "offload" half of the store-and-serve model
  (`AGENTS.md:97` "Extended capacity: Server stores contacts/channels beyond
  radio limits (~350 contacts, ~40 channels)"). After this runs, the radio's
  channel slots are empty until something is sent.
- `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE` (`AGENTS.md:519`,
  `app/radio.py:310-316`) disables slot-cache reuse and forces a `set_channel`
  call before every send on all transports; TCP already behaves this way
  unconditionally (`app/AGENTS.md:119` "TCP radios do not reuse cached slot
  contents").
- Channel capacity is **firmware-reported**, not hardcoded: `app/AGENTS.md:117`
  "Channel slot count comes from firmware-reported `DEVICE_INFO.max_channels`;
  do not hardcode `40` when scanning/offloading channel slots." `40` is only
  the in-memory default before `DEVICE_INFO` is read
  (`app/radio.py:177`).

**Consequence for this feature**: "apply a channel preset now" cannot reuse
an existing bulk-push function. `sync_and_offload_channels()` only clears
slots; there is no symmetric `load_channels_to_radio()`. A new function must
loop the preset's channels through `set_channel(...)`, mirroring the
slot-selection logic in `message_send.py:256-295` (or extracting it), and
must respect the firmware-reported capacity (`radio_manager.max_channels` /
`get_channel_send_cache_capacity()`, `app/radio.py:318-323`), not a fixed 40.

### 2.2 Contacts are pushed by a policy-driven background loop, not on demand

- `AGENTS.md:97`: server stores contacts beyond the radio's own limit
  (~350 contacts cited as the practical mesh-observed ceiling; the radio's own
  hardware ceiling is reported at connect as `radio_manager.max_contacts`,
  `app/radio.py:170`, consumed by `_effective_radio_capacity()`,
  `app/radio_sync.py:242-255`).
- `max_radio_contacts` (`app/models.py:1012-1018`, default `200`) is a
  configured baseline. `app/AGENTS.md:386`: "favorites reload first, the app
  refills non-favorite working-set contacts to about 80% of that capacity,
  and periodic offload triggers once occupancy reaches about 95%." Ratios are
  literal constants `RADIO_CONTACT_REFILL_RATIO = 0.80` and
  `RADIO_CONTACT_FULL_SYNC_RATIO = 0.95` (`app/radio_sync.py:235-239`).
- Favorites-first ordering and the fill/evict loop live in
  `_reconcile_radio_contacts_in_background()` (`app/radio_sync.py:1166-1490`),
  which computes `desired_fill_contacts` (favorites-first) each pass
  (`app/radio_sync.py:1198-1211`, `1243-1249`) and adds/removes contacts via
  radio commands inside that loop.
- `MESHCORE_LOAD_WITH_AUTOEVICT` (`AGENTS.md:520`) changes reconcile behavior
  to autoevict mode (sets `AUTO_ADD_OVERWRITE_OLDEST` on the radio, skips
  explicit removal, blind-fills): `app/radio_sync.py:55-79` (enable),
  `1166-1490` (autoevict branch).
- `ContactRepository.get_favorites()` / `set_favorite()`
  (`app/repository/contacts.py:476-490`) is the only existing "named group"
  primitive for contacts today - favorite is a boolean flag, not a set
  membership, so there is no existing multi-preset contact grouping to build
  on.

**Consequence for this feature**: an "apply preset now, push these N contacts
immediately" action would run alongside/ahead of a background loop that has
its own capacity and eviction policy. There is no existing "load this list of
contacts right now, synchronously" entry point analogous to the send-time
channel push; the closest primitives are the reconcile loop internals
(`app/radio_sync.py:1166-1490`) and the raw `add_contact` radio command used
inside it.

### 2.3 Disconnect / reconnect endpoints

- `POST /api/radio/disconnect` (`app/routers/radio.py:880-891`): calls
  `radio_manager.pause_connection()`, broadcasts health `false`, and pauses
  automatic reconnect. It performs no channel/contact provisioning step
  today - a "before disconnect" preset-apply hook would need to be inserted
  ahead of this call (frontend-side confirmation flow) or as a new parameter/
  pre-step on this endpoint.
- `POST /api/radio/reconnect` (`app/routers/radio.py:914-941`) and the reboot
  endpoint share `_attempt_reconnect()` (`app/routers/radio.py:852-874`),
  which calls `radio_manager.reconnect_and_prepare(...)`
  (`app/routers/radio.py:82-84`). Reconnect re-runs post-connect setup,
  which includes the channel/contact offload described in 2.1/2.2
  (`app/AGENTS.md:108`, `app/radio_sync.py:464` `sync_and_offload_all`).
  A preset applied just before disconnect is **not** persisted onto the
  radio across a reconnect by any existing mechanism beyond what the normal
  reconcile loop and channel LRU cache already do - it is a point-in-time
  push, not a standing configuration.

### 2.4 Existing app_settings storage pattern to reuse

- `app_settings` is a single-row SQLite table with one column per setting,
  several of them JSON-encoded TEXT (`app/repository/settings.py:61-148`
  parses `last_message_times`, `blocked_keys`, `known_regions`, etc. via
  `json.loads`).
- Precedent for a JSON blob **not** exposed through the main `AppSettings`
  model, with its own dedicated repository accessor and endpoint: `radio_presets`
  (migration `app/migrations/_067_add_radio_presets.py`, model
  `RadioPresetsStore` at `app/models.py:966-982`, accessor
  `AppSettingsRepository.get_radio_presets()` at
  `app/repository/settings.py:443`) and `push_conversations`
  (`app/repository/settings.py:388-438`). Both add one `TEXT DEFAULT ''`
  column via an idempotent migration that checks `PRAGMA table_info` first
  (`app/migrations/_067_add_radio_presets.py:22-25`).
- **Naming collision risk (fact, not assumption):** `RadioPresetsStore` /
  `radio_presets` already denotes **LoRa radio parameter presets**
  (frequency/bandwidth/spreading-factor/coding-rate - `RadioPresetEntry` at
  `app/models.py:958-963`), synced from `OFFICIAL_PRESETS_URL`
  (`app/routers/radio.py:50`) and rendered by
  `frontend/src/components/settings/SettingsRadioSection.tsx` and
  `frontend/src/utils/radioPresets.ts`. Calling the new feature a "preset"
  in UI/API surface without a qualifier will collide with this existing,
  unrelated term. See Section 6.
- Next free migration number on `origin/main`: **`069`** (highest existing is
  `app/migrations/_068_add_registry_sync_url.py`; verified via
  `git ls-tree -r origin/main --name-only -- app/migrations`).

### 2.5 Channel Import/Export as the reference UX (PR #9)

- `frontend/src/components/ChannelImportExportModal.tsx` implements the
  text-format contract this plan should stay compatible with: lines of
  `#name - 32-char-hex-key` (`ChannelImportExportModal.tsx:37-50` export,
  `68-102` import parsing). Backend counterparts:
  `GET /api/channels/export` and `POST /api/channels/import`
  (`app/routers/channels.py:416-557`).
- Import today is DB-only (2.1) - it does not push to the radio. It also has
  no contact component; contacts have no equivalent import/export today
  (confirmed: no `contacts/import` or `contacts/export` route in
  `app/routers/contacts.py` route list, `AGENTS.md:337-364`).

## 3. Reference research

### 3.1 Channel slot push pattern to mirror

The channel-send flow is the only place that already does "pick a slot, call
`set_channel`, record success/failure" end to end:

```
app/services/message_send.py:256-295
    radio_manager.plan_channel_send_slot(channel_key, preferred_slot=...)
        -> (slot, needs_configure, evicted_channel_key)
    if needs_configure:
        mc.commands.set_channel(channel_idx=slot, channel_name=..., channel_secret=key_bytes)
        radio_manager.note_channel_slot_loaded(channel_key, slot)
```

A preset-apply function should reuse `plan_channel_send_slot` /
`note_channel_slot_loaded` / `invalidate_cached_channel_slot`
(`app/radio.py:329-395`) rather than reimplementing slot bookkeeping, since
that cache is also consulted by the ordinary send path afterward - applying
a preset without updating the cache would cause the next channel send to
redundantly (but harmlessly) reconfigure the slot.

### 3.2 Offload/clear pattern (the inverse operation)

`sync_and_offload_channels(mc, max_channels=None)` (`app/radio_sync.py:301-351`)
iterates `range(channel_limit)` (from `get_radio_channel_limit(max_channels)`,
firmware-aware) and clears each slot with
`set_channel(channel_idx=idx, channel_name="", channel_secret=bytes(16))`. A
"replace" apply mode (Section 6) could call a similar clear pass before
loading the preset's channels, or accept the LRU cache's natural eviction if
"additive" semantics are chosen instead.

### 3.3 Contact push primitives

No standalone "add contact to radio now" service function is exposed outside
the reconcile loop; the `add_contact` radio command is called inline inside
`_reconcile_radio_contacts_in_background()` (`app/radio_sync.py:1166-1490`).
If contact bundling ships, the implementation should extract a small
reusable "stage these contacts on the radio" helper rather than duplicating
the reconcile loop's TABLE_FULL/autoevict handling
(`app/radio_sync.py:1417-1466`) inline in a new preset-apply endpoint. This
is real, non-trivial logic (retry, autoevict pass tracking, error
threshold `_MAX_AUTOEVICT_RETRIES`) - UNVERIFIED estimate of how much of it a
"push now" path actually needs, since preset-apply is a one-shot user action,
not a steady-state background policy. Needs design discussion, not just
extraction (see Section 6).

### 3.4 max_radio_contacts / ~350 contact ceiling

`AGENTS.md:97` states server-side capacity beyond radio limits is "~350
contacts, ~40 channels" as an observed practical ceiling; the enforced
runtime baseline is the configurable `max_radio_contacts` setting
(default 200, `app/models.py:1012-1018`) combined with the firmware-reported
`radio_manager.max_contacts` hardware limit
(`_effective_radio_capacity()`, `app/radio_sync.py:242-255`). Both numbers
are UNVERIFIED as hard firmware maximums beyond what's cited here; they are
this codebase's configured/observed values, not a documented MeshCore
protocol constant.

## 4. Design

### 4.1 Preset data model (proposed, not yet implemented)

Store presets as a JSON blob in `app_settings`, following the
`radio_presets` / `push_conversations` precedent (2.4) rather than a new
table, per the task's storage preference and because presets are small,
low-cardinality, single-server-scoped data with no need for relational
queries.

```python
class ChannelContactPresetChannel(BaseModel):
    key: str      # 32-char hex channel key
    name: str     # display name, "#name" or custom

class ChannelContactPresetContact(BaseModel):
    public_key: str   # full 64-char hex key
    name: str | None = None   # display-only; radio push uses public_key

class ChannelContactPreset(BaseModel):
    id: str                     # slug or uuid; stable reference for apply/delete
    name: str                   # user-facing label
    channels: list[ChannelContactPresetChannel]
    contacts: list[ChannelContactPresetContact] = []
    created_at: int
    updated_at: int

class ChannelContactPresetsStore(BaseModel):
    presets: list[ChannelContactPreset] = []
```

This mirrors `RadioPresetsStore`'s shape (a wrapper list, `app/models.py:966-982`)
and `AppSettingsRepository.get_radio_presets()` (`app/repository/settings.py:443`)
for the accessor pattern: `get_channel_contact_presets()` /
`update_channel_contact_presets(...)`, internal-only (not part of the main
`AppSettings` PATCH payload), new migration `app/migrations/_069_add_channel_contact_presets.py`
adding one `TEXT DEFAULT ''` column, following the exact idempotent-check
pattern of `_067_add_radio_presets.py:16-27`.

**OPEN QUESTION**: naming. `preset` is taken by LoRa radio-parameter presets
(2.4). Candidate alternatives: "channel set", "loadout", "provisioning set",
"quick-load set". This plan uses "preset" only as a placeholder pending a
naming decision; whatever is chosen must appear consistently in the model
name, table column, API paths, and UI copy to avoid confusion with
`RadioPresetsStore`.

### 4.2 CRUD endpoints (proposed)

Following the `/api/settings/*` toggle-style sub-resource pattern already
used for `favorites`, `blocked-keys`, `muted-channels`
(`app/AGENTS.md:312-319`, `AGENTS.md:387-394`):

- `GET /api/settings/channel-presets` - list presets.
- `POST /api/settings/channel-presets` - create from current channel
  selection (frontend passes the same `Channel[]` shape already used by
  `ChannelImportExportModal`'s "selected channels" export mode,
  `ChannelImportExportModal.tsx:294-296`).
- `DELETE /api/settings/channel-presets/{id}` - delete.
- `PATCH /api/settings/channel-presets/{id}` - rename / edit membership.

(Exact path naming depends on the Section 4.1 naming decision.)

### 4.3 Apply-now endpoint (proposed)

`POST /api/settings/channel-presets/{id}/apply` - synchronous, radio-locked
operation:

1. Acquire the radio operation lock the same way channel sends do
   (`radio_manager.radio_operation(...)`, `app/radio.py:230-286`) so this
   cannot race a send or the periodic sync loop.
2. Additive apply (per Decision above - not conditional on slice): for each
   channel in the preset, skip it if a channel with the same key is already
   loaded on the radio (dedupe against existing channels), otherwise call
   `plan_channel_send_slot` + `set_channel` + `note_channel_slot_loaded`,
   mirroring 3.1. No clear-slots-first pass is added; existing slots outside
   the preset are left untouched. Stop or continue-on-error per channel
   (UNVERIFIED which; needs a product decision - partial application without
   a clear per-channel result list would be a poor user experience for a
   "quick-load before I leave" action).
3. If the preset includes contacts and contact-bundling ships in this slice
   (see Section 5 phasing - first slice is channels-only): for each contact,
   ensure it exists in the DB (`ContactRepository`) and push it to the radio,
   respecting the capacity check pattern used by
   `_effective_radio_capacity()` (2.2) so an apply cannot silently exceed
   `max_radio_contacts` / the firmware contact ceiling.
4. Return a typed result: `{applied_channels: [...], failed_channels: [...],
   applied_contacts: [...], failed_contacts: [...]}` so the frontend can show
   partial success rather than a bare boolean, consistent with
   `ChannelImportResponse`'s counted-result shape
   (`app/routers/channels.py:79-85`).
5. Broadcast a `channel` WS event per updated channel
   (`_broadcast_channel_update`, `app/routers/channels.py:26-27`) so other
   connected clients see `on_radio` state change, and a `contact` event per
   pushed contact if contacts are included, matching existing WS event
   conventions (`app/AGENTS.md` WebSocket Events list).

### 4.4 "Before disconnect" hook (optional, per task)

Two shapes, not yet decided (OPEN QUESTION, Section 6):

- **(a) Frontend-only prompt**: `AppShell`/`SettingsRadioSection` shows a
  confirm dialog ("Apply a preset before disconnecting?") when the user
  clicks the existing disconnect action, calling the apply-now endpoint
  (4.3) before calling `POST /api/radio/disconnect`
  (`app/routers/radio.py:880-891`). No backend change to the disconnect
  route itself. Lowest risk, matches this repo's preference for frontend
  orchestration over backend side-effect chaining (no existing precedent in
  `disconnect_radio()` for calling out to unrelated subsystems).
- **(b) Backend flag**: `POST /api/radio/disconnect?apply_preset_id=...`
  applies the preset server-side before pausing the connection. Couples two
  previously-independent endpoints and duplicates error-surface handling
  (what happens if disconnect is requested but the apply partially fails?).
  Not recommended without a concrete UX reason to prefer it over (a).

This plan recommends (a) for the first slice; it needs zero changes to
`app/routers/radio.py`.

### 4.5 Typed contracts summary

New Pydantic models: `ChannelContactPresetChannel`, `ChannelContactPresetContact`,
`ChannelContactPreset`, `ChannelContactPresetsStore`, plus a
`PresetApplyResult` response model (4.3 step 4). New `AppSettingsRepository`
methods: `get_channel_contact_presets()`, `update_channel_contact_presets(...)`
- following the exact `get_radio_presets()` / internal-only pattern
(`app/repository/settings.py:443`). New frontend TS types mirroring these in
`frontend/src/types.ts`, and `api.ts` methods, per the "typed contracts at
important boundaries" ethos (`AGENTS.md:108`).

## 5. Phasing

**Slice 1 (recommended first cut): channels-only preset, additive apply.**

- CRUD for channel-only presets (4.1, 4.2 minus contacts).
- Apply-now endpoint pushes channels only (4.3 steps 1-2, 4), additive
  semantics (Decision above; Section 6 item 1 resolved as "additive" - not
  slice-1-only - since additive is strictly simpler, matches how the LRU slot
  cache already behaves for ordinary sends, and needs no new "clear first"
  code path). Existing firmware-reported ~40-slot capacity handling (2.1)
  applies unchanged, and apply dedupes against channels already on the radio
  by key.
  No new contact push helper is written in this slice.
- Frontend: a settings-section list (new component, e.g. under
  `SettingsRadioAppSection.tsx` or a new `ChannelPresetsSection`) with
  create-from-selection, rename, delete, and an "Apply now" button that
  calls 4.3 and shows the typed per-channel result.
- No disconnect-hook UI yet.

**Slice 2: contacts in presets.**

- Extend the model with `contacts` (already defined in 4.1 so slice 1
  storage does not need a breaking migration later).
- Extract a reusable "push these contacts to the radio, respecting capacity"
  helper distinct from the steady-state reconcile loop (3.3).
- Apply-now endpoint pushes contacts too (4.3 step 3).

**Slice 3: before-disconnect hook.**

- Frontend confirm-and-apply flow (4.4a) wired to the existing disconnect
  button.

Rationale for this order: channels-only apply is the smallest change that
delivers the "load a working channel set" value in the task description,
uses only already-understood primitives (3.1), and avoids the
capacity/eviction policy questions in Section 6 that block a confident
contacts design.

## 6. Risks / open questions

1. **Additive vs. replace-slots - RESOLVED (2026-09-10, user): additive.**
   Apply loads the preset's channels into free/LRU-selected slots via the
   existing cache (3.1), leaving whatever else is already resident, and
   dedupes against channels already loaded on the radio (by key) rather than
   redundantly reconfiguring them. No "replace" mode (clearing all radio
   channel slots first, 3.2 pattern) is built - that would risk evicting a
   channel the operator is mid-conversation on and didn't intend to drop, and
   would duplicate the offload-clear code path outside its current
   connect-time-only usage. This applies across slices, not just slice 1.
   The existing firmware-reported ~40-slot capacity handling (2.1) is
   unchanged by this decision.
2. **Contact push capacity.** If a preset's contact list plus whatever the
   background reconcile loop is currently maintaining exceeds
   `max_radio_contacts` / firmware capacity, apply must not exceed the same
   ceiling the reconcile loop respects, or the two mechanisms will fight
   (reconcile evicting what preset-apply just loaded, or vice versa). No
   existing "coordinate a one-shot push with the steady-state loop" pattern
   to reuse (3.3) - needs its own design pass in slice 2, not assumed to be
   a small addition.
3. **Radio slot failure/partial-apply UX.** `set_channel` can return
   `EventType.ERROR` (as it already does in the send path,
   `app/services/message_send.py:282-294`). An apply-now action touching up
   to ~40 channels needs a clear partial-success contract (4.3 step 4) so
   the user isn't left unsure which channels actually loaded before
   disconnecting.
4. **Naming collision with `RadioPresetsStore`** (2.4, 4.1). Must be
   resolved before any migration/model is written, since the column name and
   API paths are hard to rename later without a follow-up migration.
5. **Preset staleness across reconnect.** Per 2.3, applying a preset does
   not make it "sticky" - a later reconnect's `sync_and_offload_all` /
   periodic reconcile can still evict or reconfigure slots per existing
   policy. This is a point-in-time push, not a standing configuration; the
   feature description ("load a working channel set before disconnecting")
   is consistent with this, but the UI copy must not imply persistence
   beyond that.
6. **Contact identity for cross-device presets.** A preset created on one
   server instance references contacts by `public_key`; if the target radio
   has never heard that contact's advertisement, the DB may have no row for
   it and nothing to push (a contact must exist in `contacts` to be
   radio-pushable via the reconcile pattern, 3.3). UNVERIFIED whether the
   apply endpoint should silently skip such contacts or surface them as a
   distinct "not available" result category - needs product input.

## 7. Verification plan

**Backend tests** (new, following existing suite conventions,
`app/AGENTS.md` Testing section):

- `tests/test_settings_router.py` or a new `tests/test_channel_presets.py`:
  CRUD round-trip (create/list/rename/delete) against
  `AppSettingsRepository.get_channel_contact_presets()` /
  `update_channel_contact_presets(...)`.
- Apply-now endpoint test with a mocked `MeshCore` (matching the mocking
  pattern in `tests/test_send_messages.py` for `set_channel`/`send_chan_msg`):
  assert `plan_channel_send_slot` / `note_channel_slot_loaded` are exercised
  per channel, and that a `set_channel` `EventType.ERROR` produces a
  per-channel failure entry rather than aborting the whole apply.
  UNVERIFIED whether abort-on-first-error or continue-on-error is correct
  until Section 6 item 3 is resolved with the user.
- Migration test following the pattern implied by `_067_add_radio_presets.py`
  (idempotent add-column, default value) - check whether existing migration
  tests cover this file-by-file or via a full-migration-chain test
  (UNVERIFIED; not located during this research pass - confirm location in
  `tests/` before writing).

**Frontend tests** (Vitest, `frontend/AGENTS.md` Testing section):

- New settings-section component test (list/create/apply/delete), following
  the pattern of `frontend/src/test/settingsModal.test.tsx`.
- `api.ts` method tests following `frontend/src/test/api.test.ts` conventions.

**Live radio observation (required per repo rule - compiling/tests are not
proof of runtime behavior):**

- Create a preset with 2-3 channels not currently loaded on the radio, call
  apply-now, and confirm via a direct `get_channel` probe (or the existing
  `GET /api/debug` slot/channel audit, `app/AGENTS.md:236`) that the radio's
  slots actually contain the expected name/key - not just that the backend
  returned 200.
- Repeat on both a serial/BLE connection and a TCP connection, since TCP
  forces `set_channel` before every send unconditionally
  (`app/AGENTS.md:119`) and may behave differently under a bulk apply.
- If slice 2 ships, verify a contact preset apply against radio contact count
  (`get_contacts`) before/after, and confirm it does not fight the periodic
  reconcile loop within one `SYNC_INTERVAL` (300s, `app/radio_sync.py:233`).

## 8. Effort

- **Slice 1 (channels-only CRUD + additive apply)**: Sonnet-scoped, moderate.
  New migration + model + repository accessor (small, precedented, 2.4) +
  one new router with 4-5 endpoints (precedented pattern) + one new frontend
  settings section reusing existing list/modal UI conventions
  (`ChannelImportExportModal.tsx` styling, `SettingsRadioAppSection.tsx`
  layout conventions). Main risk is the OPEN QUESTION in Section 6 item 1
  needing a decision before the apply endpoint's core loop is final.
- **Slice 2 (contacts)**: larger than slice 1 - requires extracting/adapting
  nontrivial reconcile-loop logic (3.3) rather than reusing a small existing
  function, plus resolving the capacity-coordination open question
  (Section 6 item 2). Recommend re-scoping with fresh research once slice 1
  ships and the reconcile-loop interaction is better understood in practice.
- **Slice 3 (disconnect hook)**: small, frontend-only if 4.4(a) is chosen.
