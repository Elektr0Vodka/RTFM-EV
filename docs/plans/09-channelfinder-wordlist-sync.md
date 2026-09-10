# [09] Channel-finder wordlist sync

Status: local planning document. No code changes, no commits, no issues/PRs.
Reconciles with `docs/plans/README.md` entry [09] and `docs/sources-of-truth.md`.

## 1. Summary

RTFM-EV's browser-based channel finder (`CrackerPanel.tsx`) tries to recover
hashtag-channel keys for undecrypted GroupText packets by brute-forcing/dictionary
attacking candidate channel names on the GPU. Its entire dictionary today is a
single hardcoded import: the `ENGLISH_WORDLIST` bundled inside the
`meshcore-hashtag-cracker` npm package (`frontend/src/components/CrackerPanel.tsx:92-96`).
There is no way to add MeshCore-specific candidate names (Dutch/German/Belgian
place names, previously-observed hashtags, community channel catalogs) without
publishing a new build of that npm package.

RTFM-EV already ships one remote-list sync feature with the right shape to copy:
the Channel Registry sync (`app_settings.registry_sync_url` plus `GET /api/registry/sync`
server-side proxy plus client-side add-missing-only merge into a localStorage-backed
list). This plan designs an analogous **wordlist sync**: a configurable source URL
(or URLs), a local cache of synced candidate names, a merge with the bundled
`ENGLISH_WORDLIST`, and a settings UI to trigger/inspect it.

A key finding from the reference research (section 3): the `meshcore-hashtag-cracker`
library's `setWordlist()` **replaces** its internal wordlist rather than merging, so
the merge step must happen client-side, once, before the single `setWordlist()` call.
A second key finding: the reference repo (`mccl`) that the brief names as the
wordlist source is actually a **name-to-key rainbow table**, structurally identical to
the Channel Registry sync payload, not a plain word list. This raised a real design
question, resolved by the user (see Decision below): consume it as names only, fed
into the wordlist merge — the keys are auto-derived by the cracker, not read
directly from the rainbow table.

## Decision (2026-09-10, user)

Resolves open question 6a: the `mccl` rainbow table (name to key) is consumed
as **names only**, fed into the cracker's wordlist merge (section 4). It is
not treated as a second, direct-key registry-style sync source. Channel keys
for names discovered this way are auto-derived by the cracker as
`SHA256("#name")[:16]` (the same derivation already used elsewhere, `AGENTS.md`
"Channel Keys", section 2's `_normalize_bulk_hashtag_name`), same as any other
wordlist candidate that cracks successfully. This confirms option (i) in
section 6a as the design going forward, not (ii) or (iii).

## 2. Current state (facts, cited)

- The cracker component is `frontend/src/components/CrackerPanel.tsx`. It imports
  `GroupTextCracker` from the `meshcore-hashtag-cracker` npm package
  (`frontend/src/components/CrackerPanel.tsx:2`), pinned at `^1.11.0` in
  `frontend/package.json:38`.
- The wordlist is loaded once, lazily, the first time the panel becomes visible:
  ```
  import('meshcore-hashtag-cracker/wordlist')
    .then(({ ENGLISH_WORDLIST }) => {
      if (crackerRef.current) {
        crackerRef.current.setWordlist(ENGLISH_WORDLIST);
        setWordlistLoaded(true);
      }
    })
  ```
  (`frontend/src/components/CrackerPanel.tsx:92-104`). This is a **static, bundled**
  JS module, not a runtime-fetched file: the array ships inside the npm package
  and only changes when the dependency version is bumped.
- There is no local wordlist file, override mechanism, or server endpoint for
  candidate names anywhere in `app/` or `frontend/src` today. `git grep -rin
  "wordlist"` across `frontend/src` only matches `CrackerPanel.tsx` (verified:
  the only other "wordlist"-adjacent code is `channelManager.ts`'s registry sync,
  which deals in channel *name+key pairs*, not word candidates).
- Verified against the published package (`npm pack meshcore-hashtag-cracker@1.11.0`,
  extracted to inspect `dist/cracker.js` since `frontend/node_modules` is not
  installed in this worktree):
  - `GroupTextCracker.setWordlist(words: string[])` **replaces** `this.wordlist`
    (lowercases and filters to `[a-z0-9-]+`, no leading/trailing/double dash).
    Calling it a second time with a different array discards the first.
  - `GroupTextCracker.loadWordlist(url: string)` is a second, already-existing
    library method: an async `fetch(url)` that reads a **plain-text file, one
    candidate per line**, lowercases/filters it the same way, and also
    **replaces** `this.wordlist`. RTFM-EV's `CrackerPanel.tsx` does not currently
    call this method anywhere (`git grep -n "loadWordlist" frontend/src` finds no
    matches). This is a real, already-shipped alternative to hand-rolling a fetch
    plus merge plus `setWordlist()` call, discussed in section 4.
- The bulk channel-creation endpoint the cracker calls into on a hit is
  `POST /api/channels/bulk-hashtag` (`app/routers/channels.py:270`), which
  normalizes each name (`_normalize_bulk_hashtag_name`, `app/routers/channels.py:133-148`)
  and derives the key as `SHA256("#" + name)[:16]` per `AGENTS.md` section "Channel Keys"
  (`AGENTS.md:427-434`). `CrackerPanel.tsx` itself uses the single-channel
  `onChannelCreate` prop, not the bulk endpoint, when it cracks a key
  (`frontend/src/components/CrackerPanel.tsx:349-360`).

## 3. Reference research (cited)

### 3a. Channel Registry sync: the template to mirror

- Storage: `app_settings.registry_sync_url` (TEXT, default `''`), added by
  `app/migrations/_068_add_registry_sync_url.py`. Idempotent column-add migration
  guarded by a `PRAGMA table_info` check.
- Pydantic surface: `AppSettings.registry_sync_url` (`app/models.py:1098-1101`) and
  the corresponding optional field on the update model
  (`app/routers/settings.py:98-101`). Repository read/write wiring is in
  `app/repository/settings.py:47, 148-152, 171, 194, 268-270, 304, 326`.
- Server proxy: `GET /api/registry/sync` (`app/routers/registry.py:22-75`). It reads
  `registry_sync_url` from settings, 400s if empty, fetches with `httpx` (10s
  timeout, follow redirects), 502s on transport/HTTP/JSON-shape errors, and
  returns a normalized `SyncChannel[]` (`{name, key}`) built from a flat
  `{name: key}` JSON object. The endpoint's docstring is explicit about the
  expected remote shape (`app/routers/registry.py:24-31`).
- Frontend client: `api.syncRegistry()` (`frontend/src/api.ts:363-364`) hits that
  proxy.
- Client-side merge: `addMissingFromSync()` (`frontend/src/lib/channelManager.ts:222-246`)
  is **add-missing-only**: it never touches or overwrites an existing local
  entry, only appends synced entries whose name is not already present (case-
  insensitive). The registry itself is a flat array persisted to
  `localStorage['meshcore-channel-registry']` (`frontend/src/lib/channelManager.ts:30, 61-72`).
  There is no size cap on this list today (`git grep` found none).
- UI: `ChannelRegistryView.tsx`'s `handleSync()` (`frontend/src/components/ChannelRegistryView.tsx:930-948`)
  calls `api.syncRegistry()`, merges via `addMissingFromSync`, toasts the added
  count or "Already up to date.", and reports errors via `err.message`. The sync
  URL itself is configured in Settings > Database
  (`frontend/src/components/settings/SettingsDatabaseSection.tsx:212-238`), a
  plain `<Input type="url">` that persists on blur via `persistAppSettings`.

This is a clean, small template: **one settings URL field, one thin server GET
proxy (for CORS/consistency, not because the payload needs server processing),
one client-side add-only merge, one manual "Sync" button**. No background or
scheduled sync exists for the registry today; it is entirely user-triggered.

### 3b. `mccl` (`Elektr0Vodka/MCCL`, local `G:\Github\repositories\Elektr0Vodka\mccl`)

- Only content: `list_nl/channel-rainbow.json`, 1244 lines, e.g.:
  ```json
  { "#0000": "485dfbaa9af4c43cdebe57cbde246db3", "#024-bot": "f5920e8b7ba3573602eac69d4daa13bf", ... }
  ```
  This is a **flat `{name: key}` object**, structurally *identical* to the shape
  `GET /api/registry/sync` already expects (`app/routers/registry.py:26-27`), not
  a plain-text word list. Git history (`git log --oneline`) shows small, frequent
  "Added N channels" commits: this is a community-maintained, growing rainbow
  table of known channel name-to-key pairs, not curated dictionary prose.
- Because the key is a deterministic `SHA256("#"+name)[:16]` hash, an entry in
  this file already tells you the *exact* key for a *known* name; it does not
  need to be run back through a GPU brute-force/dictionary search. Using it as a
  candidate list for `CrackerPanel` (rather than a direct-key lookup, similar to
  the registry) is a real design fork; see the open question in section 6.

### 3c. `EV_Channelfinder` and `MC-Channel-Finder` (server-side reference crackers)

Both local repos (`G:\Github\repositories\Elektr0Vodka\EV_Channelfinder`,
`G:\Github\repositories\Elektr0Vodka\MC-Channel-Finder`) appear to be the same
FastAPI-based standalone cracking service (same file layout, same
`app/cracker*.py`, `app/channel_registry.py`, `data/wordlists/` set; this plan
did not diff them further and treats findings as applying to both.
**UNVERIFIED** whether MC-Channel-Finder has diverged). Unlike RTFM-EV's
browser-only cracker, they run continuously against a remote analyzer packet
feed (`sources.md`: `GET https://meshcore-analyzer.eu/api/packets?type=GroupText`)
rather than the local radio's own overheard packets.

- Wordlist format: **plain text, one lowercase `[a-z0-9-]+` candidate per line, no
  `#` prefix.** Confirmed from `data/wordlists/*.txt`:
  - `meshcore-wordlist.txt`: 6,936,624 lines, the *merged* output (Dutch/German/
    Belgian place names, wiki neighborhoods, etc.)
  - `marcelverdult_channels.txt`: 823 lines (channel-catalog-derived names)
  - `observed_hashtags.txt`: 1,045 lines (names the tool has actually cracked/
    seen, e.g. `saarland`, `mc-radar`, `wetter`)
- Build pipeline: `scripts/build_meshcore_wordlist.py` merges every `*.txt` in
  `data/wordlists/` (plus files named in `config.ini`'s `[cracker] wordlists =`
  key) into one deduplicated, normalized file. Normalization
  (`_candidate_variants`, script lines ~186-206) does NFKD-fold plus lowercase,
  replaces `&` with `en`, strips apostrophes, collapses non-alnum runs to `-`,
  and also emits a no-dash variant and a direction-suffix-stripped variant
  (`noord`/`zuid`/`oost`/`west`/etc.). The script **seeds from the existing
  merged output by default** so a rebuild can only add candidates, never drop
  them (`--fresh` opts out of that safety net).
- Sourcing is documented in `sources.md`: the MCCL rainbow list is explicitly
  used for "rainbow import" (i.e., direct name-to-key lookup, matching section 3b's
  reading), while the *word-candidate* wordlist is sourced separately from
  `marcelverdult/meshcore-channels` (`channels-unique.json`, CC0-1.0) plus
  several `scripts/generate_*_wordlist.py` generators (Belgian municipalities,
  German regions, Dutch Wikipedia neighborhoods, etc.).
- `app/channel_registry.py`'s `.candidates()` method (lines ~72-83) *also* feeds
  registry entries' bare names (rainbow-table names, with `#` stripped) into the
  cracker's candidate list, so this reference implementation does use rainbow-
  table names as wordlist candidates in addition to direct key lookup, despite
  the redundancy noted in 3b. This is a convenience (reuse of one search
  pipeline for both known and unknown packets), not a technical requirement.
- Round-trip: `app/github_publisher.py` plus `config.example.ini`'s `[github]`
  section show this reference tool **pushes newly-discovered channels back**
  to `Elektr0Vodka/MCCL` (`repo = Elektr0Vodka/MCCL`, `path =
  list_nl/channel-rainbow.json`), add-only, via the GitHub API. RTFM-EV's
  Channel Registry sync has no equivalent push-back today, and this plan does
  not propose adding one (out of scope; see section 6).
- Both reference repos also expose `GET /api/wordlists` and
  `GET /api/wordlists/{name}/download` (`app/routes/wordlists.py`), which simply
  list/serve the `.txt` files in `data/wordlists/`. This is the shape a curated
  "wordlist source URL" for RTFM-EV to point at would plausibly look like if
  self-hosted, or these files could be served as static raw GitHub URLs.

## 4. Design

### 4a. Scope decision (grounded in section 3)

RTFM-EV's cracker only needs to *discover names for packets whose key it does
not have*. A synced rainbow-table entry (name+key, e.g. from `mccl`) is strictly
more useful applied as a **direct trial-decrypt against a known key** than as a
GPU wordlist candidate, because the key is already known; no brute force
needed. A synced plain-word list (e.g. an EV_Channelfinder-style merged
`meshcore-wordlist.txt`, or a raw text file hosted anywhere) is the correct fit
for extending `ENGLISH_WORDLIST`.

This plan scopes to the latter, extending the GPU cracker's candidate-name
wordlist from a plain-text or `{name}`-array source, because that is what
"wordlist sync" means literally and because a rainbow-table-as-direct-key-check
feature would overlap heavily with the already-shipped Channel Registry (a
synced registry entry's key could already be tried directly against undecrypted
packets without touching the cracker at all). **RESOLVED (see Decision above,
2026-09-10, user):** when a rainbow-table source like `mccl` is used, only its
names are consumed into the wordlist merge; it is not wired up as a second
direct-key registry-style sync target. Keys for names that crack successfully
are derived by the cracker's existing `SHA256("#name")[:16]` logic, same as any
other wordlist hit.

### 4b. Data model

New `app_settings` column, mirroring `registry_sync_url` exactly:

```
wordlist_sync_url TEXT NOT NULL DEFAULT ''
```

Migration file: `app/migrations/_069_add_wordlist_sync_url.py` (069 is the next
free number; `_068_add_registry_sync_url.py` is the current highest migration on
this branch and on `origin/main`, verified via `git ls-tree origin/main
app/migrations` and `ls app/migrations`, both agree). Same idempotent
`PRAGMA table_info` guard as `_068`.

`AppSettings.wordlist_sync_url: str = Field(default="", description=...)` added
next to `registry_sync_url` in `app/models.py`. Corresponding optional field on
`AppSettingsUpdate` in `app/routers/settings.py`, and read/write wiring in
`app/repository/settings.py` following the exact same four touch points used for
`registry_sync_url` (SELECT column list, row-parsing default, upsert kwargs,
UPDATE clause).

Open question: single URL, or a list (mirroring `known_regions: list[str]`)?
Section 6b covers this; the recommendation below assumes a single URL for
parity with `registry_sync_url`, extensible later.

### 4c. Server proxy endpoint

New route, same shape as `registry.py`, in a new `app/routers/wordlist.py` (or
folded into `registry.py` as a second endpoint under the same router: a
"registry ethos" call given both are thin remote-JSON proxies. Recommend a
second endpoint in the *same* router file since `app/AGENTS.md`'s code ethos
prefers fewer, stronger modules over many thin files):

```
GET /api/registry/wordlist-sync
```

Behavior mirrors `sync_registry()` exactly, except the expected remote payload
is a **JSON array of strings** (not a `{name: key}` object), since that is the
simplest format a curated source (raw GitHub text-to-JSON, or a purpose-built
export) can produce and the frontend can merge directly into `ENGLISH_WORDLIST`.
Reject with the same 400 (no URL configured) / 502 (unreachable or
unexpected format) semantics as `registry.py:35-66`. Cap the accepted payload
size server-side (e.g. reject anything over some N MB / N entries) since
`EV_Channelfinder`'s own merged wordlist is 6.9M lines; an unbounded proxy
fetch-and-re-serve is a real DoS/memory risk on a small self-hosted backend. Exact
cap is an open question (6c) since RTFM-EV has no existing precedent for size-
limiting a synced list.

### 4d. Client-side cache and merge

New module `frontend/src/lib/wordlistSync.ts`, parallel to `channelManager.ts`:

- `loadSyncedWordlist(): string[]` / `saveSyncedWordlist(words: string[]): void`,
  localStorage-backed, new key e.g. `meshcore-wordlist-sync-cache`, following
  the exact `try { JSON.parse(...) } catch { return [] }` pattern at
  `frontend/src/lib/channelManager.ts:61-68`.
- `api.syncWordlist()` in `api.ts`, mirroring `syncRegistry()`
  (`frontend/src/api.ts:363-364`), hitting the new proxy and returning
  `{ words: string[] }`.
- Merge is **replace-the-cache, not append-forever**: each sync call stores the
  exact synced array (deduplicated, normalized) as "the current synced set",
  distinct from a separate "user additions" list the operator can hand-edit
  (parity with the registry's manual-add path in `channelManager.ts`'s
  `addManualChannel`). This avoids an ever-growing local list across repeated
  syncs of an updated upstream file, which is a real risk given upstream lists
  can shrink/rename entries; `addMissingFromSync`'s add-only semantics work for
  the registry's per-channel metadata (nothing to shrink safely) but would be
  wrong here (stale entries never removed). This is a deliberate design
  divergence from the Channel Registry template, called out because the
  brief's "mirror the pattern" instruction and the actual data shape (a bulk,
  replaceable dictionary vs. individually-owned metadata records) pull in
  different directions.
- User-added custom words (typed manually in a settings textarea, e.g. local
  jargon) persist in a **third**, always-preserved localStorage list
  (`meshcore-wordlist-custom`), never touched by sync.
- At `CrackerPanel.tsx`'s existing wordlist-load effect
  (`frontend/src/components/CrackerPanel.tsx:88-105`), build the final array as
  `dedupe([...ENGLISH_WORDLIST, ...syncedWordlist, ...customWords])` and call
  `crackerRef.current.setWordlist(merged)` **once**, critical given
  `setWordlist()`'s replace-not-append semantics confirmed in section 2. Do not
  call `loadWordlist(url)` directly against the user's configured sync URL as a
  shortcut: that would bypass the merge with `ENGLISH_WORDLIST` and any custom
  words (loadWordlist also replaces), and would also send the arbitrary
  operator-supplied URL to `fetch()` directly from the browser, reintroducing
  the CORS/SSRF-shape concerns the existing registry proxy exists to avoid
  (assumption; see 6d).

### 4e. UI

- Settings > Database gets a new subsection "Channel Finder Wordlist", parallel
  to the existing "Channel Registry" block
  (`frontend/src/components/settings/SettingsDatabaseSection.tsx:212-238`):
  a `wordlist_sync_url` URL input persisting on blur via `persistAppSettings`,
  plus a "Sync now" button and a count of currently-cached synced words.
- `CrackerPanel.tsx` gains a small status line (already has "Loading
  wordlist..." at line 625-629) showing effective wordlist size (bundled plus
  synced plus custom) so operators can see the sync took effect.
- Optional: a textarea for custom words, following the settings-UI conventions
  documented in `frontend/AGENTS.md` section "Canonical style reference"
  (`frontend/AGENTS.md:487-499`).

### 4f. Typed contracts

- Backend: `WordlistSyncResponse(BaseModel)` with `words: list[str]`, mirroring
  `SyncResponse`/`SyncChannel` in `app/routers/registry.py:13-19`.
- Frontend: extend `types.ts`'s `AppSettings`/`AppSettingsUpdate` interfaces with
  `wordlist_sync_url` next to the existing `registry_sync_url` entries
  (`frontend/src/types.ts:445, 461`).

## 5. Phasing

1. Backend: migration `_069_add_wordlist_sync_url.py`, `AppSettings` /
   `AppSettingsUpdate` field, repository wiring, `GET /api/registry/wordlist-sync`
   proxy endpoint with size cap. Backend tests mirroring
   `tests/test_settings_router.py` (registry_sync_url coverage): inspect that
   file for the exact registry test pattern before writing new ones (not read in
   this pass; flagged for the implementer).
2. Frontend data layer: `wordlistSync.ts` (cache read/write, merge helper),
   `api.syncWordlist()`, `types.ts` additions. Unit tests parallel to
   `frontend/src/test/channelManager.test.ts`.
3. Frontend wiring: `CrackerPanel.tsx` merge-and-`setWordlist()` change, Settings
   UI subsection, sync button plus toasts. Update `frontend/src/test/crackerPanel.test.tsx`.
4. Docs: update `frontend/AGENTS.md` (wordlist section) and `app/AGENTS.md` (API
   Summary table row) once implemented; not part of this planning pass.

Each phase is independently shippable; phase 1 alone (settings plus proxy, no
frontend consumption yet) is a safe, reviewable first slice, matching how the
Channel Registry sync's `registry_sync_url` column and endpoint could in
principle land before the UI (though in that case they shipped together per
PR #14 referenced in `docs/plans/README.md:135`).

## 6. Risks and open questions

- **6a. Rainbow-table vs. wordlist semantics — RESOLVED (2026-09-10, user).**
  `mccl`, the repo the task brief names as *the* source, is a name-to-key
  table, not a word list (section 3b). **Decision: option (i)** - extract just
  the names from such a source and feed them into the wordlist merge described
  in section 4; the channel keys are auto-derived by the cracker
  (`SHA256("#name")[:16]`), so `mccl` is not wired up as a second, direct-key
  Channel-Registry-style sync target (option ii) and there is no dual-mode
  (iii). This accepts the "loses the free key, forces a re-crack" trade-off
  noted below in exchange for staying literally scoped to "wordlist sync" and
  avoiding overlap with the already-shipped Channel Registry sync.
- **6b. Single URL vs. list of URLs.** `registry_sync_url` is a single string.
  A wordlist is more likely to want multiple curated sources merged (e.g. an
  English list plus a regional list), closer to `known_regions: list[str]`. Section
  4b assumes single-URL parity with the shipped template; confirm this is
  acceptable before implementing, since it constrains operators to one source
  or a manually pre-merged file.
- **6c. Size limits are unspecified.** EV_Channelfinder's own merged wordlist is
  6.9M lines, tens of MB. RTFM-EV has no existing precedent for bounding a
  synced remote payload (the Channel Registry sync has no size cap either,
  `app/routers/registry.py:22-75`, but channel lists are inherently much
  smaller than word lists). A concrete cap (entry count and/or byte size) must
  be chosen for both the server proxy and the client `localStorage` cache
  (`localStorage` is typically capped around 5-10MB per origin in browsers.
  UNVERIFIED whether that is a hard ceiling in all target browsers, but it is a
  real constraint the design must not silently exceed). Recommend capping the
  synced set at a low thousands of entries and rejecting larger sources with a
  clear error, but this is a proposal, not a verified requirement.
- **6d. Why does the registry sync use a server proxy at all?** This plan
  assumes (by analogy, not by a code comment found in `registry.py`) that the
  server-side proxy exists to sidestep browser CORS restrictions on arbitrary
  user-supplied URLs and/or to keep the configured source URL server-side
  rather than client-exposed. No comment in `app/routers/registry.py` states
  this rationale explicitly. **Flagged as an assumption**, not a verified
  fact. If the real reason is something else, the wordlist proxy's justification
  should be revisited too.
- **6e. `EV_Channelfinder` / `MC-Channel-Finder` divergence unverified.** This
  plan treated both repos as structurally identical based on file listing; it
  did not diff their `app/cracker*.py` contents. If they have diverged
  meaningfully, section 3c's findings should be re-verified against whichever
  one is the actively maintained source before implementation.
- **6f. No push-back / round-trip.** Unlike the reference `github_publisher.py`,
  this plan is pull-only, matching the Channel Registry's existing scope. If
  the intent was for RTFM-EV to also contribute newly-cracked names back
  upstream (to `mccl` or elsewhere), that is a materially larger feature
  (GitHub API token storage, write scope, rate limiting) not designed here.
- **6g. Bundle vs. runtime fetch trade-off.** Section 4d recommends a single
  merged `setWordlist()` call rather than the library's own `loadWordlist(url)`
  convenience method, specifically to preserve the merge with `ENGLISH_WORDLIST`
  and custom words. Confirm this trade-off (one extra fetch plus JSON round-trip
  through the RTFM-EV backend, vs. the simpler but replace-only `loadWordlist`)
  is acceptable before implementing.

## 7. Verification plan

Once implemented, verify with independent checks (per repo policy: do not
claim "done" without these):

1. Backend: `PYTHONPATH=. uv run pytest tests/test_settings_router.py
   tests/test_repository.py -v` (or wherever the new tests land) to confirm the
   migration, model field, and proxy endpoint behave like the registry
   equivalents (400 on empty URL, 502 on unreachable/bad-shape source, 200 with
   normalized array on success).
2. Frontend: `cd frontend && npm run test:run` covering `wordlistSync.ts` merge
   logic (dedupe, replace-not-append semantics, custom-word preservation) and
   the updated `CrackerPanel.tsx` wordlist-load effect.
3. Manual/browser verification (per "runtime behavior must be observed, not
   reasoned about"): open the app in a real browser, set a wordlist sync URL
   pointing at a small test JSON array, click Sync, confirm the cracker's
   status line reflects the increased candidate count, and confirm a
   known-name/known-key test packet cracks using a word only present in the
   synced set (not in bundled `ENGLISH_WORDLIST`).
4. `./scripts/quality/all_quality.sh` before considering the change complete,
   per `AGENTS.md`'s standing instruction for non-docs changes.

## 8. Effort

Sonnet-scoped, matching `docs/plans/README.md`'s assignment for [09]. Backend
slice (migration plus model plus proxy) is small and mechanical, closely copying
`_068`/`registry.py`. Frontend slice (cache module, merge-before-`setWordlist`,
settings UI) is moderate; the main complexity is the three-way merge (bundled,
synced, custom) and getting the replace-vs-append semantics right, not new
architecture. Total: comparable to or slightly larger than the shipped Channel
Registry sync (PR #14), given the extra merge-source bookkeeping in section 4d
that the registry template did not need.
