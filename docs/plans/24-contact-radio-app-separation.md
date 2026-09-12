# [24] Separate radio vs app contact management

Date: 2026-09-12
Status: draft for review
Category: B (Contacts & messaging UX) / radio sync, see `docs/plans/README.md`
Model: Opus
State: Partial (extends the existing automatic radio-sync selection with a new
per-contact policy dimension; adds derived residency reporting and a capacity
surface). No code changes, no migrations, no commits/PRs/issues from this
document.

Scope: local planning only.

## 1. Summary

Today the app stores an unbounded number of contacts, while the physical radio
holds only a bounded working set chosen automatically. There is **no
user-facing control over which contacts occupy the radio**, and **no accurate
indicator of which contacts are on the radio right now**. The only levers are
the `favorite` flag (which forces sync priority as a side effect) and the
`max_radio_contacts` capacity setting. The `contacts.on_radio` column exists
but is explicitly deprecated: it is cleared on every offload/reload cycle
because it drifted stale (`app/radio_sync.py:478-480`, comment: "Contact
on_radio is legacy/stale metadata... so old rows stop claiming radio residency
we do not actively track").

This plan adds an explicit, mutually-exclusive per-contact **radio policy**
(`auto` / `pinned` / `excluded`), makes the radio-sync selection honor it,
reports live residency as a **derived** value (not a revived stale flag), and
surfaces radio occupancy. It is phased so each slice ships independently.

Decided during the 2026-09-12 brainstorm (recorded here, not re-litigated):

- Four capabilities in scope: (1) see what is on the radio, (2) pin a contact
  to the radio, (3) exclude a contact from the radio (app-only), (4) surface
  capacity/occupancy.
- Data model is a **single enum column** `radio_policy`, not two booleans and
  not a revived `on_radio` (Section 3.1, Approach A).
- **Exclude wins over favorite** for sync selection: a contact that is both
  `favorite` and `radio_excluded` is not pushed to the radio. `favorite`
  continues to drive sidebar/UI grouping unchanged (Section 6, Q1).
- Phases run in dependency order (Section 4), not reordered by a single
  driving pain.

## 2. Current state (cited)

### 2.1 The app stores all contacts; the radio holds a computed subset

- No insertion-time contact cap. `ContactRepository.get_all(limit, offset)`
  (`app/repository/contacts.py:285-293`) uses `limit` for pagination only.
- Radio residency is **computed at sync time** by
  `get_contacts_selected_for_radio_sync()` (`app/radio_sync.py:1532-1589`).
  Fill order:
  1. Favorites, up to full effective capacity
     (`app/radio_sync.py:1546-1556`, via `ContactRepository.get_favorites()`,
     `app/repository/contacts.py:475-483`).
  2. Most recently DM-active non-repeaters, up to the 80% refill target
     (`app/radio_sync.py:1558-1568`,
     `get_recently_dm_active_non_repeaters`).
  3. Most recently advertised non-repeaters, up to the refill target
     (`app/radio_sync.py:1570-1580`,
     `get_recently_advertised_non_repeaters`).
- Effective capacity is `min(configured max_radio_contacts, hardware
  radio_manager.max_contacts)` (`_effective_radio_capacity`,
  `app/radio_sync.py:243-256`). Refill target is 80% and full-offload trigger
  is 95% of that (`RADIO_CONTACT_REFILL_RATIO` / `RADIO_CONTACT_FULL_SYNC_RATIO`,
  `app/radio_sync.py:236-240`; `_compute_radio_contact_limits`, `:259-267`).

### 2.2 `contacts.on_radio` is deprecated, not a truth source

- Column exists: `contacts.on_radio INTEGER DEFAULT 0`
  (`app/database.py:30`), modeled as `Contact.on_radio: bool = False`
  (`app/models.py:113`), read in `_row_to_contact`
  (`app/repository/contacts.py:178`), exposed to the frontend
  (`frontend/src/types.ts:205`, `:285`).
- It is **not maintained**. `sync_and_offload_all` clears it wholesale each
  cycle: `await ContactRepository.clear_on_radio_except([])`
  (`app/radio_sync.py:478-480`;
  `ContactRepository.clear_on_radio_except`, `app/repository/contacts.py:460-473`).
  New contacts are upserted with `on_radio=False`
  (`app/event_handlers.py:239`). So the column is effectively always 0 for
  contacts after a sync cycle and cannot answer "is this contact on the
  radio right now."
- Contrast: **channels** do maintain `on_radio` accurately
  (`app/repository/channels.py:9-21`, read at `:43`, `:68`), so channels
  already have a real app-vs-radio split that contacts lack.

### 2.3 The "would be synced" set is already computable, only exposed in debug

- `get_contacts_selected_for_radio_sync()` returns the exact set that would be
  loaded now. It is already imported and called by the debug router
  (`app/routers/debug.py:16`, `:303` `expected_contacts = await
  get_contacts_selected_for_radio_sync()`). There is no non-debug endpoint and
  no per-contact reason surfaced.

### 2.4 Capacity is partially surfaced

- Health exposes the hardware limit only:
  `radio_device_info.max_contacts` (`app/routers/health.py:143-149`,
  `getattr(radio_manager, "max_contacts", None)`), rendered with a warning
  when the configured value exceeds it
  (`frontend/src/components/settings/SettingsRadioSection.tsx:1748-1753`).
- Live occupancy (how many contacts are actually on the radio now) is computed
  transiently inside `should_run_full_periodic_sync`
  (`app/radio_sync.py:270-297`, `current_contacts = len(result.payload or {})`
  from `mc.commands.get_contacts`) but is not persisted or exposed to the UI.

### 2.5 Endpoint / model patterns to mirror

- Per-contact mutation endpoint pattern:
  `POST /api/contacts/{public_key}/routing-override`
  (`app/routers/contacts.py:574-618`) resolves the contact
  (`_resolve_contact_or_404`), mutates via a repository method, re-reads,
  best-effort pushes to radio, and broadcasts `_broadcast_contact_update`.
- Favorite mutation pattern:
  `ContactRepository.set_favorite(public_key, value)`
  (`app/repository/contacts.py:485-493`) plus the toggle endpoint
  `POST /api/settings/favorites/toggle` (`app/routers/settings.py:423-424`,
  `FavoriteRequest` at `:155`), which fires a radio-load task when a contact
  is newly favorited.
- `_row_to_contact` reads columns behind `available_columns` guards
  (`app/repository/contacts.py:132-183`), so a new column threads through the
  same way `favorite` already does (`:179`).

## 3. Design

### 3.1 Data model: one enum column (Approach A)

Add `contacts.radio_policy TEXT DEFAULT 'auto'` with three mutually-exclusive
values: `auto`, `pinned`, `excluded`.

- **auto** (default): current behavior. The contact is eligible for the
  recency-based fill (Section 2.1 stages 2-3) and, if favorited, the favorite
  tier.
- **pinned**: always loaded onto the radio, up to capacity, in the same
  first tier as favorites, regardless of recency.
- **excluded**: never loaded onto the radio, even if favorite or recently
  active. Remains fully present in the app/DB.

Rationale versus rejected alternatives:

- **Approach B (two booleans `radio_pinned` + `radio_excluded`, plus a revived
  maintained `on_radio`)**: needs an invariant guard against both-true, and
  reviving `on_radio` reintroduces exactly the stale-tracking burden that got
  it deprecated (Section 2.2). More moving parts, weaker.
- **Approach C (no new column; overload `favorite` or a JSON setting)**:
  overloads `favorite` (the brainstorm explicitly wanted pin kept separate),
  and a JSON blob reverses migration `_055`'s deliberate move of favorites off
  a blob into a column. Rejected.

An enum encodes "a contact is at most one of pinned/excluded" by construction,
so no cross-column invariant is needed.

### 3.2 Migration

New migration `_079_add_contact_radio_policy.py` (next free number; highest on
`origin/main` and this branch is `_077`, verified via
`git ls-tree -r --name-only origin/main app/migrations`). `ALTER TABLE
contacts ADD COLUMN radio_policy TEXT DEFAULT 'auto'`. Backfill is implicit
(all existing rows read as `auto`). No data migration from `on_radio` (it is
stale, Section 2.2). `LATEST_SCHEMA_VERSION` bumps to 79 (mirrors the pattern
in `#82`, "bump LATEST_SCHEMA_VERSION for migrations 076/077"). `on_radio` is
**not** dropped in this plan (out of scope; see Q4).

### 3.3 Repository and model

- `Contact.radio_policy: Literal["auto", "pinned", "excluded"] = "auto"`
  in `app/models.py` (next to `on_radio`/`favorite`, `:113-114`).
- `_row_to_contact` reads it behind the same `available_columns` guard as
  `favorite` (`app/repository/contacts.py:179`), defaulting to `"auto"`.
- New repository methods:
  - `set_radio_policy(public_key: str, policy: str) -> None` (mirrors
    `set_favorite`, `:485-493`; validates `policy in {auto,pinned,excluded}`).
  - `get_pinned() -> list[Contact]` (mirrors `get_favorites`, `:475-483`;
    `WHERE radio_policy = 'pinned' AND LENGTH(public_key) = 64`).
- `frontend/src/types.ts`: add `radio_policy` to the `Contact` type
  (`:205-206` block) and the upsert shape (`:285-289` block).

### 3.4 Selection change (Phase 2)

In `get_contacts_selected_for_radio_sync()` (`app/radio_sync.py:1532-1589`):

1. Load the excluded key set once; drop those keys from **every** fill stage,
   before the favorite tier. Exclude wins over favorite (Q1).
2. Build the first (always-loaded) tier from **pinned + favorite** contacts
   (union, de-duplicated by key, minus excluded), up to capacity, replacing
   the favorites-only loop at `:1547-1556`.
3. Stages 2-3 (recency fills) additionally skip excluded keys. Pinned/favorite
   already-selected keys are skipped by the existing `selected_keys` guard.

`should_run_full_periodic_sync` (`:270-297`) is unaffected (it counts what is
on the radio, not what should be). The actual load path
(`_sync_contacts_to_radio_inner`, `:1592+`, and `ensure_contact_on_radio`,
`:1610+`) consumes the selection unchanged.

Edge case: if `pinned + favorite` (minus excluded) already exceeds capacity,
pinned and favorite compete for the same tier. Tie-break order is a design
decision (Q2); default is pinned before favorite, then existing intra-tier
order.

### 3.5 Live residency indicator (Phase 3, derived)

No revived `on_radio` flag. Add a read endpoint (working name
`GET /api/contacts/radio-residency`) returning, for the currently-selected
set, `{public_key, reason}` where `reason` is one of `pinned` / `favorite` /
`recent-dm` / `recent-advert`. Computed from the same selection logic (Section
3.4), so it cannot drift from what a sync would actually do. The frontend
renders an "on radio" badge per contact from this set.

Optional ground-truth reconciliation: cross-check the derived set against the
radio's actual `mc.commands.get_contacts` payload (as
`should_run_full_periodic_sync` already reads, `:276-281`) and flag
divergence. Deferred within Phase 3 unless the derived view proves
insufficient (Q3).

### 3.6 Capacity surface (Phase 4)

- Extend the health payload (or a dedicated `GET /api/radio/occupancy`) with:
  effective capacity (`_effective_radio_capacity`), configured
  `max_radio_contacts`, hardware `max_contacts`, and current occupancy (count
  from `mc.commands.get_contacts`, matching `should_run_full_periodic_sync`).
- Frontend: an "X of N slots used" readout in the radio settings section
  (near the existing `settings_radio_max_contacts_*` strings,
  `frontend/src/components/settings/SettingsRadioSection.tsx:1736-1753`).
- Optional manual "offload/reload now" button reusing existing sync entry
  points (no new sync mechanism). Deferred within Phase 4 (Q5).

### 3.7 Typed contracts

- Backend: `radio_policy` on `Contact`; a small request model for the set
  endpoint (working name `ContactRadioPolicyRequest{policy: Literal[...]}`),
  mirroring `ContactRoutingOverrideRequest` (`app/routers/contacts.py:576`).
- Frontend: `radio_policy` on the `Contact` type; an `api.setContactRadioPolicy`
  method mirroring existing per-contact mutation calls in `frontend/src/api.ts`.
- i18n: any new user-facing strings need `t()` keys in EN/NL/DE (enforced;
  see project i18n rule). At minimum: pin/exclude action labels, an "on radio"
  badge label, and the occupancy readout.

## 4. Phasing (dependency order)

1. **Phase 1 - Data model.** Migration `_079`, `radio_policy` on the model,
   `_row_to_contact` read, `set_radio_policy`/`get_pinned` repository methods,
   the set-policy endpoint, and the frontend type/api plumbing. No behavior
   change to sync yet (writing a policy is inert until Phase 2). Ships as a
   safe no-op-behavior foundation.
2. **Phase 2 - Selection honors pin/exclude.** The `get_contacts_selected_for_
   radio_sync()` changes (Section 3.4) plus tests. This is where pin/exclude
   become real. Depends on Phase 1.
3. **Phase 3 - Live residency indicator.** Derived endpoint + frontend badges
   (Section 3.5). Depends on Phase 2 so the reported set reflects pins/excludes.
4. **Phase 4 - Capacity/occupancy surface** + optional manual offload
   (Section 3.6). Independent of Phase 3; depends only on existing sync
   internals, but sequenced last.

Each phase is independently shippable and independently testable.

## 5. Relationship to other plans

- **[03] split-favorites** (SHIPPED): UI grouping of favorites only, not a data
  dimension. This plan adds the actual new data dimension favorites never
  became. No overlap in code touched (Sidebar/CommandPalette grouping vs
  `radio_sync` selection + a new column).
- **[08] channel-preset-upload** (unimplemented): bulk push of channels to the
  radio. Contact radio residency here is managed by the existing automatic
  contact-sync path, not by [08]'s channel push. No dependency either way.
- **[18] multi-radio-identity** (draft): contact identity continuity across
  radio swaps. Orthogonal. `radio_policy` is per-contact and per-instance and
  does not interact with identity aliasing.

## 6. Risks / open questions

1. **Q1 (decided): exclude vs favorite precedence.** Exclude wins for sync
   selection; favorite still drives sidebar/UI grouping. Confirmed in the
   2026-09-12 brainstorm. Implementation must not let a favorited+excluded
   contact reach the radio (Section 3.4 step 1 runs before the favorite tier).
2. **Q2 (open, Phase 2): pinned vs favorite tie-break when the first tier
   exceeds capacity.** Default proposed: pinned before favorite. Low stakes
   (only bites when pinned+favorite alone overflow the radio); pick at
   implementation time and cover with a test.
3. **Q3 (open, Phase 3): derived-only vs radio-reconciled residency.**
   Default: derived only (Section 3.5), because it cannot drift and needs no
   extra radio round-trip. Add reconciliation only if the derived view is
   observably wrong against the radio in practice. UNVERIFIED how often the
   radio's actual set diverges from the computed set between syncs.
4. **Q4 (open, cross-cutting): what to do with the legacy `on_radio` column.**
   This plan leaves it in place (still read into the model, still cleared each
   cycle) to keep the change minimal. A follow-up could drop it once the
   derived residency (Phase 3) fully replaces its intended purpose. Not
   dropped here to avoid a schema removal with frontend type churn mid-series.
5. **Q5 (open, Phase 4): include the manual "offload/reload now" button?**
   Default: ship the read-only occupancy readout first; add the manual trigger
   only if requested. The trigger must reuse an existing sync entry point, not
   a new mechanism.
6. **Risk - migration correctness.** Windows-only backend test failures are a
   known pre-existing environment issue, not a regression signal; verify the
   migration on the Linux/Docker path (`rtfm-ev-local` container) as ground
   truth, per project convention.
7. **Risk - i18n gate.** New strings without EN/NL/DE `t()` keys fail the
   eslint + parity test. Budget for all three locales in Phases 1, 3, 4.

## 7. Verification plan

Per repo rule ("never claim it works without proof"), each phase must show at
least two independent checks with output, and runtime behavior must be
observed, not reasoned about.

**Phase 1 (data model):**

- Backend: `PYTHONPATH=. uv run pytest tests/ -v` for migration + repository
  tests; add a test asserting a fresh contact reads `radio_policy == "auto"`
  and that `set_radio_policy` round-trips each value. Run in the Docker/Linux
  path to avoid the known Windows-only failures.
- Migration idempotence: apply migrations twice on a copy of the DB, confirm
  no error and the column exists once.

**Phase 2 (selection):**

- Unit test `get_contacts_selected_for_radio_sync()` with fixtures: an
  excluded favorite is absent; a pinned non-recent contact is present; auto
  contacts fill the remainder up to the refill target; capacity is respected.
- Confirm no regression in existing radio-sync tests (`tests/test_radio*.py`,
  `tests/test_radio_lifecycle_service.py`).

**Phase 3 (residency indicator):**

- Backend: endpoint test asserting the returned set and per-contact `reason`
  match a known fixture.
- Runtime: open the app against a branch build (the `rtfm-ev-local`
  container), set a contact to pinned and another to excluded, and visually
  confirm the "on radio" badge appears/disappears correctly. Type-check/build
  is not sufficient evidence.

**Phase 4 (capacity):**

- Backend: occupancy endpoint returns effective capacity, configured value,
  hardware value, and current count.
- Runtime: confirm the "X of N" readout renders with real numbers in the radio
  settings section against a live radio (or a mock reporting `max_contacts`).

**All phases:** confirm the branch/build under test contains the change
(right branch, right container image, right URL) before reporting results;
run frontend prettier `format:check` and the i18n parity test before pushing
any frontend change.

## 8. Effort (S/M/L)

- Phase 1 (data model): **S**. One migration, one column, two repository
  methods, one endpoint, frontend type/api plumbing. Mirrors existing
  favorite/routing-override patterns.
- Phase 2 (selection): **S-M**. Focused change to one function plus targeted
  tests; care needed on tier ordering and the exclude-before-favorite rule.
- Phase 3 (residency indicator): **M**. New endpoint plus frontend badge
  wiring and i18n; derived-only keeps it contained.
- Phase 4 (capacity surface): **S-M**. One endpoint extension, one readout,
  optional manual trigger deferred.
- Total: **M** across the series; each phase independently shippable.
