# Channel-finder wordlist selector

Date: 2026-09-12
Status: Design approved, pending spec review

## Problem

The channel finder (`CrackerPanel`, using `meshcore-hashtag-cracker`) always
cracks against a single fixed base dictionary: the bundled `ENGLISH_WORDLIST`,
merged with analyzer-synced and registry-derived candidates. Users cannot:

1. Crack against a non-English dictionary (e.g. Dutch).
2. Supply their own wordlist.

## Goals

1. Add a wordlist selector to the channel finder that lets the user choose which
   base dictionaries are active.
2. Ship a bundled Dutch wordlist as one of the selectable bases.
3. Let users upload their own wordlists, stored server-side, and select them.

## Non-goals

- **Word-pair separator.** Adding a separator (e.g. `-`) between concatenated
  word pairs is deferred. Verified against `meshcore-hashtag-cracker@1.11.0`:
  `CrackOptions` has no separator/delimiter field and pairs are concatenated
  directly on the GPU. Supporting a separator requires a new release of that
  package (out of this repo's control), then a dependency bump and UI wiring.
  Tracked as a follow-up, not part of this change.
- Trimming or content-filtering the Dutch list beyond normalization.
- Per-user or multi-instance wordlist scoping (this is a single-instance local
  app; server-stored lists are global to the instance).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Selector model | Base picker; enabled bases still merged with synced + registry candidates |
| Dutch list home | Bundled in this app |
| Dutch file format | Raw, uncompressed `.txt` |
| Dutch content | Normalized before commit (see Normalization) |
| Normalization target | Conform to the valid hashtag-room charset (a-z, 0-9, hyphen) |
| Custom list delivery | Browser upload (multipart POST to backend) |
| Custom list count | Multiple named lists |
| Custom list storage | File on disk in the data dir; metadata in DB |
| Upload cap | None enforced (accept whatever the user uploads) |

## MeshCore hashtag-room name constraints (source of truth)

Verified from `meshcore-packet-knife`'s README (Elektr0Vodka fork of jkingsman's
tool) and Jack Kingsman's MeshCore cryptography writeup, cross-checked against
the `meshcore-hashtag-cracker` README (its brute-force alphabet is 36 symbols =
lowercase a-z + 0-9):

- Room names are **lowercase alphanumeric with hyphens** (`a-z`, `0-9`, `-`).
- **No leading, trailing, or double hyphens.**
- **Max length 30** characters (the name, excluding the leading `#`).
- The channel key is the first 16 bytes of `SHA256("#" + roomName)`.

Any wordlist entry outside this charset can never match a real hashtag room, so
normalization conforms entries to it (see Normalization). Uppercase input is
lowercased rather than dropped, since only the derived key must match.

## Architecture

### Wordlist sources and merge

The cracker's single `setWordlist()` call receives a merge of:

```
mergeWordlists(...enabledBases, loadSyncedWordlist(), loadRegistryWordlist())
```

`enabledBases` is built from the user's selection, drawn from:

- **English** (bundled in `meshcore-hashtag-cracker`, lazy-imported as today).
  Default enabled.
- **Dutch / NL** (bundled in this app, see below). Default disabled.
- **Zero or more named custom lists** (server-stored). Default none enabled.

Synced and registry candidates are always merged on top, unchanged from current
behavior. `mergeWordlists` already deduplicates case-insensitively and preserves
first-seen order, so it needs no change.

### Selection persistence (client)

Cracking runs in the browser, and English/Dutch are client-side resources, so
the *selection* is a per-browser preference in `localStorage`:

- Key: `meshcore-wordlist-selection`
- Shape: `{ english: boolean, dutch: boolean, customIds: number[] }`
- Default: `{ english: true, dutch: false, customIds: [] }`
- Read/parse failures fall back to the default (same defensive pattern as
  `loadSyncedWordlist`).

Custom list *contents and metadata* live on the server; only the selected ids
are stored client-side. A selected id that no longer exists on the server is
ignored at merge time.

### Dutch wordlist (bundled)

- Source: the user's `wordlist.txt` (Dutch), normalized (see below), committed
  raw and uncompressed.
- Location: `frontend/public/wordlists/nl.txt` (served as a static asset by the
  existing frontend static handler; copied to the dist root by Vite).
- Loading: fetched lazily via `fetch('wordlists/nl.txt')` **only when Dutch is
  enabled**, then split into lines. It is never part of the initial JS bundle
  and is not loaded when Dutch is disabled.
- Size note: ~414k entries (post-normalization count TBD at implementation).
  Selecting Dutch makes the dictionary phase substantially slower than English.
  A short inline note is shown in the UI when Dutch is enabled.

#### Normalization

The same normalizer is applied to the Dutch list (once, before committing the
file) and to every uploaded list server-side, so bundled and custom lists behave
identically. It conforms each line to the hashtag-room charset above.

Per line:

1. Lowercase.
2. Remove every character not in `[a-z0-9-]`. This strips spaces, apostrophes,
   `+`, and other symbols: `auto's` -> `autos`, `10 eurobiljet` ->
   `10eurobiljet`, `100+'er` -> `100er`.
3. Collapse runs of hyphens to a single `-`; strip leading and trailing `-`.
4. Drop the line if it is now empty, or longer than 30 characters (cannot be a
   valid room name).
5. Deduplicate case-insensitively, keeping first-seen order (stripping can make
   distinct inputs collide, e.g. `auto's` and `autos`).

Hyphens and digits are kept because they are valid in room names. Numeric-only
entries (`010`) are kept for the same reason. This replaces the earlier
"strip spaces and apostrophes" phrasing with the broader, charset-accurate rule.

### Custom lists (server)

Follows the existing router / repository / migration patterns.

#### Storage

- **Table** `wordlists` (migration `_080_create_wordlists.py`):
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `name TEXT NOT NULL`
  - `filename TEXT NOT NULL` (on-disk file name, e.g. `<id>.txt`)
  - `entry_count INTEGER NOT NULL`
  - `size_bytes INTEGER NOT NULL`
  - `created_at INTEGER NOT NULL` (epoch seconds)
- **Files on disk**: `<data_dir>/wordlists/<id>.txt`, where `data_dir` is
  `Path(settings.database_path).parent` (same convention as the SQLite DB).
  Bytes are never stored in the database.

#### Repository

`app/repository/wordlists.py` (`WordlistRepository`), exported from
`app/repository/__init__.py`:

- `list()` -> list of metadata rows
- `create(name, normalized_words) -> metadata` (writes row, then file)
- `get(id) -> metadata | None`
- `delete(id)` (removes row and file)

The on-disk directory is created on demand (`mkdir(parents=True,
exist_ok=True)`).

#### Endpoints

`app/routers/wordlists.py`, prefix `/wordlists`:

- `GET /api/wordlists` -> `{ wordlists: [ {id, name, entry_count, size_bytes,
  created_at} ] }`
- `POST /api/wordlists` (multipart: `name` field + `file`) -> single metadata
  object. Server reads the file, decodes UTF-8 (latin-1 fallback, matching the
  channel-import endpoint), normalizes with the same rules as the Dutch list,
  writes the file, inserts the row. No entry cap.
- `GET /api/wordlists/{id}/words` -> `{ words: [ ... ] }` (reads the on-disk
  file). Consumed by the cracker to load a selected custom list on demand.
- `DELETE /api/wordlists/{id}` -> 204. Removes row and file. 404 if unknown.

Registered in `app/main.py` alongside the other routers.

### Frontend UI

A **Wordlists** control in the `CrackerPanel` toolbar, styled like the existing
"Sync from channels" button, opening a small popover:

- Checkbox: **English** (default on).
- Checkbox: **Dutch (NL)** (default off), with an inline "slower" note when on.
- One checkbox per custom list, showing its name and entry count.
- **Upload wordlist**: a name field + file picker; on submit, POST multipart,
  then refresh the list and (optionally) enable the new list.
- **Delete** control per custom list (DELETE, then refresh; remove its id from
  the selection).

Behavior:

- Changing the selection while the cracker is **idle** rebuilds `enabledBases`,
  re-runs the merge, and calls `setWordlist()`.
- While bases are loading (Dutch fetch, custom-list fetch), show the existing
  "loading wordlist" affordance and keep Start disabled until at least the merge
  has completed once.
- Selection changes are ignored (or deferred) while the cracker is running, to
  avoid mutating the wordlist mid-crack. Exact policy: the control is disabled
  while running.

### API client and types

- `frontend/src/api.ts`: add `listWordlists`, `uploadWordlist(name, file)`,
  `getWordlistWords(id)`, `deleteWordlist(id)`.
- `frontend/src/types.ts`: add a `WordlistMeta` type.

### i18n

New user-facing strings added to `en.json`, `nl.json`, `de.json` (enforced by
the eslint rule and the parity test): selector labels, upload dialog, delete
confirmation, Dutch "slower" note, error toasts.

## Data flow

1. Panel becomes visible. Selection is read from `localStorage`.
2. For each enabled base, its words are obtained:
   - English: lazy `import('meshcore-hashtag-cracker/wordlist')`.
   - Dutch: `fetch('wordlists/nl.txt')`, split into lines.
   - Custom: `GET /api/wordlists/{id}/words`.
3. `mergeWordlists(...bases, synced, registry)` -> single `setWordlist()`.
4. User toggles a base or uploads/deletes a list while idle -> step 2-3 re-run.

## Error handling

- Dutch fetch failure: toast, leave Dutch disabled, keep other bases working.
- Custom-list fetch failure: toast, skip that id in the merge.
- Upload failure (network / decode): toast with the server error detail.
- Delete of a selected list: remove its id from the selection, refresh.
- All `localStorage` reads/writes wrapped in try/catch, matching existing code.

## Testing

Backend (run in the `rtfm-ev-local` container per repo convention):

- Repository: create writes row + file; list; get; delete removes row + file;
  normalization (trim, lowercase, drop blanks, dedupe, order preserved).
- Router: upload (multipart) returns metadata and persists; list; words
  endpoint returns normalized words; delete returns 204 and 404 for unknown;
  latin-1 fallback on non-UTF-8 upload.

Frontend:

- Merge/selection logic: enabled bases combine with synced + registry;
  disabled bases excluded; unknown custom id ignored; default selection.
- Selection persistence round-trip through `localStorage`, with parse-failure
  fallback.
- Upload/list/delete wiring against a mocked api.

## Files touched (anticipated)

New:

- `app/migrations/_080_create_wordlists.py`
- `app/repository/wordlists.py`
- `app/routers/wordlists.py`
- `frontend/public/wordlists/nl.txt` (normalized Dutch list)
- Backend + frontend test files.

Modified:

- `app/repository/__init__.py` (export `WordlistRepository`)
- `app/main.py` (register router)
- `frontend/src/components/CrackerPanel.tsx` (selector UI, merge flow)
- `frontend/src/lib/wordlistSync.ts` (selection load/save helpers) or a new
  `frontend/src/lib/wordlistSelection.ts`
- `frontend/src/api.ts`, `frontend/src/types.ts`
- `frontend/src/i18n/locales/{en,nl,de}.json`
- Docs / changelog as the repo requires.
