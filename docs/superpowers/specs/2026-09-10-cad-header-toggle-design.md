# CAD header toggle — design

Status: approved (design phase). Date: 2026-09-10.

## Goal

Surface the existing meshcomod **CAD (Channel Activity Detection)** toggle as a
one-click button in the channel conversation header — beside the "Set regional
override" and "Set path hop width override" buttons — shown only when a
CAD-capable DMC-EV (meshcomod) device is connected. It reflects and controls the
same device-wide CAD state already exposed in Settings → Radio → Meshcomod
(DMC-EV), and the two stay in sync.

## Non-goals

- No backend or API changes. `GET`/`PATCH /radio/meshcomod`
  (`api.getMeshcomodConfig` / `api.updateMeshcomodConfig`) and the
  `health.radio_device_info.is_meshcomod` capability flag already exist
  (commit b806c5d).
- No change to CAD firmware semantics, GPS settings, or any theme.
- No button on non-channel (DM/contact) headers.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| Interaction | One-click toggle (no dialog); toast on change |
| Visibility | Channel headers only, and only when CAD-capable device connected |
| Unknown state (`cad_enabled === null`) | Neutral/indeterminate until read-back resolves |
| Presentation | Compact **"CAD"** text label, coloured by state, hover tooltip (not an icon; `Radar` is a trivial future swap) |

## Existing architecture (verified)

- `health.radio_device_info.is_meshcomod: boolean` — true when the connected
  companion runs meshcomod DMC/DMC-EV firmware (FIRMWARE_VER_CODE 27). Present on
  the health payload, which is already threaded through the app
  (`App` → `conversationPaneProps.health` → `ConversationPane` → renders
  `ChatHeader`).
- `MeshcomodConfig { cad_supported: boolean; cad_enabled: boolean | null; … }`
  from `api.getMeshcomodConfig()`; `api.updateMeshcomodConfig({ cad_enabled })`
  returns the updated config. `cad_enabled` is `null` until a read-back resolves.
  Reading hits the radio (raw 0x15 tuning frame), so it must not be re-fetched
  per channel.
- `frontend/src/components/settings/MeshcomodSettings.tsx` currently fetches its
  own `MeshcomodConfig` and renders the CAD + GPS controls (gated on
  `is_meshcomod`).
- `ChatHeader.tsx` renders the channel-action button row: "Set regional override"
  (`onSetChannelFloodScopeOverride`, ~line 439) and "Set path hop width override"
  (`onSetChannelPathHashModeOverride`, ~line 461). `ChatHeader` does **not**
  currently receive `health` or any meshcomod data. `ConversationPane` already
  receives `health` and forwards the override handlers to `ChatHeader`.
- The codebase uses a module-level "settings + window CustomEvent" pattern for
  cross-component sync (e.g. `STATUS_DOT_PULSE_CHANGE_EVENT`,
  `BATTERY_DISPLAY_CHANGE_EVENT` in `utils/`).

## Implementation

### 1. Shared meshcomod config hook (DRY, single source of truth)

Create `frontend/src/hooks/useMeshcomodConfig.ts`:

- Module-level cache: `let cache: MeshcomodConfig | null` and a
  `MESHCOMOD_CONFIG_CHANGE_EVENT` window CustomEvent carrying the latest config.
- `useMeshcomodConfig(isMeshcomod: boolean)` returns
  `{ config: MeshcomodConfig | null; cadSupported: boolean; cadEnabled: boolean | null; toggleCad: () => Promise<void>; setCad: (v: boolean) => Promise<void> }`.
- On first mount where `isMeshcomod` is true and `cache` is null, fetch
  `api.getMeshcomodConfig()` once, store in `cache`, dispatch the event.
- Subscribes to `MESHCOMOD_CONFIG_CHANGE_EVENT` to re-render with the latest
  cache (so all consumers stay in sync).
- `setCad(v)` / `toggleCad()` call `api.updateMeshcomodConfig({ cad_enabled })`,
  update `cache`, dispatch the event. `toggleCad` maps `null → true`,
  `true → false`, `false → true`.
- Guards: no fetch when `!isMeshcomod`; swallow/log fetch errors; `toggleCad`
  surfaces failures to the caller for a toast.

`MeshcomodSettings.tsx` is refactored to consume `useMeshcomodConfig(isMeshcomod)`
instead of its own local fetch, so the Settings checkbox and the header button
read/write the one cached config and re-render together.

### 2. Wiring into the header

- `App.tsx`: derive `isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false`,
  call `useMeshcomodConfig(isMeshcomod)`, and add to `conversationPaneProps`:
  `cadCapable: isMeshcomod`, `cadSupported`, `cadEnabled`, and
  `onToggleCad` (wraps `toggleCad` with a success/error toast).
- `ConversationPane.tsx`: accept the four new props and forward them to
  `ChatHeader`.
- `ChatHeader.tsx`: accept `cadCapable`, `cadSupported`, `cadEnabled`,
  `onToggleCad`.

### 3. The button (ChatHeader channel-action row)

Rendered immediately after the "Set path hop width override" button, only when
`conversation.type === 'channel' && cadCapable && cadSupported`.

```tsx
{conversation.type === 'channel' && cadCapable && cadSupported && onToggleCad && (
  <button
    type="button"
    onClick={handleToggleCad}
    aria-pressed={cadEnabled === null ? undefined : cadEnabled}
    title={
      cadEnabled === null
        ? 'CAD state unknown — click to enable channel activity detection'
        : cadEnabled
          ? 'CAD on — scan for channel activity before transmit; click to disable'
          : 'CAD off — click to enable channel activity detection'
    }
    aria-label="Toggle channel activity detection"
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

`handleToggleCad` calls `onToggleCad()` and shows a toast:
`CAD enabled` / `CAD disabled` on success, error toast on failure. It is a plain
text label (not an icon and not a literal SVG) so it inherits every theme's
tokens (`text-status-connected`, `text-muted-foreground`) automatically,
including DarkDutch, and remains screen-reader friendly.

## Files touched

- `frontend/src/hooks/useMeshcomodConfig.ts` — **create** (shared hook + event).
- `frontend/src/hooks/index.ts` — export the hook (if the folder uses a barrel).
- `frontend/src/components/settings/MeshcomodSettings.tsx` — **modify**: use the hook.
- `frontend/src/App.tsx` — **modify**: use hook, extend `conversationPaneProps`.
- `frontend/src/components/ConversationPane.tsx` — **modify**: forward props.
- `frontend/src/components/ChatHeader.tsx` — **modify**: the CAD button.

## Verification (evidence required before "done")

1. `npm run build` (tsc + vite) passes.
2. Unit tests (`vitest`): (a) `useMeshcomodConfig` fetches once when meshcomod,
   toggles via `updateMeshcomodConfig`, and broadcasts so a second consumer
   re-renders; (b) `ChatHeader` hides the button when `!cadCapable` or
   `!cadSupported`, shows correct colour/`aria-pressed` for on/off/null, and
   calls `onToggleCad` on click. Existing `meshcomodSettings.test.tsx` still passes
   after the refactor.
3. Runtime: the connected dev device reports `is_meshcomod`. Observe the "CAD"
   label on a channel header, toggle it, confirm the toast, and confirm the
   Settings → Radio → Meshcomod checkbox reflects the change (and vice-versa).
   Confirm the button is absent on a DM/contact header.

## Risks

- **Sync mechanism**: module-level cache + event must not leak across radio
  reconnects with different capabilities. Mitigation: the hook keys visibility on
  live `is_meshcomod`; on reconnect the health flag drives whether consumers show
  anything, and a fresh fetch repopulates the cache.
- **Read cost**: never fetch per-channel — the hook fetches once and caches.
- **Prop drilling**: four new props through `ConversationPane`. Acceptable; it
  already forwards the sibling override handlers the same way.
