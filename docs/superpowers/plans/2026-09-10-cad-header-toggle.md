# CAD Header Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "CAD" toggle to the channel conversation header that controls the existing device-wide meshcomod CAD setting, shown only when a CAD-capable DMC-EV device is connected, and kept in sync with the Settings → Radio checkbox.

**Architecture:** No backend/API changes — `GET`/`PATCH /radio/meshcomod` and `health.radio_device_info.is_meshcomod` already exist. A new `useMeshcomodConfig` hook (module-level cache + window CustomEvent) becomes the single source of truth for meshcomod config; both the refactored `MeshcomodSettings` panel and a new `ChatHeader` button consume it. State is threaded `App → conversationPaneProps → ConversationPane → ChatHeader`.

**Tech Stack:** React + TypeScript + Vite + Tailwind; tests in Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-10-cad-header-toggle-design.md`

---

## Git policy (repo rule — overrides default)

This repo's CLAUDE.md forbids commits unless the user explicitly instructs. Each **Commit** step is ready to run but only execute it if committing is authorized this session; otherwise stop at `git add` + show `git status`. Branch names use `feat/…`; pushes/PRs target `origin`.

## File Structure

- `frontend/src/hooks/useMeshcomodConfig.ts` — **create**: shared hook + `MESHCOMOD_CONFIG_CHANGE_EVENT` + module cache + test reset.
- `frontend/src/hooks/index.ts` — **modify**: export the hook.
- `frontend/src/test/useMeshcomodConfig.test.ts` — **create**: hook tests.
- `frontend/src/components/settings/MeshcomodSettings.tsx` — **modify**: consume the hook (drop local fetch).
- `frontend/src/App.tsx` — **modify**: use the hook, extend `conversationPaneProps`.
- `frontend/src/components/ConversationPane.tsx` — **modify**: forward the 4 new props to `ChatHeader`.
- `frontend/src/components/ChatHeader.tsx` — **modify**: the CAD button + handler.
- `frontend/src/test/chatHeaderCadToggle.test.tsx` — **create**: button visibility/state/click tests.

---

## Task 1: `useMeshcomodConfig` hook (TDD)

**Files:**
- Create: `frontend/src/hooks/useMeshcomodConfig.ts`
- Test: `frontend/src/test/useMeshcomodConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/useMeshcomodConfig.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useMeshcomodConfig,
  __resetMeshcomodConfigCache,
} from '../hooks/useMeshcomodConfig';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getMeshcomodConfig: vi.fn(),
    updateMeshcomodConfig: vi.fn(),
  },
}));

const cfg = (cad_enabled: boolean | null) => ({
  cad_supported: true,
  cad_enabled,
  gps_supported: false,
  gps_enabled: null,
  gps_interval: null,
});

describe('useMeshcomodConfig', () => {
  beforeEach(() => {
    __resetMeshcomodConfigCache();
    vi.clearAllMocks();
  });

  it('does not fetch when not meshcomod', () => {
    renderHook(() => useMeshcomodConfig(false));
    expect(api.getMeshcomodConfig).not.toHaveBeenCalled();
  });

  it('fetches once and shares state across consumers', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(false));
    const a = renderHook(() => useMeshcomodConfig(true));
    const b = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(a.result.current.cadSupported).toBe(true));
    expect(b.result.current.cadEnabled).toBe(false);
    expect(api.getMeshcomodConfig).toHaveBeenCalledTimes(1);
  });

  it('toggles cad (false -> true) and broadcasts the new value', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(false));
    (api.updateMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(true));
    const { result } = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(result.current.cadSupported).toBe(true));
    await act(async () => {
      await result.current.toggleCad();
    });
    expect(api.updateMeshcomodConfig).toHaveBeenCalledWith({ cad_enabled: true });
    expect(result.current.cadEnabled).toBe(true);
  });

  it('toggles unknown (null -> true)', async () => {
    (api.getMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(null));
    (api.updateMeshcomodConfig as ReturnType<typeof vi.fn>).mockResolvedValue(cfg(true));
    const { result } = renderHook(() => useMeshcomodConfig(true));
    await waitFor(() => expect(result.current.cadEnabled).toBe(null));
    await act(async () => {
      await result.current.toggleCad();
    });
    expect(api.updateMeshcomodConfig).toHaveBeenCalledWith({ cad_enabled: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/test/useMeshcomodConfig.test.ts`
Expected: FAIL — cannot resolve `../hooks/useMeshcomodConfig`.

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useMeshcomodConfig.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MeshcomodConfig } from '../types';

export const MESHCOMOD_CONFIG_CHANGE_EVENT = 'remoteterm-meshcomod-config-change';

// Module-level single source of truth. Reading CAD hits the radio, so the config
// is fetched at most once and shared by every consumer via the change event.
let cache: MeshcomodConfig | null = null;
let inflight: Promise<MeshcomodConfig> | null = null;

function broadcast(cfg: MeshcomodConfig | null): void {
  cache = cfg;
  window.dispatchEvent(new CustomEvent(MESHCOMOD_CONFIG_CHANGE_EVENT, { detail: cfg }));
}

/** Test-only: clear the module cache between cases. */
export function __resetMeshcomodConfigCache(): void {
  cache = null;
  inflight = null;
}

export interface UseMeshcomodConfig {
  config: MeshcomodConfig | null;
  cadSupported: boolean;
  cadEnabled: boolean | null;
  setCad: (value: boolean) => Promise<void>;
  toggleCad: () => Promise<void>;
}

export function useMeshcomodConfig(isMeshcomod: boolean): UseMeshcomodConfig {
  const [config, setConfig] = useState<MeshcomodConfig | null>(cache);

  // Stay in sync with every other consumer.
  useEffect(() => {
    const onChange = (e: Event) =>
      setConfig((e as CustomEvent<MeshcomodConfig | null>).detail);
    window.addEventListener(MESHCOMOD_CONFIG_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(MESHCOMOD_CONFIG_CHANGE_EVENT, onChange);
  }, []);

  // Fetch once when we learn a meshcomod device is connected.
  useEffect(() => {
    if (!isMeshcomod) return;
    if (cache !== null) {
      setConfig(cache);
      return;
    }
    if (!inflight) {
      inflight = api.getMeshcomodConfig();
      inflight
        .then((cfg) => broadcast(cfg))
        .catch((err) => console.error('Failed to load meshcomod config:', err))
        .finally(() => {
          inflight = null;
        });
    }
  }, [isMeshcomod]);

  const setCad = useCallback(async (value: boolean) => {
    const next = await api.updateMeshcomodConfig({ cad_enabled: value });
    broadcast(next);
  }, []);

  const toggleCad = useCallback(async () => {
    const current = cache?.cad_enabled ?? null;
    await setCad(current === true ? false : true);
  }, [setCad]);

  return {
    config,
    cadSupported: config?.cad_supported ?? false,
    cadEnabled: config?.cad_enabled ?? null,
    setCad,
    toggleCad,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/test/useMeshcomodConfig.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the hooks barrel**

In `frontend/src/hooks/index.ts`, add at the end:
```ts
export { useMeshcomodConfig, MESHCOMOD_CONFIG_CHANGE_EVENT } from './useMeshcomodConfig';
```

- [ ] **Step 6 (optional): Commit** — only if authorized

```bash
git add frontend/src/hooks/useMeshcomodConfig.ts frontend/src/hooks/index.ts frontend/src/test/useMeshcomodConfig.test.ts
git commit -m "feat(meshcomod): add shared useMeshcomodConfig hook"
```

---

## Task 2: Refactor MeshcomodSettings onto the shared hook

**Files:**
- Modify: `frontend/src/components/settings/MeshcomodSettings.tsx`

- [ ] **Step 1: Replace the local fetch/state with the hook**

In `MeshcomodSettings.tsx`, replace the local `useState`/`useEffect` fetch and the
`save` helper so the component reads config from the hook and writes CAD through
it (GPS still uses `api.updateMeshcomodConfig` directly via a local `save`).

Replace the top of the component body:
```tsx
export function MeshcomodSettings({ health }: Props) {
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const [cfg, setCfg] = useState<MeshcomodConfig | null>(null);

  useEffect(() => {
    if (!isMeshcomod) return;
    let cancelled = false;
    api
      .getMeshcomodConfig()
      .then((data) => {
        if (!cancelled) setCfg(data);
      })
      .catch((err) => console.error('Failed to load meshcomod config:', err));
    return () => {
      cancelled = true;
    };
  }, [isMeshcomod]);

  if (!isMeshcomod) return null;

  const save = async (update: MeshcomodConfigUpdate) => {
    const next = await api.updateMeshcomodConfig(update);
    setCfg(next);
  };
```
with:
```tsx
export function MeshcomodSettings({ health }: Props) {
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const { config: cfg, setCad } = useMeshcomodConfig(isMeshcomod);

  if (!isMeshcomod) return null;

  // GPS writes go straight through the API and rebroadcast via the hook cache.
  const save = async (update: MeshcomodConfigUpdate) => {
    await api.updateMeshcomodConfig(update);
    // Re-read so the shared cache reflects GPS changes too.
    const next = await api.getMeshcomodConfig();
    broadcastMeshcomodConfig(next);
  };
```

- [ ] **Step 2: Update the CAD checkbox to use `setCad`, and fix imports**

Change the CAD checkbox handler from `onCheckedChange={(checked) => save({ cad_enabled: checked === true })}` to:
```tsx
          onCheckedChange={(checked) => setCad(checked === true)}
```
Update imports at the top of the file:
```tsx
import { api } from '../../api';
import type { HealthStatus, MeshcomodConfig, MeshcomodConfigUpdate } from '../../types';
import { useMeshcomodConfig } from '../../hooks';
import { broadcastMeshcomodConfig } from '../../hooks/useMeshcomodConfig';
```
Remove the now-unused `useState`/`useEffect` React imports if they are no longer
referenced elsewhere in the file (check the top `import { ... } from 'react'`).

- [ ] **Step 3: Export `broadcastMeshcomodConfig` from the hook**

The GPS path needs to publish into the shared cache. In
`frontend/src/hooks/useMeshcomodConfig.ts`, rename the private `broadcast` usage
by adding an exported wrapper (keep internal `broadcast` too):
```ts
/** Publish an externally-fetched config into the shared cache. */
export function broadcastMeshcomodConfig(cfg: MeshcomodConfig): void {
  broadcast(cfg);
}
```

- [ ] **Step 4: Run the existing settings test + typecheck**

Run: `cd frontend && npx vitest run src/test/meshcomodSettings.test.tsx`
Expected: PASS. If the existing test stubbed `api.getMeshcomodConfig`/`updateMeshcomodConfig`, it still resolves through the hook; adjust the test only if it asserted the old local-state timing (keep behaviour: CAD checkbox reflects config and writes `{cad_enabled}`).

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5 (optional): Commit** — only if authorized

```bash
git add frontend/src/components/settings/MeshcomodSettings.tsx frontend/src/hooks/useMeshcomodConfig.ts
git commit -m "refactor(meshcomod): settings panel uses shared config hook"
```

---

## Task 3: Thread CAD props through App and ConversationPane

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ConversationPane.tsx`

- [ ] **Step 1: Use the hook in App and extend conversationPaneProps**

In `frontend/src/App.tsx`, add the import:
```tsx
import { useMeshcomodConfig } from './hooks';
```
(If `./hooks` is already imported as a group, add `useMeshcomodConfig` to that existing import list instead of adding a new line.)

After `health` is available (the `useRadioControl()` destructure), add:
```tsx
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const { cadSupported, cadEnabled, toggleCad } = useMeshcomodConfig(isMeshcomod);
  const handleToggleCad = useCallback(async () => {
    try {
      const next = cadEnabled === true ? false : true;
      await toggleCad();
      toast.success(next ? 'CAD enabled' : 'CAD disabled');
    } catch {
      toast.error('Failed to toggle CAD');
    }
  }, [cadEnabled, toggleCad]);
```

In the `conversationPaneProps` object literal, add these four properties:
```tsx
    cadCapable: isMeshcomod,
    cadSupported,
    cadEnabled,
    onToggleCad: handleToggleCad,
```

- [ ] **Step 2: Accept and forward the props in ConversationPane**

In `frontend/src/components/ConversationPane.tsx`, add to the props interface
(near `onSetChannelPathHashModeOverride`):
```tsx
  cadCapable?: boolean;
  cadSupported?: boolean;
  cadEnabled?: boolean | null;
  onToggleCad?: () => void;
```
Add them to the destructured parameters (near `onSetChannelPathHashModeOverride`):
```tsx
  cadCapable,
  cadSupported,
  cadEnabled,
  onToggleCad,
```
And pass them into `<ChatHeader … />` (next to `onSetChannelPathHashModeOverride={onSetChannelPathHashModeOverride}`):
```tsx
        cadCapable={cadCapable}
        cadSupported={cadSupported}
        cadEnabled={cadEnabled}
        onToggleCad={onToggleCad}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run build`
Expected: build fails only inside `ChatHeader` (props not yet accepted) — that is expected and fixed in Task 4. If it fails elsewhere, stop and fix the wiring.

- [ ] **Step 4 (optional): Commit** — only if authorized (after Task 4 compiles)

Defer the commit for Tasks 3+4 to the end of Task 4 so the tree compiles.

---

## Task 4: The CAD button in ChatHeader (TDD)

**Files:**
- Modify: `frontend/src/components/ChatHeader.tsx`
- Test: `frontend/src/test/chatHeaderCadToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/chatHeaderCadToggle.test.tsx`. Model the render setup on
the existing `src/test/chatHeaderKeyVisibility.test.tsx` (same required
`ChatHeader` props). Import `ChatHeader`, render a **channel** conversation, and
assert:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect } from 'vitest';
import { ChatHeader } from '../components/ChatHeader';
// NOTE: reuse the exact baseline props object from chatHeaderKeyVisibility.test.tsx
// (a channel-type conversation). Import/copy that helper so all required props are set.
import { makeChannelChatHeaderProps } from './helpers/chatHeaderProps';

describe('ChatHeader CAD toggle', () => {
  it('is hidden when the device is not CAD-capable', () => {
    render(<ChatHeader {...makeChannelChatHeaderProps({ cadCapable: false, cadSupported: false })} />);
    expect(screen.queryByRole('button', { name: /channel activity detection/i })).toBeNull();
  });

  it('is hidden when firmware does not support CAD', () => {
    render(<ChatHeader {...makeChannelChatHeaderProps({ cadCapable: true, cadSupported: false })} />);
    expect(screen.queryByRole('button', { name: /channel activity detection/i })).toBeNull();
  });

  it('shows on-state and toggles on click', async () => {
    const onToggleCad = vi.fn();
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({ cadCapable: true, cadSupported: true, cadEnabled: true, onToggleCad })}
      />
    );
    const btn = screen.getByRole('button', { name: /channel activity detection/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    expect(onToggleCad).toHaveBeenCalledTimes(1);
  });

  it('omits aria-pressed when state is unknown (null)', () => {
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({ cadCapable: true, cadSupported: true, cadEnabled: null })}
      />
    );
    const btn = screen.getByRole('button', { name: /channel activity detection/i });
    expect(btn).not.toHaveAttribute('aria-pressed');
  });
});
```

Also create `frontend/src/test/helpers/chatHeaderProps.ts` exporting
`makeChannelChatHeaderProps(overrides)` that returns a complete valid
`ChatHeader` props object for a `conversation.type === 'channel'` case (copy the
baseline shape used by `chatHeaderKeyVisibility.test.tsx` so every required prop
is present), spreading `overrides` last.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/test/chatHeaderCadToggle.test.tsx`
Expected: FAIL — button not found (not implemented yet).

- [ ] **Step 3: Add the props and the button to ChatHeader**

In `frontend/src/components/ChatHeader.tsx`, add to the props interface:
```tsx
  cadCapable?: boolean;
  cadSupported?: boolean;
  cadEnabled?: boolean | null;
  onToggleCad?: () => void;
```
Add to the destructured function parameters:
```tsx
  cadCapable,
  cadSupported,
  cadEnabled,
  onToggleCad,
```
Add a handler near the other `handleEdit…` handlers:
```tsx
  const handleToggleCad = () => {
    onToggleCad?.();
  };
```
Insert the button in the channel-action row, immediately AFTER the
"Set path hop width override" `{showPathHashModeOverride && ( … )}` block
(around line 457–470):
```tsx
        {conversation.type === 'channel' && cadCapable && cadSupported && onToggleCad && (
          <button
            type="button"
            onClick={handleToggleCad}
            aria-pressed={cadEnabled === null || cadEnabled === undefined ? undefined : cadEnabled}
            aria-label="Toggle channel activity detection"
            title={
              cadEnabled === null || cadEnabled === undefined
                ? 'CAD state unknown — click to enable channel activity detection'
                : cadEnabled
                  ? 'CAD on — scans for channel activity before transmit; click to disable'
                  : 'CAD off — click to enable channel activity detection'
            }
            className={cn(
              'flex items-center rounded px-1 text-[0.6875rem] font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              cadEnabled === true
                ? 'text-status-connected'
                : cadEnabled === false
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-muted-foreground/50 hover:text-muted-foreground'
            )}
          >
            CAD
          </button>
        )}
```
(`cn` is already imported in `ChatHeader.tsx`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/test/chatHeaderCadToggle.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Full typecheck + build**

Run: `cd frontend && npm run build`
Expected: build succeeds (Task 3 wiring now compiles).

- [ ] **Step 6 (optional): Commit** — only if authorized

```bash
git add frontend/src/App.tsx frontend/src/components/ConversationPane.tsx frontend/src/components/ChatHeader.tsx frontend/src/test/chatHeaderCadToggle.test.tsx frontend/src/test/helpers/chatHeaderProps.ts
git commit -m "feat(meshcomod): add CAD toggle to channel header"
```

---

## Task 5: Full test run + runtime verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (including the new hook + ChatHeader tests and the existing `meshcomodSettings.test.tsx`).

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: `tsc` + vite build succeed.

- [ ] **Step 3: Runtime observation**

Launch the dev server (preview_start with the `frontend-dev` launch config) and open a **channel** conversation. The connected dev device reports `is_meshcomod`. Confirm (screenshots):
- the "CAD" label appears in the channel header action row, coloured per state;
- clicking it toggles state and shows a toast;
- opening Settings → Radio → Meshcomod (DMC-EV) shows the CAD checkbox matching the header (and toggling either updates the other);
- the "CAD" label is ABSENT on a DM/contact header.

- [ ] **Step 4: Report results**

Report the two independent checks with evidence: (a) `npx vitest run` summary, (b) `npm run build` output, plus runtime screenshots. Mark anything unverified explicitly (e.g. if the dev device does not report `cad_supported`, note that the on/off colours were verified via the unit tests and computed styles rather than a live toggle).

- [ ] **Step 5 (optional): Finish branch** — only if authorized

Use `superpowers:finishing-a-development-branch`; PR/merge targets `origin`.

---

## Self-review notes

- **Spec coverage:** shared hook + event (T1), settings refactor to shared source (T2), App/ConversationPane wiring (T3), channel-header button with on/off/unknown states + one-click toggle + toast + channel-only + capability gate (T4), full verification incl. sync-both-ways and DM-absent (T5). All spec sections mapped.
- **Type/name consistency:** hook exports `useMeshcomodConfig`, `MESHCOMOD_CONFIG_CHANGE_EVENT`, `broadcastMeshcomodConfig`, `__resetMeshcomodConfigCache`; return fields `config/cadSupported/cadEnabled/setCad/toggleCad` are used identically in T2–T4. Prop names `cadCapable/cadSupported/cadEnabled/onToggleCad` match across App, ConversationPane, and ChatHeader. `aria-label` "Toggle channel activity detection" matches the test's `name: /channel activity detection/i`.
- **No placeholders:** all code/commands concrete. The one indirection is `makeChannelChatHeaderProps`, defined in T4 Step 1 by copying the existing baseline props from `chatHeaderKeyVisibility.test.tsx`; the executor must open that file and mirror its props object (documented in-step).
