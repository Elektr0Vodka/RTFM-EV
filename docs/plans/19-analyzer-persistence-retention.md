# [19] Analyzer-grade persistence and retention

Date: 2026-09-11
Status: draft for review
Category: H (Persistence), see `docs/plans/README.md`
Model: Sonnet (policy/config + read paths); Opus only if periodic auto-collection
is added
State: Partial (extends existing history tables and `app_settings`; drives plan
[14])

Scope: local planning only. No code changes, no migrations, no commits/PRs/issues
from this document.

Product framing: the "analyzer with one node feeding it" vision (see plan [18])
wants RTFM-EV to **retain more and prune less**, or to prune on a policy the
operator controls, so a single feeding radio builds a long-lived local record of
the mesh. This plan is the retention-policy and persistence-coherence layer over
the individual history tables; it does not itself invent new per-feature history
(that is [14] and [18]).

---

## 1. Summary

RTFM-EV already has several history stores, but their retention is inconsistent
and mostly non-configurable: some prune automatically on hard-coded caps, one is
manual-only, and two grow unbounded (§2). For an analyzer use case this is both
too aggressive (30-day telemetry caps discard the long trend the analyzer wants)
and too loose (unbounded battery/noise growth with no operator control).

This plan proposes:

- A single **configurable, per-data-class retention policy** stored in
  `app_settings`, with an **"analyzer mode"** preset (long or unbounded retention)
  versus a **"lite mode"** preset (today's aggressive caps).
- Consuming and **unblocking plan [14]** (contact location history + device-config
  history) as part of the same persistence push, so the analyzer has the identity
  and config history to retain.
- Optional **periodic maintenance** (prune + VACUUM) driven by the policy, rather
  than the current manual-only packet maintenance.
- De-confliction with plan [18] (per-radio self-stat scoping) so retention and
  identity re-keying compose correctly.

This is primarily a policy/config + read-path plan. It deliberately does not
change what is captured (that is owned by the individual feature plans); it
changes how long captured data is kept and who decides.

Next free migration number to re-verify at build time
(`git ls-tree -r --name-only origin/main app/migrations`): **`_076`** as of
2026-09-11 (races with [14], [18], and any parallel branch). Note that the
policy itself may live entirely in `app_settings` and need **no** new migration
(mirroring how plans [09]/[15] avoided migrations by reusing settings); a
migration is only needed if a data-class column is added.

## 2. Current state: retention is inconsistent (cited)

Inventory from the persistence research (see also plan [14] §2 and plan [18] §2b),
verify at build time:

| Store | Migration | Retention today | Analyzer fit |
|---|---|---|---|
| `raw_packets` | `_065`/`_066` (signal cols) | **Manual only.** `POST /api/packets/maintenance` prunes undecrypted older than N days + purges packets already linked to messages + VACUUM (`app/routers/packets.py`; `app/repository/raw_packets.py` prune/purge). No automatic schedule. | Wants configurable long retention + optional auto-maintenance. |
| `contact_advert_paths` | `_040`/`_066`/`_071` | **Cap:** 10 most-recent unique paths per contact (`app/repository/contacts.py:822-836`). No age prune. | Cap is probably fine; expose it as policy if analyzer wants more. |
| `contact_name_history` | `_024` | **No prune** (naturally small; `UNIQUE(public_key, name)` upsert). | Good as-is. |
| `repeater_telemetry_history` | `_050` | **30-day age + 1000-row cap per repeater**, on each insert (`app/repository/repeater_telemetry.py:9-56`). | Too aggressive for a trend analyzer; make the cap policy-driven. |
| `contact_telemetry_history` | `_062` | **30-day + 1000-row cap per contact** (`app/repository/contact_telemetry.py:9-56`). | Same as above. |
| `link_signal` | `_075` | **30-day age prune** (`app/repository/link_signal.py:111-118`, called from `app/packet_processor.py:567`, `app/radio_sync.py:2096`). | Make the window policy-driven. |
| `battery_history` | `_070` | **No DB prune** (in-memory deque cap 1500/24h only; DB grows unbounded) (`app/repository/battery_history.py`; `app/services/radio_stats.py:34-40,103-107`). | Needs a policy cap; also per-radio scoping via [18]. |
| `noise_floor_samples` | `_069` | **No DB prune** (same pattern) (`app/repository/noise_floor.py`; `app/services/radio_stats.py:97-101`). | Same as battery. |
| `messages` | core | **No prune;** preserved even on contact delete (`app/repository/contacts.py:496-503`). | Keep; message retention is a separate product concern, out of scope here. |
| `contact_location_history` (proposed) | plan [14] | Not built. [14] proposes unbounded (like name history), with a rounding open question for churn. | Analyzer wants this built and retained. |
| `device_config_history` (proposed) | plan [14] | Not built. [14] proposes 30-day + per-kind cap. | Make the cap policy-driven. |

**Two clear gaps for an analyzer:** (a) the 30-day/1000-row telemetry and
link-signal caps discard exactly the long trend an analyzer exists to keep; (b)
`battery_history`/`noise_floor_samples` grow unbounded with no operator lever and,
per [18], blend across radio swaps.

`app_settings` is the established home for app-wide, operator-set configuration
(migration `_009_create_app_settings_table.py`; router `app/routers/settings.py`;
repo `app/repository/settings.py`; surfaced as an `AppSettings` object in the
settings UI). Several existing settings already live there (e.g.
`discovery_blocked_types`, `known_regions`, `flood_scope`, sync URLs from plans
[05]/[09]). This plan adds retention policy alongside them.

## 3. Design

### 3a. Retention policy in `app_settings`

Add a retention policy object to `app_settings` (JSON blob, or discrete keys,
matching how existing multi-value settings are stored; confirm the existing
convention at build time). Shape (illustrative, not final):

```
retention = {
  mode: "lite" | "analyzer" | "custom",
  raw_packets_days:            <int | null>,   # null = keep
  telemetry_days:              <int | null>,   # repeater + contact telemetry
  telemetry_rows_cap:          <int | null>,
  link_signal_days:            <int | null>,
  self_stats_days:             <int | null>,   # battery + noise
  device_config_days:          <int | null>,   # [14]
  auto_maintenance:            <bool>          # run periodic prune+VACUUM
}
```

Presets:
- **lite** = today's behavior (30-day telemetry/link caps, unbounded self-stats,
  manual packet maintenance) so existing installs are unchanged by default.
- **analyzer** = long or unbounded retention across the board + `auto_maintenance`
  optionally on.
- **custom** = operator-set per field.

**Default = lite**, so this plan is non-breaking: an install that never opens the
setting behaves exactly as today.

### 3b. Repositories read the policy instead of hard-coded constants

The repositories that currently hard-code caps
(`RepeaterTelemetryRepository`/`ContactTelemetryRepository` `_MAX_AGE_SECONDS` +
row cap; `LinkSignalRepository.prune`) read the policy value instead of a
module constant. Where a policy value is `null` (keep), pruning is skipped. This
is a small, localized change per repository, not a new subsystem: the prune calls
already exist and run on insert; only the threshold source changes.

`battery_history`/`noise_floor_samples` gain a prune path they lack today, driven
by `self_stats_days` (and, per [18], scoped by `radio_identity_id`).

### 3c. Optional periodic maintenance

Today `POST /api/packets/maintenance` is manual (prune undecrypted + purge linked
+ VACUUM). When `auto_maintenance` is on, run the same maintenance on a periodic
task (reusing the existing maintenance routine, not a parallel one). VACUUM is
database-wide, so it reclaims space for every table at once; the periodic hook
should be conservative (infrequent, off by default) because VACUUM locks the DB.

OPEN QUESTION: whether periodic maintenance is worth the added scheduler +
radio-lock contention risk versus leaving packet maintenance manual and only
making the telemetry/self-stats caps policy-driven. Recommend shipping 3a/3b
first (pure policy over existing prune points, no scheduler) and treating 3c as a
separate, opt-in follow-up.

### 3d. Frontend surface

A retention section in Settings (near the existing database/statistics settings,
`SettingsModal.tsx` / the database settings section) with the preset selector and,
under "custom", the per-class fields. New strings need EN/NL/DE `t()` keys per the
enforced i18n policy. Read-only info: current row counts per store (reuse or
extend existing stats endpoints) so the operator sees the effect of a policy
before applying it.

## 4. Phasing

1. **Phase 1 - policy over existing prune points (no scheduler).** Add the
   `app_settings` policy + presets (3a); make the telemetry and link-signal caps
   read the policy (3b); add policy-driven prune for battery/noise. Settings UI
   (3d) with i18n. Default `lite` = no behavior change.
2. **Phase 2 - unblock plan [14].** Build [14]'s `contact_location_history` +
   `device_config_history` and wire their caps into the same policy. (This is
   [14]'s implementation; [19] owns the retention knob, [14] owns the capture.)
3. **Phase 3 - optional periodic auto-maintenance (3c).** Only if the operator
   need is confirmed; off by default.

## 5. Risks and open questions

- **Unbounded retention is a disk-growth footgun.** "analyzer mode" with `null`
  everywhere on a busy mesh grows `raw_packets` (BLOB payloads) fastest. The UI
  must show current sizes and warn; recommend a soft size cap or at least a
  visible estimate, not silent unbounded growth.
- **Changing a cap does not retroactively delete.** Loosening then tightening a
  policy means the next prune enforces the new (tighter) value; document this so
  operators are not surprised.
- **VACUUM contention (3c).** DB-wide lock; keep periodic maintenance rare and
  off by default.
- **Interaction with [18] re-keying.** A contact/self merge changes row ownership,
  not age; retention must key off timestamps, so a merge does not accidentally
  age out re-keyed rows. Verify prune queries are timestamp-based (they are today).
- **Per-radio self-stat retention.** With [18], `self_stats_days` should prune per
  `radio_identity_id` so a retired radio's history can be kept or dropped
  independently. Sequencing: [18] Phase 1 (scoping) should land before self-stat
  retention is scoped per radio; until then `self_stats_days` prunes globally.
- **`app_settings` shape.** Confirm whether to store one JSON blob or discrete
  keys against the existing settings convention before implementing.

## 6. De-confliction

- **Plan [14].** [19] is the retention policy; [14] is the capture. [19] Phase 2
  is [14]'s build, with [14]'s proposed caps folded into [19]'s policy object
  rather than hard-coded in [14]'s repositories. [14]'s de-confliction section is
  updated to reference this (done in this pass).
- **Plan [18].** [18] owns identity + per-radio scoping; [19] consumes
  `radio_identity_id` for self-stat retention. [19] must not define identity.
- **Parity L2 (telemetry graphs).** The noise-floor viewer and any telemetry
  graphs read these same series; longer retention directly improves those graphs.
  No conflict; [19] enriches L2's data.

## 7. Verification plan

1. Unit tests: each repository prunes to the policy value, skips pruning when the
   value is `null`, and defaults (`lite`) reproduce today's exact caps
   (regression guard) in `tests/test_repository.py` + the telemetry test files.
2. Settings round-trip test: policy persists to `app_settings` and reloads.
3. Fresh + existing DB checks if any migration is added (policy in `app_settings`
   may need none).
4. Manual: set `analyzer` mode, generate telemetry beyond 30 days (fixture
   timestamps), confirm rows are retained; switch to `lite`, confirm the next
   insert prunes to 30 days.
5. `./scripts/quality/all_quality.sh` per `AGENTS.md`. Frontend runtime check of
   the settings UI is required since it is user-visible.

## 8. Effort

Sonnet for Phases 1-2 (policy plumbing over existing prune points + settings UI +
building [14]'s two tables). Opus only if Phase 3 (periodic maintenance scheduler
with radio-lock-aware timing) is pursued. Low protocol risk: nothing here changes
what is fetched from the radio, only how long the host keeps it and who controls
that.
