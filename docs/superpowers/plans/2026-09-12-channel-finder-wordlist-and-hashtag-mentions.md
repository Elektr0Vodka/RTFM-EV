# Channel-finder wordlist sync + #hashtag mention handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the channel finder pull candidate names from the Channel Registry into its cracker wordlist, and make `#hashtag` channel mentions in chat state-aware (followed / known / unknown) with a one-click capture into the registry plus an opt-in auto-capture.

**Architecture:** Feature 1 adds a third, registry-derived wordlist source (a new localStorage cache filled by a manual button) merged alongside the bundled + remote-synced lists in the single `setWordlist()` call. Feature 2 extends the existing `#hashtag` reference renderer with a three-state style, adds a registry `recordMention` path (new `source: 'mention'`), an inline "+" capture, and an opt-in `auto_add_mentioned_channels` boolean setting mirroring `show_mention_ticker` end-to-end.

**Tech Stack:** React + TypeScript + Vitest (frontend), FastAPI + aiosqlite + pytest (backend), i18n EN/NL/DE (enforced), uv toolchain.

**Source spec:** `docs/superpowers/specs/2026-09-12-channel-finder-wordlist-and-hashtag-mentions-design.md`

**Conventions for every task:** No em dashes in user-facing strings. Every new user-facing string needs `t()` keys in EN/NL/DE (eslint + a parity test enforce this). Run frontend prettier `format:check` before considering a frontend task done. Do NOT commit unless the user explicitly says to (repo git rule); the `git commit` steps below are the intended boundaries but require explicit user go-ahead.

**Commands (Windows; run from the worktree root):**
- Backend one file: `PYTHONPATH=. uv run pytest tests/<file>.py -q`
- Frontend: `cd frontend && npm run test:run` , `npm run lint` , `npm run format:check` , `npm run build`
- Full quality: `./scripts/quality/all_quality.sh`

---

## File Structure

**Feature 1 (frontend only):**
- Modify `frontend/src/lib/wordlistSync.ts` — add registry-cache helpers + candidate transform.
- Modify `frontend/src/components/CrackerPanel.tsx` — 3-way merge + "Sync from channels" button.
- Modify `frontend/src/test/wordlistSync.test.ts` — cover new helpers.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json` — button + toast keys.

**Feature 2 registry + classification (frontend only):**
- Modify `frontend/src/lib/channelManager.ts` — `source` union + `recordMention`.
- Create `frontend/src/lib/hashtagChannelState.ts` — pure classification helpers.
- Create `frontend/src/test/hashtagChannelState.test.ts` — cover classification.
- Modify `frontend/src/test/channelManager.test.ts` — cover `recordMention` (create if absent).
- Modify `frontend/src/components/ChannelRegistryView.tsx` — `notifyChannelMentioned`, source label + filter options.
- Modify `frontend/src/components/MessageList.tsx` — three-state highlight + inline "+".
- Modify `frontend/src/App.tsx` + `frontend/src/components/ConversationPane.tsx` — thread `onHashtagAdded` + `autoAddMentionedChannels`.

**Feature 2 auto-add setting (backend + frontend):**
- Create `app/migrations/_078_add_auto_add_mentioned_channels.py`.
- Create `tests/test_migrations/test_migration_078.py`.
- Modify `tests/test_migrations/conftest.py` — `LATEST_SCHEMA_VERSION` 77 -> 78.
- Modify `app/models.py`, `app/routers/settings.py`, `app/repository/settings.py`.
- Modify `tests/test_settings_router.py`.
- Modify `frontend/src/types.ts` — settings field (both interfaces).
- Modify `frontend/src/components/settings/SettingsRadioSection.tsx` — toggle.
- Modify test fixtures that hardcode the full `AppSettings` shape.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json` — toggle + inline-add + highlight-title keys.

**Docs:**
- Modify `frontend/AGENTS.md`, `app/AGENTS.md`, `changelog-DMC-EV.md`.

---

# FEATURE 1 — Sync cracker wordlist from Channel Registry names

## Task 1: Registry wordlist cache + candidate transform

**Files:**
- Modify: `frontend/src/lib/wordlistSync.ts`
- Test: `frontend/src/test/wordlistSync.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `wordlistSync.test.ts`)

```ts
import {
  loadRegistryWordlist,
  saveRegistryWordlist,
  registryWordlistCandidates,
} from '../lib/wordlistSync';

describe('registryWordlistCandidates', () => {
  it('strips a single leading # and trims', () => {
    expect(registryWordlistCandidates(['#amsterdam', '#den-haag', 'utrecht'])).toEqual([
      'amsterdam',
      'den-haag',
      'utrecht',
    ]);
  });

  it('drops empty/whitespace-only names', () => {
    expect(registryWordlistCandidates(['#', '  ', '#ok'])).toEqual(['ok']);
  });
});

describe('loadRegistryWordlist / saveRegistryWordlist', () => {
  it('round-trips a saved list under its own key', () => {
    saveRegistryWordlist(['amsterdam', 'saarland']);
    expect(loadRegistryWordlist()).toEqual(['amsterdam', 'saarland']);
  });

  it('is independent of the remote sync cache', () => {
    saveSyncedWordlist(['remote-a']);
    saveRegistryWordlist(['registry-b']);
    expect(loadSyncedWordlist()).toEqual(['remote-a']);
    expect(loadRegistryWordlist()).toEqual(['registry-b']);
  });

  it('returns [] on malformed cached JSON', () => {
    store['meshcore-wordlist-registry-cache'] = '{not valid';
    expect(loadRegistryWordlist()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- wordlistSync`
Expected: FAIL — `loadRegistryWordlist`/`saveRegistryWordlist`/`registryWordlistCandidates` are not exported.

- [ ] **Step 3: Implement in `wordlistSync.ts`** (add below the existing exports)

```ts
const REGISTRY_STORAGE_KEY = 'meshcore-wordlist-registry-cache';

/** Load the last registry-synced candidate-name list. Returns [] on any read/parse error. */
export function loadRegistryWordlist(): string[] {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/** Replace the cached registry-derived wordlist with the given set. */
export function saveRegistryWordlist(words: string[]): void {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(words));
  } catch {
    // Quota exceeded or storage unavailable: the in-memory merge still works for
    // this session; the sync just will not persist across reloads.
  }
}

/**
 * Turn registry channel names (each starting with '#', per
 * addableRegistryChannelNames) into cracker candidates: strip a single leading
 * '#', trim, drop empties. Dedupe/normalisation happens later in mergeWordlists.
 */
export function registryWordlistCandidates(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const stripped = (raw.startsWith('#') ? raw.slice(1) : raw).trim();
    if (stripped) out.push(stripped);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:run -- wordlistSync`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit** (only if user authorised committing)

```bash
git add frontend/src/lib/wordlistSync.ts frontend/src/test/wordlistSync.test.ts
git commit -m "feat(cracker): add registry-derived wordlist cache and candidate transform"
```

---

## Task 2: "Sync from channels" button + 3-way merge in CrackerPanel

**Files:**
- Modify: `frontend/src/components/CrackerPanel.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

- [ ] **Step 1: Add i18n keys** (place alphabetically near other `cracker_*` keys in each file)

`en.json`:
```json
  "cracker_sync_from_channels_label": "Sync from channels",
  "cracker_wordlist_synced_from_channels": "Synced {count} channel names into the wordlist. Takes effect next time the finder loads or on reload.",
  "cracker_wordlist_registry_count": "{count} from channels",
```
`nl.json`:
```json
  "cracker_sync_from_channels_label": "Synchroniseer vanuit kanalen",
  "cracker_wordlist_synced_from_channels": "{count} kanaalnamen toegevoegd aan de woordenlijst. Wordt actief bij het volgende laden van de finder of na herladen.",
  "cracker_wordlist_registry_count": "{count} uit kanalen",
```
`de.json`:
```json
  "cracker_sync_from_channels_label": "Aus Kanaelen synchronisieren",
  "cracker_wordlist_synced_from_channels": "{count} Kanalnamen zur Wortliste hinzugefuegt. Wird beim naechsten Laden des Finders oder nach Neuladen wirksam.",
  "cracker_wordlist_registry_count": "{count} aus Kanaelen",
```

- [ ] **Step 2: Update imports in `CrackerPanel.tsx`**

Change the existing import at line 11 from:
```ts
import { loadSyncedWordlist, mergeWordlists } from '../lib/wordlistSync';
```
to:
```ts
import {
  loadSyncedWordlist,
  loadRegistryWordlist,
  saveRegistryWordlist,
  registryWordlistCandidates,
  mergeWordlists,
} from '../lib/wordlistSync';
import { loadRegistry, addableRegistryChannelNames } from '../lib/channelManager';
```

- [ ] **Step 3: Extend the merge in the wordlist-load effect**

In the effect at `CrackerPanel.tsx:95-104`, change:
```ts
        const merged = mergeWordlists(ENGLISH_WORDLIST, loadSyncedWordlist());
```
to:
```ts
        const merged = mergeWordlists(
          ENGLISH_WORDLIST,
          loadSyncedWordlist(),
          loadRegistryWordlist()
        );
```

- [ ] **Step 4: Add the sync handler + a re-render count state**

Near the other `useState` hooks (around line 57), add:
```ts
  const [registryWordCount, setRegistryWordCount] = useState(() => loadRegistryWordlist().length);
```
Add a handler (near `handleStart`, ~line 419):
```ts
  const handleSyncFromChannels = useCallback(() => {
    const names = addableRegistryChannelNames(loadRegistry());
    const candidates = registryWordlistCandidates(names);
    saveRegistryWordlist(candidates);
    setRegistryWordCount(candidates.length);
    toast.success(t('cracker_wordlist_synced_from_channels', { count: candidates.length }));
  }, [t]);
```

- [ ] **Step 5: Render the button** (add inside the top control row `div` at ~line 528, after the turbo checkbox `label`)

```tsx
        <button
          type="button"
          onClick={handleSyncFromChannels}
          className="px-3 py-1 text-sm rounded border border-border bg-muted hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('cracker_sync_from_channels_label')}
          {registryWordCount > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              {t('cracker_wordlist_registry_count', { count: registryWordCount })}
            </span>
          )}
        </button>
```

- [ ] **Step 6: Verify build, lint, format, and i18n parity**

Run: `cd frontend && npm run build && npm run lint && npm run format:check && npm run test:run`
Expected: build succeeds; lint clean (no hardcoded-string violations); prettier clean; i18n parity test passes.

- [ ] **Step 7: Runtime check (observed, not reasoned)**

In the local Docker instance (see memory `local-docker-instance`): open the Channel Registry, confirm it has at least one `#` entry; open the channel finder; click "Sync from channels"; confirm the toast reports a non-zero count and the button shows "N from channels". Reload, reopen the finder, and confirm a registry-only name (not in the bundled list) now cracks a matching test packet. Record the observed count in the PR.

- [ ] **Step 8: Commit** (if authorised)

```bash
git add frontend/src/components/CrackerPanel.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(cracker): sync wordlist from Channel Registry names via a manual button"
```

---

# FEATURE 2 — #hashtag mention handling

## Task 3: `recordMention` + `'mention'` source in channelManager

**Files:**
- Modify: `frontend/src/lib/channelManager.ts`
- Test: `frontend/src/test/channelManager.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

If `frontend/src/test/channelManager.test.ts` does not exist, create it with:
```ts
import { describe, it, expect } from 'vitest';
import { recordMention, type RegistryChannel } from '../lib/channelManager';
```
Then add:
```ts
describe('recordMention', () => {
  it('adds an unknown mention as source "mention" with no activity metadata', () => {
    const { result, added } = recordMention('#saarland', []);
    expect(added).toBe(true);
    expect(result).toHaveLength(1);
    const e = result[0];
    expect(e.channel).toBe('#saarland');
    expect(e.source).toBe('mention');
    expect(e.firstSeen).toBeNull();
    expect(e.lastHeard).toBeNull();
    expect(e.packets).toBe(0);
  });

  it('normalises a missing leading # and is case-insensitive', () => {
    const existing: RegistryChannel[] = recordMention('#Saarland', []).result;
    const { result, added } = recordMention('saarland', existing);
    expect(added).toBe(false);
    expect(result).toHaveLength(1);
  });

  it('never mutates an existing entry', () => {
    const existing = recordMention('#a', []).result.map((e) => ({ ...e, notes: 'keep' }));
    const { result, added } = recordMention('#a', existing);
    expect(added).toBe(false);
    expect(result[0].notes).toBe('keep');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- channelManager`
Expected: FAIL — `recordMention` is not exported / `'mention'` not assignable to `source`.

- [ ] **Step 3: Implement**

In `channelManager.ts`, change the `source` union at line 26 from:
```ts
  source: 'finder' | 'manual' | 'imported' | 'radio'; // 'radio' = seeded from existing DB channel
```
to:
```ts
  source: 'finder' | 'manual' | 'imported' | 'radio' | 'mention'; // 'mention' = seen referenced in chat
```
Add the function (below `addMissingFromSync`, ~line 257):
```ts
/**
 * Record a channel referenced in a chat message, if not already present.
 * Unlike recordFinderDiscovery this sets NO firstSeen/lastHeard and leaves
 * packets at 0 — a mention is a reference, not observed channel activity.
 * No-op when the channel already exists (never mutates it). Returns
 * { result, added }. Caller must persist with saveRegistry when added.
 */
export function recordMention(
  channelName: string,
  existing: RegistryChannel[]
): { result: RegistryChannel[]; added: boolean } {
  const name = normalizeChannelName(channelName);
  const key = name.toLowerCase();
  if (existing.some((e) => e.channel.toLowerCase() === key)) {
    return { result: existing, added: false };
  }
  const now = new Date().toISOString();
  return {
    result: [
      ...existing,
      {
        ...emptyEntry(name, 'mention', now),
        firstSeen: null,
        lastHeard: null,
        added: now.slice(0, 10),
        packets: 0,
      },
    ],
    added: true,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:run -- channelManager`
Expected: PASS.

- [ ] **Step 5: Commit** (if authorised)

```bash
git add frontend/src/lib/channelManager.ts frontend/src/test/channelManager.test.ts
git commit -m "feat(registry): add recordMention and 'mention' source"
```

---

## Task 4: `notifyChannelMentioned` + registry UI for the new source

**Files:**
- Modify: `frontend/src/components/ChannelRegistryView.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

- [ ] **Step 1: Add i18n keys** (near the existing `channel_registry_source_*` keys)

`en.json`:
```json
  "channel_registry_source_mention": "Mention",
  "channel_registry_source_mention_lc": "mention",
```
`nl.json`:
```json
  "channel_registry_source_mention": "Vermelding",
  "channel_registry_source_mention_lc": "vermelding",
```
`de.json`:
```json
  "channel_registry_source_mention": "Erwaehnung",
  "channel_registry_source_mention_lc": "erwaehnung",
```

- [ ] **Step 2: Register the source label** (`ChannelRegistryView.tsx:76-81`)

Add to `SOURCE_LABEL_KEYS`:
```ts
  mention: 'channel_registry_source_mention_lc',
```

- [ ] **Step 3: Add the filter `<option>`** in BOTH source `<select>`s (near lines 485-488 and 1205-1208)

```tsx
                <option value="mention">{t('channel_registry_source_mention')}</option>
```

- [ ] **Step 4: Add the integration helper** (below `notifyChannelFound`, ~line 1756)

```ts
/**
 * Record a channel referenced in a chat message into the registry, if not
 * already present. Registry-only (never creates a followed radio channel).
 * Returns whether a new entry was added.
 */
export function notifyChannelMentioned(channelName: string): boolean {
  const existing = loadRegistry();
  const { result, added } = recordMention(channelName, existing);
  if (added) saveRegistry(result);
  return added;
}
```
Ensure `recordMention` is added to the existing `channelManager` import at the top of the file (it already imports `loadRegistry`, `saveRegistry`, `recordFinderDiscovery`).

- [ ] **Step 5: Verify build/lint/format/tests**

Run: `cd frontend && npm run build && npm run lint && npm run format:check && npm run test:run`
Expected: PASS. (i18n parity for the new keys.)

- [ ] **Step 6: Commit** (if authorised)

```bash
git add frontend/src/components/ChannelRegistryView.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(registry): notifyChannelMentioned helper and 'mention' source in UI"
```

---

## Task 5: Pure hashtag classification helper

**Files:**
- Create: `frontend/src/lib/hashtagChannelState.ts`
- Test: `frontend/src/test/hashtagChannelState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildNameSet, classifyHashtag } from '../lib/hashtagChannelState';

describe('buildNameSet', () => {
  it('lowercases and normalises a leading #', () => {
    const set = buildNameSet(['#Amsterdam', 'utrecht']);
    expect(set.has('#amsterdam')).toBe(true);
    expect(set.has('#utrecht')).toBe(true);
  });
});

describe('classifyHashtag', () => {
  const followed = buildNameSet(['#amsterdam']);
  const registry = buildNameSet(['#amsterdam', '#saarland']);

  it('returns "followed" when in the followed set', () => {
    expect(classifyHashtag('#amsterdam', followed, registry)).toBe('followed');
  });
  it('returns "known" when only in the registry set', () => {
    expect(classifyHashtag('#saarland', followed, registry)).toBe('known');
  });
  it('returns "unknown" when in neither', () => {
    expect(classifyHashtag('#wetter', followed, registry)).toBe('unknown');
  });
  it('is case-insensitive on the label', () => {
    expect(classifyHashtag('#AMSTERDAM', followed, registry)).toBe('followed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- hashtagChannelState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hashtagChannelState.ts`**

```ts
// Pure classification of #hashtag channel references seen in chat, used by
// MessageList to style them and decide whether to offer capture. Kept out of
// the component so it is unit-testable.

export type HashtagState = 'followed' | 'known' | 'unknown';

function normalise(name: string): string {
  const n = name.trim().toLowerCase();
  return n.startsWith('#') ? n : `#${n}`;
}

/** Build a lookup set of channel names, each lowercased and '#'-prefixed. */
export function buildNameSet(names: string[]): Set<string> {
  return new Set(names.map(normalise));
}

/**
 * followed  = present in the app's followed radio channel list
 * known     = present only in the Channel Registry
 * unknown   = present in neither (a capture candidate)
 */
export function classifyHashtag(
  label: string,
  followedNames: Set<string>,
  registryNames: Set<string>
): HashtagState {
  const key = normalise(label);
  if (followedNames.has(key)) return 'followed';
  if (registryNames.has(key)) return 'known';
  return 'unknown';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:run -- hashtagChannelState`
Expected: PASS.

- [ ] **Step 5: Commit** (if authorised)

```bash
git add frontend/src/lib/hashtagChannelState.ts frontend/src/test/hashtagChannelState.test.ts
git commit -m "feat(chat): add pure #hashtag channel-state classification helper"
```

---

## Task 8 (backend prerequisite for auto-add): `auto_add_mentioned_channels` setting

> Ordered before the MessageList wiring because Task 6's auto-capture consumes this setting. Mirrors `show_mention_ticker` exactly (a boolean, default here **False**).

**Files:**
- Create: `app/migrations/_078_add_auto_add_mentioned_channels.py`
- Create: `tests/test_migrations/test_migration_078.py`
- Modify: `tests/test_migrations/conftest.py`
- Modify: `app/models.py`, `app/routers/settings.py`, `app/repository/settings.py`
- Modify: `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing migration test** (`tests/test_migrations/test_migration_078.py`)

```python
"""Tests for database migration 078."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration078:
    """Test migration 078: add app_settings.auto_add_mentioned_channels."""

    @pytest.mark.asyncio
    async def test_adds_column_defaulting_disabled(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 77)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 77
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                "SELECT auto_add_mentioned_channels FROM app_settings WHERE id = 1"
            )
            row = await cursor.fetchone()
            # Existing rows default to disabled (NOT NULL DEFAULT 0).
            assert row["auto_add_mentioned_channels"] == 0
        finally:
            await conn.close()
```

- [ ] **Step 2: Bump `LATEST_SCHEMA_VERSION`** in `tests/test_migrations/conftest.py`

Change:
```python
LATEST_SCHEMA_VERSION = 77
```
to:
```python
LATEST_SCHEMA_VERSION = 78
```

- [ ] **Step 3: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_migrations/test_migration_078.py -q`
Expected: FAIL — migration `_078` does not exist, column missing. (Other migration tests referencing `LATEST_SCHEMA_VERSION - N` will also fail until Step 4 lands; that is expected mid-task.)

- [ ] **Step 4: Create the migration** (`app/migrations/_078_add_auto_add_mentioned_channels.py`)

```python
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``auto_add_mentioned_channels`` to ``app_settings`` (default: disabled).

    When enabled, #hashtag channels referenced in chat are auto-recorded in the
    Channel Registry. Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}
    if "auto_add_mentioned_channels" not in settings_columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN "
            "auto_add_mentioned_channels INTEGER NOT NULL DEFAULT 0"
        )

    await conn.commit()
```

- [ ] **Step 5: Wire `app/models.py`** — add after the `show_mention_ticker` field (~line 1152):

```python
    auto_add_mentioned_channels: bool = Field(
        default=False,
        description=(
            "When enabled, #hashtag channels referenced in chat messages are "
            "automatically recorded in the Channel Registry (registry only; no "
            "followed radio channel is created)"
        ),
    )
```

- [ ] **Step 6: Wire `app/routers/settings.py`**

Add to `AppSettingsUpdate` after the `show_mention_ticker` field (~line 106):
```python
    auto_add_mentioned_channels: bool | None = Field(
        default=None,
        description="Auto-record #hashtag channels referenced in chat into the registry.",
    )
```
Add to the update-forwarding block after the mention-ticker block (~line 330):
```python
    if update.auto_add_mentioned_channels is not None:
        kwargs["auto_add_mentioned_channels"] = update.auto_add_mentioned_channels
```

- [ ] **Step 7: Wire `app/repository/settings.py`** (five touch points, mirroring `show_mention_ticker`)

(a) SELECT column list (~line 52), add `auto_add_mentioned_channels,` to the selected columns.
(b) Parse block after the `show_mention_ticker` parse (~line 154):
```python
        # Parse auto_add_mentioned_channels boolean (migration adds it default=0)
        try:
            auto_add_mentioned_channels = bool(row["auto_add_mentioned_channels"])
        except (KeyError, TypeError):
            auto_add_mentioned_channels = False
```
(c) `AppSettings(...)` return kwargs (~line 219), add:
```python
            auto_add_mentioned_channels=auto_add_mentioned_channels,
```
(d) `_apply_updates` signature (~line 248) and `update_settings` signature (~line 388), add the parameter to both:
```python
        auto_add_mentioned_channels: bool | None = None,
```
(e) `_apply_updates` body after the `show_mention_ticker` block (~line 327):
```python
        if auto_add_mentioned_channels is not None:
            updates.append("auto_add_mentioned_channels = ?")
            params.append(1 if auto_add_mentioned_channels else 0)
```
and the `update_settings` -> `_apply_updates` passthrough (~line 416):
```python
                auto_add_mentioned_channels=auto_add_mentioned_channels,
```

- [ ] **Step 8: Write the router round-trip tests** (`tests/test_settings_router.py`, after the mention-ticker tests ~line 71)

```python
    @pytest.mark.asyncio
    async def test_auto_add_mentioned_channels_defaults_disabled(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.auto_add_mentioned_channels is False

    @pytest.mark.asyncio
    async def test_auto_add_mentioned_channels_round_trip(self, test_db):
        result = await update_settings(AppSettingsUpdate(auto_add_mentioned_channels=True))
        assert result.auto_add_mentioned_channels is True
        fresh = await AppSettingsRepository.get()
        assert fresh.auto_add_mentioned_channels is True
```

- [ ] **Step 9: Run backend tests to verify pass**

Run: `PYTHONPATH=. uv run pytest tests/test_migrations/test_migration_078.py tests/test_settings_router.py tests/test_migrations/ -q`
Expected: PASS (migration adds the column defaulting 0; round-trip persists; all `LATEST_SCHEMA_VERSION` migration-count asserts now satisfied at 78).

- [ ] **Step 10: Commit** (if authorised)

```bash
git add app/migrations/_078_add_auto_add_mentioned_channels.py tests/test_migrations/test_migration_078.py tests/test_migrations/conftest.py app/models.py app/routers/settings.py app/repository/settings.py tests/test_settings_router.py
git commit -m "feat(settings): add auto_add_mentioned_channels flag (default off)"
```

---

## Task 9: Frontend settings type + fixtures

**Files:**
- Modify: `frontend/src/types.ts`
- Modify test fixtures that construct a full `AppSettings`: `frontend/src/test/settingsModal.test.tsx`, `frontend/src/test/fanoutSection.test.tsx`, `frontend/src/test/settingsAnalyzerSites.test.tsx`, `frontend/src/test/settingsHandyInfoSection.test.tsx`.

- [ ] **Step 1: Add the field to both interfaces in `types.ts`**

After `show_mention_ticker: boolean;` (line 469):
```ts
  auto_add_mentioned_channels: boolean;
```
After `show_mention_ticker?: boolean;` (line 510):
```ts
  auto_add_mentioned_channels?: boolean;
```

- [ ] **Step 2: Run typecheck to find every fixture that breaks**

Run: `cd frontend && npm run build`
Expected: FAIL — TS2741 "property `auto_add_mentioned_channels` is missing" in the fixture objects that spell out a full `AppSettings`.

- [ ] **Step 3: Add `auto_add_mentioned_channels: false,` to each failing fixture**

In each fixture object flagged by Step 2 (search for the line `show_mention_ticker: true,` in those files), add directly beneath it:
```ts
    auto_add_mentioned_channels: false,
```
(Match the surrounding indentation of each file.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run build && npm run test:run`
Expected: PASS (typecheck clean, no fixture errors).

- [ ] **Step 5: Commit** (if authorised)

```bash
git add frontend/src/types.ts frontend/src/test/settingsModal.test.tsx frontend/src/test/fanoutSection.test.tsx frontend/src/test/settingsAnalyzerSites.test.tsx frontend/src/test/settingsHandyInfoSection.test.tsx
git commit -m "feat(settings): add auto_add_mentioned_channels to frontend settings types"
```

---

## Task 10: Settings toggle UI

**Files:**
- Modify: `frontend/src/components/settings/SettingsRadioSection.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

- [ ] **Step 1: Add i18n keys**

`en.json`:
```json
  "settings_radio_auto_add_mentioned_label": "Auto-add mentioned channels to registry",
  "settings_radio_auto_add_mentioned_desc": "When enabled, #hashtag channels referenced in chat messages are automatically recorded in the Channel Registry. This only updates the registry catalog; it does not create a followed channel. When off, use the plus button on an unknown mention to add it yourself.",
```
`nl.json`:
```json
  "settings_radio_auto_add_mentioned_label": "Vermelde kanalen automatisch aan register toevoegen",
  "settings_radio_auto_add_mentioned_desc": "Indien ingeschakeld worden #hashtag-kanalen die in chatberichten worden genoemd automatisch in het kanaalregister opgenomen. Dit werkt alleen de registercatalogus bij; er wordt geen gevolgd kanaal aangemaakt. Indien uit, gebruik de plusknop bij een onbekende vermelding om het zelf toe te voegen.",
```
`de.json`:
```json
  "settings_radio_auto_add_mentioned_label": "Erwaehnte Kanaele automatisch zum Register hinzufuegen",
  "settings_radio_auto_add_mentioned_desc": "Wenn aktiviert, werden in Chatnachrichten genannte #hashtag-Kanaele automatisch im Kanalregister erfasst. Das aktualisiert nur den Registerkatalog; es wird kein gefolgter Kanal erstellt. Wenn aus, nutze die Plus-Schaltflaeche bei einer unbekannten Erwaehnung, um sie selbst hinzuzufuegen.",
```

- [ ] **Step 2: Add the toggle** in `SettingsRadioSection.tsx` directly after the `show-mention-ticker` block (~line 1514, before the closing `</div>` of that group)

```tsx
        <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
          <Checkbox
            id="auto-add-mentioned-channels"
            checked={appSettings.auto_add_mentioned_channels}
            onCheckedChange={(checked) =>
              onSaveAppSettings({ auto_add_mentioned_channels: checked === true })
            }
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="auto-add-mentioned-channels">
              {t('settings_radio_auto_add_mentioned_label')}
            </Label>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_radio_auto_add_mentioned_desc')}
            </p>
          </div>
        </div>
```

- [ ] **Step 3: Verify build/lint/format/tests**

Run: `cd frontend && npm run build && npm run lint && npm run format:check && npm run test:run`
Expected: PASS.

- [ ] **Step 4: Commit** (if authorised)

```bash
git add frontend/src/components/settings/SettingsRadioSection.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(settings): add auto-add-mentioned-channels toggle"
```

---

## Task 6: Three-state highlight + inline "+" in MessageList

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

**Interface added to `MessageListProps`:**
- `registryNames?: Set<string>` — lowercased/`#`-normalised registry names (from parent).
- `autoAddMentionedChannels?: boolean`
- `onHashtagAdded?: (channelName: string) => void` — parent persists + refreshes `registryNames`.

- [ ] **Step 1: Add i18n keys**

`en.json`:
```json
  "chat_hashtag_add_to_registry_aria": "Add {channel} to the channel registry",
  "chat_hashtag_followed_title": "{channel}: followed channel",
  "chat_hashtag_known_title": "{channel}: in your channel registry",
  "chat_hashtag_unknown_title": "{channel}: not in your registry",
  "toast_hashtag_added_to_registry": "Added {channel} to the channel registry",
```
`nl.json`:
```json
  "chat_hashtag_add_to_registry_aria": "Voeg {channel} toe aan het kanaalregister",
  "chat_hashtag_followed_title": "{channel}: gevolgd kanaal",
  "chat_hashtag_known_title": "{channel}: in je kanaalregister",
  "chat_hashtag_unknown_title": "{channel}: niet in je register",
  "toast_hashtag_added_to_registry": "{channel} toegevoegd aan het kanaalregister",
```
`de.json`:
```json
  "chat_hashtag_add_to_registry_aria": "{channel} zum Kanalregister hinzufuegen",
  "chat_hashtag_followed_title": "{channel}: gefolgter Kanal",
  "chat_hashtag_known_title": "{channel}: in deinem Kanalregister",
  "chat_hashtag_unknown_title": "{channel}: nicht in deinem Register",
  "toast_hashtag_added_to_registry": "{channel} zum Kanalregister hinzugefuegt",
```

- [ ] **Step 2: Import the classifier** at the top of `MessageList.tsx`

```ts
import { classifyHashtag, buildNameSet, type HashtagState } from '../lib/hashtagChannelState';
```

- [ ] **Step 3: Extend `MessageListProps`** (after `onChannelReferenceClick`, ~line 72)

```ts
  registryNames?: Set<string>;
  autoAddMentionedChannels?: boolean;
  onHashtagAdded?: (channelName: string) => void;
```

- [ ] **Step 4: Thread the new props through the renderer chain**

`renderChannelReferences` (line 261) currently takes `(text, keyPrefix, onChannelReferenceClick?)`. Change its signature to accept a context object and use it for classification:
```ts
interface HashtagRenderCtx {
  onChannelReferenceClick?: (channelName: string) => void;
  followedNames: Set<string>;
  registryNames: Set<string>;
  onAdd?: (channelName: string) => void;
  addAriaLabel: (channel: string) => string;
  titleFor: (state: HashtagState, channel: string) => string;
}
```
Update `renderChannelReferences`, `linkifyText`, and `renderTextWithMentions` to pass this `ctx` object instead of the bare `onChannelReferenceClick` argument. For each reference, compute:
```ts
const state = classifyHashtag(reference.label, ctx.followedNames, ctx.registryNames);
const stateClass =
  state === 'followed'
    ? 'text-primary underline underline-offset-2 hover:text-primary/80'
    : state === 'known'
      ? 'text-muted-foreground underline underline-offset-2 decoration-dotted hover:text-foreground'
      : 'text-accent-foreground underline underline-offset-2 decoration-dashed hover:text-foreground';
```
Render the reference button with `title={ctx.titleFor(state, reference.label)}` and the `stateClass`. When `state === 'unknown' && ctx.onAdd`, render an adjacent add button:
```tsx
<button
  type="button"
  aria-label={ctx.addAriaLabel(reference.label)}
  title={ctx.addAriaLabel(reference.label)}
  onClick={() => ctx.onAdd!(reference.label)}
  className="ml-0.5 inline-flex items-center rounded border border-border px-1 text-[0.625rem] leading-none text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
  +
</button>
```

- [ ] **Step 5: Build the context in the `MessageList` body** (near other memos, ~line 1122)

```ts
const followedNames = useMemo(() => buildNameSet(channels.map((c) => c.name)), [channels]);
const registryNameSet = registryNames ?? EMPTY_NAME_SET;
const hashtagCtx = useMemo<HashtagRenderCtx>(
  () => ({
    onChannelReferenceClick,
    followedNames,
    registryNames: registryNameSet,
    onAdd: onHashtagAdded,
    addAriaLabel: (channel) => t('chat_hashtag_add_to_registry_aria', { channel }),
    titleFor: (state, channel) =>
      state === 'followed'
        ? t('chat_hashtag_followed_title', { channel })
        : state === 'known'
          ? t('chat_hashtag_known_title', { channel })
          : t('chat_hashtag_unknown_title', { channel }),
  }),
  [onChannelReferenceClick, followedNames, registryNameSet, onHashtagAdded, t]
);
```
Add a module-level constant near the top of the file:
```ts
const EMPTY_NAME_SET: Set<string> = new Set();
```
Replace the call sites that pass `onChannelReferenceClick` into `renderTextWithMentions`/`linkifyText` with `hashtagCtx`.

- [ ] **Step 6: Auto-capture effect** (after the memos)

```ts
// Opt-in passive capture: when enabled, record unknown #hashtag references seen
// in the currently-rendered messages into the registry (registry only).
useEffect(() => {
  if (!autoAddMentionedChannels || !onHashtagAdded) return;
  for (const msg of sortedMessages) {
    for (const ref of findLinkedChannelReferences(msg.text)) {
      if (classifyHashtag(ref.label, followedNames, registryNameSet) === 'unknown') {
        onHashtagAdded(ref.label);
      }
    }
  }
}, [autoAddMentionedChannels, onHashtagAdded, sortedMessages, followedNames, registryNameSet]);
```
(`findLinkedChannelReferences` is already imported at line 16.)

- [ ] **Step 7: Add/extend a component test** (`frontend/src/test/messageList.test.tsx`)

Add a test that renders a channel message containing `#amsterdam` (followed), `#saarland` (registry), and `#wetter` (unknown), passing `channels=[{name:'#amsterdam',...}]`, `registryNames=buildNameSet(['#saarland'])`, and an `onHashtagAdded` spy. Assert:
```ts
// unknown mention shows an add button; clicking calls onHashtagAdded('#wetter')
const addBtn = screen.getByLabelText(/Add #wetter/i);
fireEvent.click(addBtn);
expect(onHashtagAdded).toHaveBeenCalledWith('#wetter');
// followed vs unknown carry different titles
expect(screen.getByTitle(/#amsterdam: followed channel/i)).toBeInTheDocument();
```
Mirror the existing render/setup helpers already in `messageList.test.tsx` (reuse its message + contact factories; do not invent new harness).

- [ ] **Step 8: Run to verify**

Run: `cd frontend && npm run test:run -- messageList && npm run lint && npm run format:check && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit** (if authorised)

```bash
git add frontend/src/components/MessageList.tsx frontend/src/test/messageList.test.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(chat): state-aware #hashtag highlight with inline registry capture"
```

---

## Task 7: App/ConversationPane wiring

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ConversationPane.tsx`

- [ ] **Step 1: Registry-name state + add handler in `App.tsx`**

Near the other state, add a registry-name Set derived from `loadRegistry()` plus a refresh nonce:
```ts
const [registryNonce, setRegistryNonce] = useState(0);
const registryNames = useMemo(
  () => buildNameSet(loadRegistry().map((e) => e.channel)),
  [registryNonce]
);
const handleHashtagAdded = useCallback((channelName: string) => {
  if (notifyChannelMentioned(channelName)) {
    toast.success(t('toast_hashtag_added_to_registry', { channel: channelName }));
    setRegistryNonce((n) => n + 1);
  }
}, [t]);
```
Add imports:
```ts
import { loadRegistry } from './lib/channelManager';
import { buildNameSet } from './lib/hashtagChannelState';
import { notifyChannelMentioned } from './components/ChannelRegistryView';
import { toast } from './components/ui/sonner';
```
(Some may already be imported; do not duplicate.)

- [ ] **Step 2: Pass the props** into the message-list props object (near `onChannelReferenceClick: handleChannelReferenceClick`, ~line 675)

```ts
    registryNames,
    autoAddMentionedChannels: appSettings?.auto_add_mentioned_channels ?? false,
    onHashtagAdded: handleHashtagAdded,
```

- [ ] **Step 3: Forward through `ConversationPane.tsx`**

Add `registryNames`, `autoAddMentionedChannels`, `onHashtagAdded` to `ConversationPane`'s props type and pass them straight through to `<MessageList ... />`, exactly as `onChannelReferenceClick` is already forwarded.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && npm run lint && npm run format:check && npm run test:run`
Expected: PASS.

- [ ] **Step 5: Runtime check (observed)**

In the local Docker instance: open a channel with a message containing a `#hashtag` you do not follow. Confirm three visual states are distinguishable (use one followed, one known, one unknown). Click the "+" on the unknown one; confirm the toast fires and the entry appears in the Channel Registry with source "mention" and the token restyles to "known". Toggle the setting ON in Settings; observe a new unknown mention gets auto-recorded without a click. Toggle OFF; confirm no passive capture.

- [ ] **Step 6: Commit** (if authorised)

```bash
git add frontend/src/App.tsx frontend/src/components/ConversationPane.tsx
git commit -m "feat(chat): wire #hashtag registry capture and auto-add setting through App"
```

---

## Task 11: Docs + full quality gate

**Files:**
- Modify: `frontend/AGENTS.md`, `app/AGENTS.md`, `changelog-DMC-EV.md`

- [ ] **Step 1: Document the wordlist registry source** in `frontend/AGENTS.md` (wordlist/cracker section): note the third merge source (`meshcore-wordlist-registry-cache`) and the "Sync from channels" button.

- [ ] **Step 2: Document the mention capture + setting** in `frontend/AGENTS.md` (chat/registry section) and add the `auto_add_mentioned_channels` row to `app/AGENTS.md`'s settings/API summary alongside `show_mention_ticker`.

- [ ] **Step 3: Add `changelog-DMC-EV.md` entries** (one line each): registry-derived wordlist sync button; state-aware #hashtag mentions with inline registry capture and opt-in auto-add.

- [ ] **Step 4: Full quality gate**

Run: `./scripts/quality/all_quality.sh`
Expected: PASS, modulo the known pre-existing Windows-only backend failures / charmap collection errors (memory `windows-only-test-failures`); confirm no NEW failures are introduced by this branch by comparing against a baseline run on `main`.

- [ ] **Step 5: Commit** (if authorised)

```bash
git add frontend/AGENTS.md app/AGENTS.md changelog-DMC-EV.md
git commit -m "docs: registry wordlist sync and #hashtag mention capture"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Feature 1 source = registry entries → Task 1 (`registryWordlistCandidates` over `addableRegistryChannelNames`), Task 2. ✓
- Feature 1 manual button + separate persisted cache → Task 1 (cache), Task 2 (button). ✓
- Feature 2 three-state highlight → Task 5 (classifier), Task 6 (render). ✓
- Feature 2 inline "+" (registry only) → Task 6. ✓
- Feature 2 auto-add setting default OFF → Task 8 (backend, DEFAULT 0), Task 9/10 (frontend), Task 6 (effect). ✓
- Feature 2 `source: 'mention'` → Task 3 (union + `recordMention`), Task 4 (UI). ✓
- i18n EN/NL/DE for every new string → Tasks 2,4,6,10. ✓
- Verification (unit + runtime observed) → per-task Runtime steps + Task 11 quality gate. ✓

**Type consistency:** `recordMention` returns `{ result, added }` (Task 3) consumed by `notifyChannelMentioned` (Task 4). `buildNameSet`/`classifyHashtag`/`HashtagState` (Task 5) consumed identically in MessageList (Task 6) and App (Task 7). `auto_add_mentioned_channels` (bool) named identically across migration, models, router, repository, types, fixtures, toggle. `onHashtagAdded(channelName: string)` signature identical in props (Task 6) and handler (Task 7).

**Placeholder scan:** No TBD/TODO; all code steps carry concrete code. The only deliberately non-code steps are the runtime-observation checks (required by repo policy — runtime must be observed) and the "match surrounding indentation" fixture edits, which name the exact anchor line to find.

**Open risk carried from spec:** auto-capture is render-time (Task 6 effect over `sortedMessages`), scoped to messages the user actually views; noted in the spec as the recommended choice.
