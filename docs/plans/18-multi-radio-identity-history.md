# [18] Multi-radio identity and historical continuity

Date: 2026-09-11
Status: draft for review
Category: H (Persistence) / new identity subsystem, see `docs/plans/README.md`
Model: Opus
State: Absent (greenfield identity registry) + Partial (extends existing
reconciliation + self-stat capture)

Scope: local planning only. No code changes, no migrations, no commits/PRs/issues
from this document.

Product framing: RTFM-EV is a **MeshCore** server + browser terminal driving one
companion radio (BLE / serial / TCP). The product vision this plan serves is "an
analyzer with one node feeding it": over time the feeding radio can be swapped
(new device, or a replacement after a broken/lost device that comes back with a
new keypair), and the accumulated history should stay coherent rather than
silently blend or fork.

---

## 1. Summary

Two identity-continuity problems, decided in the 2026-09-11 brainstorm to be in
scope for **both** the self radio and contacts:

1. **Self radio (the feeding node).** Today the connected radio's own identity is
   never persisted; it is read live from `mc.self_info` and held in memory only
   (§2a). There is no record of "which radio is or was feeding this instance."
   Two self-stat series (`battery_history`, `noise_floor_samples`) are keyed by
   timestamp alone, so swapping the radio silently concatenates two devices'
   readings into one series (§2a, a concrete existing bug).

2. **Contacts.** Contacts are keyed solely by `public_key`; a device that returns
   with a genuinely new keypair becomes a wholly separate contact with fresh
   history. The only existing merge is prefix-of-same-key promotion, which does
   not (and cannot) alias two different full keys (§2b).

This plan proposes, phased:

- A new **`radio_identities`** registry table: the persisted set of feeding
  radios, populated on connect from `mc.self_info`, with a `replaced_by` link for
  replacement chains.
- **Per-radio scoping of self-stat series** (`battery_history`,
  `noise_floor_samples`, and any future self-telemetry) by adding a radio-identity
  reference column, fixing the blend-on-swap bug. Existing rows backfill to a
  "legacy / unknown radio" sentinel.
- A **connect-time detection + prompt**: when a connected radio's key is not in
  the registry and at least one prior identity exists, the frontend asks "brand
  new node" vs "replacement for &lt;pick an existing radio&gt;". On replacement, the
  user chooses **what carries over** (name, notes, per-radio stat history re-keyed
  to the new identity).
- A general, **transactional `merge_contact_identity(old_key -> new_key)`** that
  re-keys every child table the current prefix-promotion helper misses, exposed as
  a **user-initiated** "same device, new key?" merge on contacts, with the same
  carry-over checklist. Heuristic auto-suggestion is a later, lower-trust phase.

De-confliction with plan [14] (historical device-info) and plan [19]
(analyzer-grade persistence) is in §6; both are consumers of, not owners of, this
identity model.

Next free migration number, to re-verify against `origin/main` at build time
(`git ls-tree -r --name-only origin/main app/migrations`): **`_076`** as of
2026-09-11 (highest is `_075_create_link_signal.py`). This number races with
parallel branches; it is not authoritative here.

## 2. Current state (cited)

### 2a. Self identity is ephemeral; two self-stat series blend across a swap

**FACT.** The connected radio's own identity (public key, name, lat/lon, radio
params) is read live from the meshcore library object `mc.self_info`. The
canonical read-back endpoint `GET /radio/config` pulls every field directly from
`mc.self_info` with no DB involvement (`app/routers/radio.py:385-414`;
`info = mc.self_info` at `:387`, `public_key = info.get("public_key", "")` at
`:395`), returning HTTP 423 when the radio is disconnected (`:388-389`) with no
cached fallback.

**FACT.** On connect, `send_device_query()` loads device capabilities (model,
firmware, `max_contacts`, `max_channels`, `path_hash_mode`) into in-memory
`radio_manager` attributes, not the DB (`app/services/radio_lifecycle.py:95-174`).
The self private key is exported from the radio on every connect and held in an
in-memory module global only; the keystore docstring is explicit that it "is
never persisted to disk" (`app/keystore.py:1-9,36-37`; `set_private_key`/
`get_public_key` `:66-95`; `export_and_store_private_key` `:107-144`, called from
`app/services/radio_lifecycle.py:65`; `clear_keys()` wipes it on disconnect,
`app/keystore.py:56-63`).

**FACT.** The SQLite DB is a single global store, not scoped per radio.
`database_path` defaults to the fixed `"data/meshcore.db"` (`app/config.py:21`);
the `Database` is a module global (`app/database.py:332`) opened once at startup
(`app/main.py:106`). No table or column in the schema (`app/database.py:13-160`)
or across all 75 migrations namespaces any row by "which radio is connected."

**FACT (bug).** `battery_history` (migration `_070`) and `noise_floor_samples`
(migration `_069`) are self-radio measurements keyed by `timestamp` only, with no
radio identity written (`app/services/radio_stats.py:87-109`; repositories
`app/repository/battery_history.py`, `app/repository/noise_floor.py`). Under a
radio swap they concatenate two radios' readings into one series. Self pubkey is
already available at capture time (it is surfaced live to fanout/HA from
`self_info`, `app/services/radio_stats.py:119-127`, `app/fanout/mqtt_ha.py:791-799`),
so scoping is a matter of writing an identity the code already holds.

### 2b. Contacts key on `public_key`; only prefix-of-same-key merges exist

**FACT.** `contacts.public_key` is the primary key (`app/database.py:14-35`),
lowercased everywhere (`app/repository/contacts.py:109`, migration `_014`). Upsert
is `INSERT ... ON CONFLICT(public_key) DO UPDATE` merging fields (`name` via
`COALESCE`, `last_seen` monotonic, `first_seen` preserved)
(`app/repository/contacts.py:64-129`). A new key simply inserts a new row
(`app/packet_processor.py:659-672`).

**FACT.** `promote_prefix_placeholders` merges a short prefix-only placeholder
contact into its resolved full 64-char key, migrating child rows
(`contact_name_history`, `contact_advert_paths`), merging timestamps, and deleting
the placeholder (`app/repository/contacts.py:565-714`), invoked on every advert
(`app/packet_processor.py:685-688` -> `app/services/contact_reconciliation.py:10-25`).
It is strictly gated to prefix-of-same-key
(`WHERE length(public_key) < 64 AND ? LIKE public_key || '%'`,
`app/repository/contacts.py:620-622`). There is **no** mechanism to alias two
different full public keys as one device.

**FACT (extension point, and its gap).** The prefix-promotion helper's child-row
re-key (`INSERT ... ON CONFLICT ...` + `MIN`/`MAX` timestamp reconciliation,
`app/repository/contacts.py:573-611,659-708`) is the closest existing pattern to a
general "merge identity A into B". But as written it re-keys only
`contact_name_history` and `contact_advert_paths`. It does **not** re-key
`messages` (`conversation_key`/`sender_key`), `link_signal`
(`observer_pubkey`/`subject_pubkey`), `contact_telemetry_history`, or (from [14])
`contact_location_history`. A general merge must handle all of these in one
transaction. Related reconciliation helpers that a general merge must mirror or
subsume: `claim_prefix_messages_for_contact`
(`app/services/contact_reconciliation.py:28-43`) and
`backfill_channel_sender_for_contact` (`:46-68`).

### 2c. No new-node detection anywhere

**FACT.** An advert with a previously-unseen key is silently upserted with
`first_seen = timestamp` after signature verification
(`app/packet_processor.py:603-609,659-672`); the only new-contact branch is a
suppression filter for `discovery_blocked_types`
(`app/packet_processor.py:647-657`; setting at `app/database.py:119`). Every
contact update emits a generic `broadcast_event("contact", ...)`
(`app/packet_processor.py:698-700`); a `contact_resolved` event fires only for
prefix promotions (`:701-704`), never for genuinely new nodes. The frontend has no
new-node toast/badge/modal (grep of `frontend/src` found only unrelated
`discover*` features and `first_seen` used as a display timestamp).

## 3. Design

### 3a. `radio_identities` registry (self radios)

New table. One row per feeding radio, keyed by its full public key.

```sql
CREATE TABLE IF NOT EXISTS radio_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL UNIQUE,
    name TEXT,                       -- self name at first/most-recent connect
    notes TEXT,                      -- user-entered
    first_connected INTEGER NOT NULL,
    last_connected INTEGER NOT NULL,
    replaced_by INTEGER,             -- FK -> radio_identities.id; set when this
                                     -- identity was superseded by a replacement
    is_active INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (replaced_by) REFERENCES radio_identities(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_radio_identities_pubkey
    ON radio_identities(public_key);
```

Capture point: the connect flow in `app/services/radio_lifecycle.py` (which
already reads `self_info` and exports the key, `:65-174`). On successful connect,
upsert `radio_identities` by `public_key` (advance `last_connected`, preserve
`first_connected`, set `is_active`), clearing `is_active` on the previously-active
row. This is additive to the existing connect path, not a new lifecycle stage.

OPEN QUESTION: the self public key is read from `mc.self_info`
(`app/routers/radio.py:395`) but the exact in-memory field name at the
`radio_lifecycle` capture point must be confirmed at build time (the keystore path
uses `export_and_store_private_key`, `app/services/radio_lifecycle.py:65`; the
public form is derivable there). Do not assume the accessor; verify against the
connect code.

### 3b. Per-radio scoping of self-stat series

Add a nullable `radio_identity_id INTEGER` (FK -> `radio_identities.id`) to
`battery_history` and `noise_floor_samples`. The sampler
(`app/services/radio_stats.py:87-109`) writes the currently-active identity id.

Backfill: existing rows get `radio_identity_id = NULL`, interpreted as "legacy /
pre-registry radio" and shown as a single unattributed series. A one-time
migration MAY optionally assign all pre-existing rows to a synthetic "legacy"
identity row so the read APIs need no NULL special-case; recommend the simpler
NULL sentinel first and only add the synthetic row if the read side proves it
needs one.

Read side: existing battery/noise read paths (used by `MyNodeView.tsx`
noise-floor viewer, per plan [14]/L2 notes) filter by the active identity by
default, with an option to show all/legacy. Exact endpoints to confirm at build
time (the samplers are the write side; the read endpoints are their counterparts
in the packets/stats routers).

Rationale for scoping only self-stats (matches the 2026-09-11 "Registry +
self-stats per radio" decision): observed mesh data (contacts, packets, messages,
neighbor/link signal) is a shared view of the mesh and stays global; only the
self-measured series are inherently per-device and currently mis-blended.

### 3c. Connect-time detection and prompt (self radio)

On connect, backend compares `self_info.public_key` to `radio_identities`:

- **Known key** -> update `last_connected`, no prompt.
- **Unknown key, no prior identities** -> create the first registry row silently
  (first run, nothing to disambiguate).
- **Unknown key, prior identities exist** -> emit a new WS event (e.g.
  `radio_identity_unrecognized`) carrying the new key/name and the list of
  existing identities. The frontend raises a modal:
  - "This is a brand-new node" -> create a new `radio_identities` row.
  - "This replaces &lt;pick an existing radio&gt;" -> set the old row's
    `replaced_by` to the new row, and run the carry-over selection (§3e).

The event is new; it does not reuse the generic `broadcast_event("contact")`
path (that is for contacts, `app/packet_processor.py:698-700`). Backend endpoints:
`POST /api/radio-identities/{id}/confirm-new` and
`POST /api/radio-identities/replace` (old_id, new_key, carry_over[]). Names to
finalize at build time against the existing router naming conventions.

### 3d. General contact identity merge (transactional)

New repository operation `merge_contact_identity(old_key, new_key, carry_over)`
that, in a **single transaction**, re-keys or reconciles **every** child table:

- `contacts`: merge the two rows (preserve earliest `first_seen`, latest
  `last_seen`, prefer non-null fields), then delete the old row.
- `messages`: `conversation_key` and `sender_key` (mirrors
  `claim_prefix_messages_for_contact`, `app/services/contact_reconciliation.py:28-43`).
- `contact_name_history`, `contact_advert_paths`: as the prefix helper already
  does (`app/repository/contacts.py:573-611`), generalized off the prefix gate.
- `link_signal`: `observer_pubkey` and `subject_pubkey`
  (`_075_create_link_signal.py`).
- `contact_telemetry_history` (`_062`): `public_key`.
- `contact_location_history` (from plan [14], if shipped): `public_key`.
- Channel sender backfill: `backfill_channel_sender_for_contact`
  (`app/services/contact_reconciliation.py:46-68`).

Trigger: **user-initiated only** in the first slice. A "same device, new key?"
action on a contact opens a merge modal (pick the old identity + carry-over
checklist). No automatic merging.

This is the highest-risk piece: it mutates primary/observed data across many
tables. It must be transactional, idempotent, covered by dedicated tests, and
must never run without explicit user confirmation.

### 3e. Carry-over selection ("user picks what carries over")

Both the self-replacement (§3c) and the contact merge (§3d) present a checklist of
inheritable categories, so the user chooses rather than the system deciding:

- Self replacement: name, notes, per-radio stat history (re-key
  `battery_history`/`noise_floor_samples` rows from the old identity id to the new),
  and any future per-radio self-telemetry.
- Contact merge: name/name-history, messages, advert paths, telemetry history,
  location history (from [14]), link-signal history.

Unchecked categories are left attached to the old identity (self case) or dropped
from the merge (contact case, meaning the old contact's rows for that category are
deleted with the old row rather than moved). The exact "leave vs delete" semantics
per unchecked category is an OPEN QUESTION for the UI spec.

### 3f. Heuristic new-node / same-device suggestion (later phase)

The research found no safe automatic "same physical device, new key" signal: name
match is weak and spoofable (any node can advertise any name). Therefore
auto-suggestion is deferred to Phase 3 and, even then, must be a **suggestion
only**, never an automatic merge. A light-weight "new node discovered" indicator
(toast/badge) is the low-risk part of this phase and can ship independently of any
same-device inference.

## 4. Phasing

1. **Phase 1 - self-radio registry + stat scoping + connect prompt.**
   Migration `_076` (registry table + `radio_identity_id` columns on
   battery/noise), `RadioIdentityRepository`, connect-time upsert in
   `radio_lifecycle`, sampler writes the identity id, the
   `radio_identity_unrecognized` event + confirm/replace endpoints, and the
   frontend connect modal with carry-over for the self-stat series. Self-contained;
   no contact-data mutation.
2. **Phase 2 - user-initiated contact identity merge.**
   `merge_contact_identity` (transactional, all child tables), the contact "same
   device, new key?" modal + carry-over checklist, and the merge endpoint. Depends
   on Phase 1 only for the shared carry-over UI pattern, not for data.
3. **Phase 3 - new-node indicator + optional same-device suggestion.**
   New-node toast/badge (independent, low risk) and, separately and cautiously, a
   suggestion-only heuristic for contact merges.

## 5. Risks and open questions

- **Transactional correctness of the contact merge (§3d).** The existing prefix
  helper does not re-key `messages`/`link_signal`/telemetry; the general merge
  must, atomically, or it will orphan or duplicate rows. This is the load-bearing
  risk. Requires exhaustive table coverage and tests before it is trusted.
- **Self-identity accessor (§3a).** The exact `self_info` field / in-memory
  accessor at the `radio_lifecycle` capture point must be verified in code, not
  assumed.
- **Backfill semantics for scoped stats (§3b).** NULL sentinel vs synthetic
  "legacy" identity row is an implementation choice to settle against the read
  side; recommend NULL first.
- **Carry-over "leave vs delete" for unchecked categories (§3e).** Needs an
  explicit UI/product decision per category.
- **Heuristic safety (§3f).** No reliable automatic same-device signal exists;
  keep any suggestion advisory and user-confirmed. Do not auto-merge.
- **Interaction with `discovery_blocked_types` (§2c).** Suppressed contact types
  never create rows; a new-node indicator must respect that suppression, not
  bypass it.
- **Concurrency.** The DB is a shared global store and other sessions/worktrees
  may be writing; the merge transaction must not assume exclusive access.
- **Out of scope (explicit):** full per-radio partitioning of observed mesh data
  (contacts/packets/messages). The 2026-09-11 decision keeps that global; only
  self-stats are scoped here.

## 6. De-confliction

- **Plan [14] (historical device-info).** [14] adds `contact_location_history`
  and `device_config_history`. This plan's contact merge (§3d) must re-key
  `contact_location_history`; and if a per-radio notion is ever wanted for
  `device_config_history`, it should reference `radio_identities`, not invent a
  second registry. Update [14]'s de-confliction section to name this dependency
  (done in this pass).
- **Plan [19] (analyzer-grade persistence/retention).** [19]'s per-data-class
  retention must treat re-keyed rows correctly (a merge changes row ownership, not
  age) and should offer retention scoped to the active `radio_identities` row for
  the self-stat series. [19] consumes this registry; it does not define identity.
- **Existing reconciliation (`app/services/contact_reconciliation.py`).** The
  general merge (§3d) generalizes, and must stay consistent with, the prefix-only
  helpers already there. Prefer extending that module over a parallel one.

## 7. Verification plan

Before any "works" claim for the eventual implementation:

1. Backend unit tests: `RadioIdentityRepository` (upsert/active-flip/replace
   chain) and `merge_contact_identity` (every child table re-keyed, atomic
   rollback on failure, idempotent re-run) in `tests/test_repository.py` +
   dedicated merge test, mirroring how prefix promotion is tested today.
2. Fresh-DB migration check: confirm `PRAGMA user_version` reaches `76` and the
   new table/columns exist.
3. Existing-DB migration check: run `_076` against a pre-`_076` fixture; confirm
   battery/noise rows survive with `radio_identity_id NULL`.
4. Swap simulation: connect radio A, record battery/noise, "disconnect", connect
   radio B (different key), confirm the prompt fires and that A's and B's series
   are separable by identity id (direct DB inspection).
5. Contact-merge simulation: create two contacts with distinct keys, one with
   messages/telemetry/link-signal, merge them, confirm all child rows moved and no
   orphans remain.
6. `./scripts/quality/all_quality.sh` per `AGENTS.md` before done. Runtime UI
   verification (the connect modal actually rendering and re-keying) is required
   for Phases 1-2 since they change user-visible behavior, per the repo rule that
   runtime behavior must be observed, not reasoned about.

## 8. Effort

Opus, large, and genuinely phased. Phase 1 is a self-contained additive backend +
one modal (medium). Phase 2 (transactional cross-key merge) is the hard,
high-risk core and should be scoped and reviewed on its own. Phase 3 is small
(indicator) plus a deliberately-deferred, advisory-only heuristic. No firmware or
wire-protocol changes: this plan only changes what the host persists and how it
attributes already-available identity data.
