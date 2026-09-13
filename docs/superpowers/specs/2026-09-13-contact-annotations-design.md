# Contact annotations: notes, owner, owner info, manual GPS

Date: 2026-09-13
Status: Approved design, pending implementation plan

## Goal

Restore user-editable, DB-stored annotations on contacts (surfaced in the contact
info pane and on the map), matching capabilities the old fork had:

- **Notes** — free text per contact.
- **Owner info** — free text describing the node's owner; auto-filled from the
  CLI/binary owner-info request when empty, user-overridable.
- **Owner** — a pubkey pointer to an existing contact (the operator's companion
  node); clicking it opens the DM conversation. Drives a reverse "Owned nodes"
  list on the referenced contact.
- **Manual GPS** — fallback coordinates used only when the node has no valid
  advertised location.

These are user annotations. The radio/advert sync path must never overwrite them.

## Non-goals

- No server-side `effective_lat`/`effective_lon` on the model. Effective-location
  resolution (advertised-wins, manual-fallback) is computed on the frontend where
  the map and pane consume it. Fanout/map-upload exports are out of scope; if we
  later want them to honor manual GPS, promote the computation to the backend
  model then.
- No fuzzy resolution of the free-text CLI owner-info string into a pubkey. The
  free-text value and the pubkey pointer are two separate fields.
- No new map-marker color/icon customization (was offered, not requested).

## Data model

Migration `_085` adds five nullable columns to `contacts`:

| Column       | Type | Meaning                                                        |
| ------------ | ---- | -------------------------------------------------------------- |
| `notes`      | TEXT | Free-text notes.                                               |
| `owner_info` | TEXT | Free-text owner description. Auto-filled from CLI when empty.  |
| `owner_key`  | TEXT | 64-char hex; references an existing contact (companion node).  |
| `manual_lat` | REAL | Fallback latitude.                                             |
| `manual_lon` | REAL | Fallback longitude.                                            |

`Contact` and `ContactUpsert` (`app/models.py`) gain all five fields (defaults
`None`). The contacts upsert SQL must use `COALESCE(excluded.<col>, contacts.<col>)`
for these five so an advert-driven upsert (which supplies `None` for them) cannot
wipe a value the user set. Verify against the existing upsert statement in the
contacts repository; only the annotation columns get this treatment, matching how
route fields are already preserved.

`owner_key` is intentionally distinct from the CLI owner-info string and from the
existing `POST /contacts/{public_key}/repeater/owner-info` response. The field name
`owner_key` avoids confusion with `owner_info`.

## Effective location (frontend)

Add `getEffectiveLocation(contact): { lat: number; lon: number } | null` (in
`frontend/src/utils/pathUtils.ts` alongside `isValidLocation`):

1. If `isValidLocation(contact.lat, contact.lon)` → advertised coords win.
2. Else if `isValidLocation(contact.manual_lat, contact.manual_lon)` → manual coords.
3. Else `null`.

Consumers switch from raw `contact.lat/lon` to this helper:

- `MapView`: `mappableContacts` filter, `buildContactPopup` coords line,
  `openContactPopup` lng/lat.
- `ContactInfoPane`: GPS section, distance-from-us, `ContactGpsMap`, nearby-repeaters
  distance math, and the "view on map" affordance.

Advertised location keeps winning the moment a node advertises valid GPS, per the
"manual only as fallback" decision.

## API

### New: `POST /contacts/{public_key}/annotations`

Follows the `POST /contacts/{public_key}/routing-override` router pattern.

Request `ContactAnnotationsUpdate` (all optional; field present-and-`null` clears,
field absent leaves unchanged — use a sentinel or `model_fields_set` to distinguish
"absent" from "null"):

```
notes:       str | None
owner_info:  str | None
owner_key:   str | None
manual_lat:  float | None
manual_lon:  float | None
```

Validation:

- `owner_key`, when non-null/non-empty: must be 64-char hex AND reference an
  existing contact row. Otherwise `422`. Empty string or `null` clears it.
- `manual_lat`/`manual_lon`: range-checked (`-90..90`, `-180..180`); out-of-range
  → `422`. Setting one without the other is allowed (fallback simply won't be valid
  until both are set); document that `getEffectiveLocation` requires both.
- `notes`, `owner_info`: free text; apply a reasonable max length (e.g. 2000 chars)
  → `422` if exceeded.

Behavior: load contact (404 if unknown), apply the provided subset via
`ContactUpsert`/repository write, broadcast a `contact` WS event with the updated
row so open panes and the map update live.

### Changed: `POST /contacts/{public_key}/repeater/owner-info`

After the existing binary fetch, add server-side auto-fill:

- If fetched `owner_info` is non-empty AND the contact's stored `owner_info` is
  empty/null → persist the fetched value (same write path as annotations),
  broadcast `contact`, set `owner_info_updated = True`.
- If stored `owner_info` is non-empty and differs from fetched → do NOT overwrite;
  `owner_info_updated = False`. The client decides whether to prompt.
- If fetched equals stored, or fetched empty → `owner_info_updated = False`.

`RepeaterOwnerInfoResponse` gains:

```
stored_owner_info: str | None   # contact's persisted owner_info after this call
owner_info_updated: bool         # True iff this call auto-filled an empty field
```

## Frontend

### ContactInfoPane (the editable surface)

New sections (each saves via `api.updateContactAnnotations(...)` → the annotations
endpoint; optimistic or await-then-refresh, consistent with existing pane actions):

- **Notes**: textarea + Save. Empty save clears.
- **Owner info**: single-line/multi-line text input + Save. Shows the CLI-sourced
  or user-entered value.
- **Owner**: a contact picker validated against the loaded `contacts` array (search
  by name/pubkey). When set, render the owner contact's display name as a link that
  opens the DM conversation (reuse the existing `onSelectContact`/conversation-open
  path). Include a clear/unset control.
- **Owned nodes**: computed client-side — `contacts.filter(c => c.owner_key === contact.public_key)`.
  Render each as a clickable entry that opens that node's info pane. Hidden when the
  list is empty.
- **Manual location**: two numeric inputs (lat, lon) + Save + Clear. The GPS section
  and mini-map use `getEffectiveLocation`.

`ContactInfoPaneProps` gains any new callbacks needed (e.g. `onOpenContactInfo`
for owned-node/owner navigation if the pane cannot self-navigate; reuse existing
open-info mechanism from `useConversationNavigation` where possible).

### Map

- `MapView` node layer + popups use `getEffectiveLocation`, so a manual-only node
  is now mappable.
- `buildContactPopup` gains a read-only notes snippet (truncated) and, when
  `owner_key` is set, an owner link (opens DM conversation).
- Add a **Details** button in the popup that opens `ContactInfoPane` for that
  contact. This needs a new callback threaded `MapView` → `ConversationPane` → `App`
  (App already owns `infoPaneContactKey` via `useConversationNavigation`; expose an
  opener and pass it down as the map's "open info" handler).

### Repeater Dashboard (RepeaterOwnerInfoPane)

Consume the new response flags from `useRepeaterDashboard`:

- `owner_info_updated === true` → success toast ("Owner info saved").
- fetched `owner_info` non-empty AND `!== stored_owner_info` AND `owner_info_updated === false`
  → show an override prompt ("Repeater reports owner '<fetched>'. Replace saved
  owner info '<stored>'?"). On confirm → call the annotations endpoint with
  `owner_info = fetched`.

## Testing

Backend:

- Repository: annotation columns round-trip; advert-driven upsert with `None`
  annotation fields does not clear existing values.
- Annotations router: sets each field; clears via `null`/empty; `owner_key`
  existence + hex validation (422 on bad/unknown key); manual lat/lon range 422;
  404 on unknown contact; `contact` WS broadcast fired.
- Owner-info router: auto-fill when stored empty (persist + `owner_info_updated`);
  no-overwrite + `owner_info_updated=false` when stored differs; `stored_owner_info`
  reflects post-call state.

Frontend:

- `getEffectiveLocation`: advertised-wins, manual-fallback, none.
- ContactInfoPane: notes/owner-info/manual-GPS save calls; owner picker validation;
  owner link opens conversation; owned-nodes reverse list renders and navigates;
  hidden when empty.
- MapView: manual-only node appears; popup Details opens info pane; owner link.
- RepeaterOwnerInfoPane: auto-fill toast; override prompt path.

## Docs

- `app/AGENTS.md`: data-model notes (five new contact columns, COALESCE-preserved),
  API surface (`/contacts/{public_key}/annotations`, owner-info auto-fill behavior +
  response fields).
- `frontend/AGENTS.md`: annotations editing in ContactInfoPane, effective-location
  helper, map Details wiring.
- `CHANGELOG-DMC-EV.md`: entry under the appropriate area (referencing the PR/commit).
- i18n: all new user-facing strings need `t()` keys in EN/NL/DE (enforced by
  eslint + parity test).

## Risks / notes

- **Migration numbering**: `_085` is the next free number on this branch (off `main`,
  latest `_074`). Other unmerged branches in the operator's notes use `_078/_080/_082`;
  no collision on this branch, but if those merge first, re-check the next free number
  before finalizing.
- **Absent-vs-null in the PATCH-like body**: must distinguish "field not provided"
  from "field provided as null (clear)". Use Pydantic `model_fields_set` or explicit
  sentinels; a naive `exclude_none` would make clearing impossible.
- **owner_key referential integrity**: validated at write time only. If the
  referenced contact is later deleted, `owner_key` becomes dangling; the owner link
  should degrade gracefully (render the raw key, no navigation) and the Owned-nodes
  computation simply won't match. Consider whether `contacts` FK cascade (migration
  `_049`) should also null dangling `owner_key` on delete — decide during planning.
