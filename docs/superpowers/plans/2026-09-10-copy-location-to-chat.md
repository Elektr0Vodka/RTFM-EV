# Copy Location to Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **COMMIT POLICY (repo CLAUDE.md overrides the skill default):** Do NOT run the `git commit` steps unless the user has explicitly authorized commits in this session. If not authorized, skip each commit step and leave the changes in the working tree for review. Never push, never open a PR, no attribution lines. Branch prefix for this work is `feat/` targeting origin (Elektr0Vodka/RTFM-EV).

**Goal:** Let users insert a MeshCore Open location payload (`m:<lat>,<lon>|<label>|poi`) into the composer for channels and DMs from four sources, and render incoming `m:` payloads as clickable location cards that open the built-in map centered on the point.

**Architecture:** Two independent halves sharing one payload format. Insert side: a pin button + popover in `ChatHeader` and a Leaflet `LocationPickerModal` call `appendText` via a new `useConversationActions` handler. Render side: a parser in `meshcoreOpenPayloads.ts` and a card renderer in `MessageList` (under the existing rich-payload path) whose click navigates to the `map` conversation, focused on arbitrary coordinates via a new `mapFocusLatLon` and a `map/at/<lat>,<lon>` URL hash.

**Tech Stack:** React 18 + TypeScript, react-leaflet 4, Vitest 4 + @testing-library/react, lucide-react icons, Tailwind.

---

## File Structure

New files:
- `frontend/src/utils/mapTiles.ts` — shared Leaflet tile-layer presets (moved out of `MapView.tsx`).
- `frontend/src/components/LocationPickerModal.tsx` — map modal for picking a point + optional label.
- `frontend/src/test/markerPayload.test.ts` — unit tests for build/parse/sanitize.
- `frontend/src/test/mapAtHash.test.ts` — unit tests for the `map/at/<lat>,<lon>` hash.
- `frontend/src/test/messageListMarker.test.tsx` — location-card render + click.
- `frontend/src/test/chatHeaderLocation.test.tsx` — pin popover quick-insert.
- `frontend/src/test/locationPickerModal.test.tsx` — modal confirm.

Modified files:
- `frontend/src/utils/meshcoreOpenPayloads.ts` — add `buildMarkerPayload`, `sanitizeMarkerLabel`, `parseMarker`, `ParsedMarker`.
- `frontend/src/components/MapView.tsx` — import shared tiles; add `focusedLatLon`/`focusedLabel` + highlight marker.
- `frontend/src/types.ts` — add `mapFocusLatLon`/`mapFocusLabel` to the `map` conversation variant.
- `frontend/src/utils/urlHash.ts` — parse/build `map/at/<lat>,<lon>`.
- `frontend/src/hooks/useConversationRouter.ts` — carry `mapFocusLatLon`/`mapFocusLabel`.
- `frontend/src/utils/lastViewedConversation.ts` — carry `mapFocusLatLon`/`mapFocusLabel`.
- `frontend/src/components/MessageList.tsx` — location card + `onCoordinateClick` threading.
- `frontend/src/components/ChatHeader.tsx` — pin button, popover, GPS, modal.
- `frontend/src/components/ConversationPane.tsx` — thread `onInsertLocation`, `onCoordinateClick`, `focusedLatLon`/`focusedLabel`.
- `frontend/src/hooks/useConversationActions.ts` — `handleInsertLocation`.
- `frontend/src/App.tsx` — `handleCoordinateClick`; wire `onInsertLocation`/`onCoordinateClick` into the ConversationPane props bag.

**Commands run from the worktree root.** Frontend scripts: `npm --prefix frontend run test:run -- <file>` (Vitest), `npm --prefix frontend run lint`, `npm --prefix frontend run build` (tsc + vite).

---

## Task 1: Extract tile presets into a shared module

Pure refactor. Move `TILE_LAYERS`, its `TileLayerPreset` type, and the `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM` constants out of `MapView.tsx` so the picker can reuse them. No behavior change.

**Files:**
- Create: `frontend/src/utils/mapTiles.ts`
- Modify: `frontend/src/components/MapView.tsx` (lines ~41-131 define these today)

- [ ] **Step 1: Create the shared module**

Create `frontend/src/utils/mapTiles.ts` with the exact content currently in `MapView.tsx` (copy the `TileLayerPreset` interface, the `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM` constants, and the full `TILE_LAYERS` array verbatim, keeping every attribution string and comment):

```ts
// Leaflet tile-layer presets shared by MapView and LocationPickerModal.
// Every provider here is free and works without an API key. Attribution strings
// follow each provider's requirements; do not remove them. If you add a new
// provider, verify its terms of service (especially for Esri / Google-style
// satellite tiles) before committing.
export interface TileLayerPreset {
  id: string;
  label: string;
  url: string;
  attribution: string;
  background: string;
  /** Highest zoom the provider publishes tiles at. */
  maxZoom?: number;
}

// Global zoom bounds pinned to the MapContainer so Leaflet's tile-range math
// never has to guess when layers swap in/out via LayersControl.
export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 19;

export const TILE_LAYERS: readonly TileLayerPreset[] = [
  // ... COPY the six entries (light, darkgray, lightgray, topographic, natgeo,
  // satellite) verbatim from MapView.tsx, including their comments and maxZoom.
] as const;
```

When copying, paste the real six entries from `MapView.tsx` (do not abbreviate). The array must be byte-identical to the current one.

- [ ] **Step 2: Update MapView to import from the shared module**

In `frontend/src/components/MapView.tsx`:
- Delete the local `TileLayerPreset` interface, the `MAP_MIN_ZOOM`/`MAP_MAX_ZOOM` constants, and the `TILE_LAYERS` array.
- Add this import near the other util imports:

```ts
import { TILE_LAYERS, MAP_MIN_ZOOM, MAP_MAX_ZOOM, type TileLayerPreset } from '../utils/mapTiles';
```

- If `TileLayerPreset` is not referenced elsewhere in `MapView.tsx`, drop it from the import to satisfy the linter. Leave all other code (getSavedLayerId, LayerChangeWatcher, etc.) unchanged.

- [ ] **Step 3: Verify types, lint, and existing tests**

Run: `npm --prefix frontend run build`
Expected: PASS (tsc clean, vite build succeeds).

Run: `npm --prefix frontend run test:run -- src/test/mapView.test.tsx`
Expected: PASS (existing MapView tests unaffected).

- [ ] **Step 4: Commit** (only if commits are authorized — see COMMIT POLICY)

```bash
git add frontend/src/utils/mapTiles.ts frontend/src/components/MapView.tsx
git commit -m "refactor(map): extract tile presets into shared mapTiles module"
```

---

## Task 2: Marker payload build/parse/sanitize utilities

**Files:**
- Modify: `frontend/src/utils/meshcoreOpenPayloads.ts`
- Test: `frontend/src/test/markerPayload.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/markerPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildMarkerPayload,
  sanitizeMarkerLabel,
  parseMarker,
} from '../utils/meshcoreOpenPayloads';

describe('sanitizeMarkerLabel', () => {
  it('removes pipes and trims', () => {
    expect(sanitizeMarkerLabel('  a|b|c  ')).toBe('abc');
  });
});

describe('buildMarkerPayload', () => {
  it('formats coords to 6 decimals with a poi flag', () => {
    expect(buildMarkerPayload(52.123456789, 4.1, 'Home')).toBe('m:52.123457,4.100000|Home|poi');
  });

  it('allows an empty label', () => {
    expect(buildMarkerPayload(1, 2, '')).toBe('m:1.000000,2.000000||poi');
  });

  it('sanitizes a pipe out of the label', () => {
    expect(buildMarkerPayload(1, 2, 'a|b')).toBe('m:1.000000,2.000000|ab|poi');
  });
});

describe('parseMarker', () => {
  it('parses a full payload', () => {
    expect(parseMarker('m:52.123456,4.123456|Home|poi')).toEqual({
      lat: 52.123456,
      lon: 4.123456,
      label: 'Home',
      flags: 'poi',
    });
  });

  it('parses an empty label', () => {
    expect(parseMarker('m:1.5,2.5||poi')).toEqual({ lat: 1.5, lon: 2.5, label: '', flags: 'poi' });
  });

  it('parses negative coordinates', () => {
    const parsed = parseMarker('m:-33.865143,-151.209900|Sydney|poi');
    expect(parsed?.lat).toBeCloseTo(-33.865143, 6);
    expect(parsed?.lon).toBeCloseTo(-151.2099, 6);
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseMarker('m:200,4|x|poi')).toBeNull();
  });

  it('rejects 0,0 (treated as unset)', () => {
    expect(parseMarker('m:0,0|x|poi')).toBeNull();
  });

  it('rejects text missing the second pipe', () => {
    expect(parseMarker('m:1.5,2.5|Home')).toBeNull();
  });

  it('rejects non-marker text', () => {
    expect(parseMarker('hello world')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseMarker('  m:1.5,2.5|Home|poi  ')?.label).toBe('Home');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test:run -- src/test/markerPayload.test.ts`
Expected: FAIL (buildMarkerPayload/sanitizeMarkerLabel/parseMarker are not exported).

- [ ] **Step 3: Implement the utilities**

In `frontend/src/utils/meshcoreOpenPayloads.ts`, add this import at the top (after the file's doc comment, alongside future imports):

```ts
import { isValidLocation } from './pathUtils';
```

Then append at the end of the file:

```ts
// --- Location marker (m:<lat>,<lon>|<label>|<flags>) ---
//
// MeshCore Open shares a location as this plaintext payload (see meshcore-open
// lib/screens/map_screen.dart _formatMarkerMessage / parseMarkerText). The flag
// "poi" marks a shared point of interest. Coordinates use 6 decimals.

// Anchored whole-body match (like parseGif/parseReaction). Both pipes required;
// the label (group 3) cannot contain a pipe.
const MARKER_PATTERN = /^m:(-?[0-9.]+),(-?[0-9.]+)\|([^|]*)\|(.*)$/;

export interface ParsedMarker {
  lat: number;
  lon: number;
  label: string;
  flags: string;
}

/** Remove pipe characters (they delimit the payload) and trim. */
export function sanitizeMarkerLabel(label: string): string {
  return label.replace(/\|/g, '').trim();
}

/** Build a MeshCore Open location marker payload: `m:<lat>,<lon>|<label>|poi`. */
export function buildMarkerPayload(lat: number, lon: number, label: string): string {
  return `m:${lat.toFixed(6)},${lon.toFixed(6)}|${sanitizeMarkerLabel(label)}|poi`;
}

/**
 * Parse a MeshCore Open location marker payload. Returns the coordinates, label,
 * and flags, or null when the (trimmed) text is not a valid marker or the
 * coordinates are out of range / unset (0,0).
 */
export function parseMarker(text: string): ParsedMarker | null {
  const match = MARKER_PATTERN.exec(text.trim());
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lon = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isValidLocation(lat, lon)) {
    return null;
  }
  return { lat, lon, label: match[3].trim(), flags: match[4].trim() };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test:run -- src/test/markerPayload.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/utils/meshcoreOpenPayloads.ts frontend/src/test/markerPayload.test.ts
git commit -m "feat(location): add marker payload build/parse helpers"
```

---

## Task 3: `map/at/<lat>,<lon>` URL hash parse and build

**Files:**
- Modify: `frontend/src/utils/urlHash.ts`
- Test: `frontend/src/test/mapAtHash.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/mapAtHash.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseHashConversation, getConversationHash } from '../utils/urlHash';

describe('map/at hash', () => {
  let originalHash: string;
  beforeEach(() => {
    originalHash = window.location.hash;
  });
  afterEach(() => {
    window.location.hash = originalHash;
  });

  it('parses #map/at/<lat>,<lon>', () => {
    window.location.hash = '#map/at/52.123456,4.123456';
    expect(parseHashConversation()).toEqual({
      type: 'map',
      name: 'map',
      mapFocusLatLon: [52.123456, 4.123456],
    });
  });

  it('parses negative coordinates', () => {
    window.location.hash = '#map/at/-33.865143,-151.2099';
    const parsed = parseHashConversation();
    expect(parsed?.mapFocusLatLon?.[0]).toBeCloseTo(-33.865143, 6);
    expect(parsed?.mapFocusLatLon?.[1]).toBeCloseTo(-151.2099, 6);
  });

  it('falls back to plain map for a malformed at-hash', () => {
    window.location.hash = '#map/at/notcoords';
    expect(parseHashConversation()).toEqual({ type: 'map', name: 'map' });
  });

  it('builds #map/at from a map conversation with mapFocusLatLon', () => {
    expect(
      getConversationHash({ type: 'map', id: 'map', name: 'Node Map', mapFocusLatLon: [52.123456, 4.123456] })
    ).toBe('#map/at/52.123456,4.123456');
  });

  it('builds plain #map when no focus is set', () => {
    expect(getConversationHash({ type: 'map', id: 'map', name: 'Node Map' })).toBe('#map');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend run test:run -- src/test/mapAtHash.test.ts`
Expected: FAIL (no `map/at` handling; `mapFocusLatLon` not on the parsed type).

- [ ] **Step 3: Implement parse + build**

In `frontend/src/utils/urlHash.ts`:

Add `mapFocusLatLon` to the `ParsedHashConversation` interface (after `mapFocusKey?`):

```ts
  /** For map view: an arbitrary point to focus on */
  mapFocusLatLon?: [number, number];
```

Insert this block in `parseHashConversation`, immediately BEFORE the existing `if (hash.startsWith('map/focus/'))` block:

```ts
  // Check for map focused on an arbitrary point: #map/at/<lat>,<lon>
  if (hash.startsWith('map/at/')) {
    const coords = hash.slice('map/at/'.length);
    const [latRaw, lonRaw] = coords.split(',');
    const lat = Number.parseFloat(latRaw);
    const lon = Number.parseFloat(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { type: 'map', name: 'map', mapFocusLatLon: [lat, lon] };
    }
    return { type: 'map', name: 'map' };
  }
```

In `getConversationHash`, replace the line `if (conv.type === 'map') return '#map';` with:

```ts
  if (conv.type === 'map') {
    if (conv.mapFocusLatLon) {
      const [lat, lon] = conv.mapFocusLatLon;
      return `#map/at/${lat},${lon}`;
    }
    return '#map';
  }
```

(`conv.mapFocusLatLon` becomes valid on the `Conversation` type in Task 4; the field access compiles once that lands. If running Task 3 in isolation triggers a type error here, complete Task 4 before the build step — the two are a pair.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend run test:run -- src/test/mapAtHash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/utils/urlHash.ts frontend/src/test/mapAtHash.test.ts
git commit -m "feat(map): support map/at/<lat>,<lon> deep-link hash"
```

---

## Task 4: Extend the Conversation map variant and carry it through routing

**Files:**
- Modify: `frontend/src/types.ts` (lines ~371-378)
- Modify: `frontend/src/hooks/useConversationRouter.ts` (lines ~37-38, ~126-135)
- Modify: `frontend/src/utils/lastViewedConversation.ts` (lines ~72-97)

- [ ] **Step 1: Extend the type**

In `frontend/src/types.ts`, extend the `Conversation` interface:

```ts
export interface Conversation {
  type: ConversationType;
  /** PublicKey for contacts, ChannelKey for channels, 'raw'/'map' for special views */
  id: string;
  name: string;
  /** For map view: public key prefix to focus on */
  mapFocusKey?: string;
  /** For map view: an arbitrary point to focus on */
  mapFocusLatLon?: [number, number];
  /** For map view: label to show on the focused point's popup */
  mapFocusLabel?: string;
}
```

- [ ] **Step 2: Carry it through the router**

In `frontend/src/hooks/useConversationRouter.ts`, in `resolveConversationFromHash`, replace the `case 'map':` return with:

```ts
    case 'map':
      return {
        type: 'map',
        id: 'map',
        name: 'Node Map',
        mapFocusKey: hashConv.mapFocusKey,
        ...(hashConv.mapFocusLatLon && { mapFocusLatLon: hashConv.mapFocusLatLon }),
      };
```

In the same file, in the Phase 1 effect where `hashConv?.type === 'map'` sets state (around line 126), replace that `setActiveConversationState({ ... })` call with:

```ts
      setActiveConversationState({
        type: 'map',
        id: 'map',
        name: 'Node Map',
        mapFocusKey: hashConv.mapFocusKey,
        ...(hashConv.mapFocusLatLon && { mapFocusLatLon: hashConv.mapFocusLatLon }),
      });
```

- [ ] **Step 3: Carry it through last-viewed persistence**

In `frontend/src/utils/lastViewedConversation.ts`, in the parse path (around line 72) add the lat/lon spread to the returned map object:

```ts
    return {
      type: 'map',
      id: parsed.id,
      name: parsed.name,
      ...(typeof parsed.mapFocusKey === 'string' && { mapFocusKey: parsed.mapFocusKey }),
      ...(Array.isArray(parsed.mapFocusLatLon) && { mapFocusLatLon: parsed.mapFocusLatLon }),
    };
```

And in the save path (around line 91) add the spread:

```ts
  if (hashConversation.type === 'map') {
    saveLastViewedConversation({
      type: 'map',
      id: 'map',
      name: 'Node Map',
      ...(hashConversation.mapFocusKey && { mapFocusKey: hashConversation.mapFocusKey }),
      ...(hashConversation.mapFocusLatLon && { mapFocusLatLon: hashConversation.mapFocusLatLon }),
    });
    return;
  }
```

- [ ] **Step 4: Verify build and hash tests**

Run: `npm --prefix frontend run build`
Expected: PASS (Task 3's `getConversationHash` field access now type-checks).

Run: `npm --prefix frontend run test:run -- src/test/mapAtHash.test.ts src/test/urlHash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/types.ts frontend/src/hooks/useConversationRouter.ts frontend/src/utils/lastViewedConversation.ts
git commit -m "feat(map): carry mapFocusLatLon through conversation routing"
```

---

## Task 5: MapView focus on arbitrary coordinates + highlight marker

**Files:**
- Modify: `frontend/src/components/MapView.tsx`
- Test: `frontend/src/test/mapView.test.tsx` (add a case)

- [ ] **Step 1: Write the failing test (add to existing file)**

Append inside the existing `describe('MapView', ...)` block in `frontend/src/test/mapView.test.tsx`:

```ts
  it('renders a highlight marker popup for a focused point', () => {
    render(<MapView contacts={[]} focusedLatLon={[52.123456, 4.123456]} focusedLabel="Home" />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText(/52\.123456, 4\.123456/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/mapView.test.tsx`
Expected: FAIL (`focusedLatLon` prop not supported; texts absent).

- [ ] **Step 3: Implement the props and marker**

In `frontend/src/components/MapView.tsx`:

Add to `MapViewProps`:

```ts
  /** When set, center the map here and drop a temporary highlight marker. */
  focusedLatLon?: [number, number];
  /** Label shown in the highlight marker popup. */
  focusedLabel?: string;
```

Destructure them in the component signature:

```ts
export function MapView({
  contacts,
  focusedKey,
  config,
  blockedKeys,
  blockedNames,
  onSelectContact,
  focusedLatLon,
  focusedLabel,
}: MapViewProps) {
```

Extend `MapBoundsHandler` to accept and prioritize `focusedLatLon`. Change its props type and effect:

```ts
function MapBoundsHandler({
  contacts,
  focusedContact,
  focusedLatLon,
}: {
  contacts: Contact[];
  focusedContact: Contact | null;
  focusedLatLon?: [number, number];
}) {
  const map = useMap();
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (focusedLatLon) {
      map.setView(focusedLatLon, 15);
      setHasInitialized(true);
      return;
    }
    if (focusedContact && focusedContact.lat != null && focusedContact.lon != null) {
      map.setView([focusedContact.lat, focusedContact.lon], 12);
      setHasInitialized(true);
      return;
    }
    // ... keep the rest of the existing effect body unchanged ...
```

Add `focusedLatLon` to that effect's dependency array (append it to the existing deps list).

Pass the prop where `MapBoundsHandler` is rendered:

```tsx
          <MapBoundsHandler
            contacts={mappableContacts}
            focusedContact={focusedContact}
            focusedLatLon={focusedLatLon}
          />
```

Render the highlight marker. Immediately AFTER the `{mappableContacts.map(...)}` block and BEFORE `{showPackets && <ParticleOverlay .../>}`, add:

```tsx
          {focusedLatLon && (
            <CircleMarker
              center={focusedLatLon}
              radius={10}
              pathOptions={{
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.5,
                weight: 3,
              }}
            >
              <Popup>
                <div className="text-sm">
                  {focusedLabel ? (
                    <div className="font-medium">{focusedLabel}</div>
                  ) : (
                    <div className="font-medium">Shared location</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1 font-mono">
                    {focusedLatLon[0].toFixed(6)}, {focusedLatLon[1].toFixed(6)}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/mapView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/components/MapView.tsx frontend/src/test/mapView.test.tsx
git commit -m "feat(map): focus on arbitrary coordinates with highlight marker"
```

---

## Task 6: Location card renderer + `onCoordinateClick` in MessageList

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`
- Test: `frontend/src/test/messageListMarker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/messageListMarker.test.tsx`. This renders a single incoming channel message whose text is a marker payload and asserts the card renders and clicking it calls `onCoordinateClick`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import { RichPayloadContext } from '../contexts/RichPayloadContext';
import { PathHopWidthContext } from '../contexts/PathHopWidthContext';
import type { Message } from '../types';

function markerMessage(text: string): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'chan1',
    text,
    sender_name: 'Alice',
    sender_key: null,
    sender_timestamp: 1000,
    received_at: 1000,
    outgoing: false,
    acked: 0,
    paths: [],
    packet_id: null,
    region: null,
  } as unknown as Message;
}

function renderList(onCoordinateClick: (lat: number, lon: number, label: string) => void) {
  return render(
    <RichPayloadContext.Provider value={{ renderRichPayloads: true, setRenderRichPayloads: vi.fn() }}>
      <PathHopWidthContext.Provider value={{ showPathHopWidth: false, setShowPathHopWidth: vi.fn() }}>
        <MessageList
          messages={[markerMessage('Alice: m:52.123456,4.123456|Home|poi')]}
          contacts={[]}
          loading={false}
          onCoordinateClick={onCoordinateClick}
        />
      </PathHopWidthContext.Provider>
    </RichPayloadContext.Provider>
  );
}

describe('MessageList location card', () => {
  it('renders a clickable location card and calls onCoordinateClick', () => {
    const onCoordinateClick = vi.fn();
    renderList(onCoordinateClick);
    const button = screen.getByRole('button', { name: /show on map/i });
    expect(button).toHaveTextContent('Home');
    fireEvent.click(button);
    expect(onCoordinateClick).toHaveBeenCalledWith(52.123456, 4.123456, 'Home');
  });
});
```

Note: confirm the actual shapes of `RichPayloadContext`/`PathHopWidthContext` and the `Message` fields when writing this; adjust the provider values and message object to match the real context value type and required `Message` properties. The behavioral assertions (card text, role, click args) must stay.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/messageListMarker.test.tsx`
Expected: FAIL (`onCoordinateClick` prop unknown; no card).

- [ ] **Step 3: Implement the card + threading**

In `frontend/src/components/MessageList.tsx`:

Add `MapPin` to the lucide import (there is no lucide import today; add one near the top imports):

```ts
import { MapPin } from 'lucide-react';
```

Add the `parseMarker`/`ParsedMarker` import to the existing `meshcoreOpenPayloads` import:

```ts
import {
  giphyUrlForId,
  parseGif,
  parseReaction,
  splitReplyMention,
  parseMarker,
  type ParsedMarker,
} from '../utils/meshcoreOpenPayloads';
```

Add the card component near `GifPayload`/`ReactionPayload`:

```tsx
// Renders a MeshCore Open location marker (m:<lat>,<lon>|<label>|poi) as a
// clickable card. Clicking opens the built-in map centered on the point.
function MarkerMessage({
  marker,
  onCoordinateClick,
}: {
  marker: ParsedMarker;
  onCoordinateClick?: (lat: number, lon: number, label: string) => void;
}) {
  const coords = `${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}`;
  const inner = (
    <>
      <MapPin className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex flex-col text-left">
        {marker.label && <span className="font-medium leading-tight">{marker.label}</span>}
        <span className="font-mono text-xs text-muted-foreground">{coords}</span>
      </span>
    </>
  );
  if (!onCoordinateClick) {
    return <span className="inline-flex items-center gap-1.5">{inner}</span>;
  }
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onCoordinateClick(marker.lat, marker.lon, marker.label)}
      title="Show on map"
    >
      {inner}
    </button>
  );
}
```

Thread `onCoordinateClick` through the payload renderers. Change `renderPayloadBody`:

```tsx
function renderPayloadBody(
  body: string,
  onCoordinateClick?: (lat: number, lon: number, label: string) => void
): ReactNode | null {
  const gifId = parseGif(body);
  if (gifId) {
    return <GifPayload gifId={gifId} rawText={body} />;
  }
  const reaction = parseReaction(body);
  if (reaction) {
    return <ReactionPayload emoji={reaction.emoji} />;
  }
  const marker = parseMarker(body);
  if (marker) {
    return <MarkerMessage marker={marker} onCoordinateClick={onCoordinateClick} />;
  }
  return null;
}
```

Change `renderMeshcoreOpenPayload` to accept and forward `onCoordinateClick`:

```tsx
function renderMeshcoreOpenPayload(
  content: string,
  radioName?: string,
  onChannelReferenceClick?: (channelName: string) => void,
  onCoordinateClick?: (lat: number, lon: number, label: string) => void
): ReactNode | null {
  const whole = renderPayloadBody(content, onCoordinateClick);
  if (whole) return whole;

  const split = splitReplyMention(content);
  if (split) {
    const body = renderPayloadBody(split.body, onCoordinateClick);
    if (body) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {renderTextWithMentions(split.mention, radioName, onChannelReferenceClick)}
          {body}
        </span>
      );
    }
  }
  return null;
}
```

Add the prop to `MessageListProps` (near `onChannelReferenceClick`):

```ts
  onCoordinateClick?: (lat: number, lon: number, label: string) => void;
```

Destructure it in the `MessageList` function params (near `onChannelReferenceClick,`):

```ts
  onCoordinateClick,
```

Update the call site (currently around line 1319) to pass it:

```tsx
                      {(renderRichPayloads &&
                        renderMeshcoreOpenPayload(
                          content,
                          radioName,
                          onChannelReferenceClick,
                          onCoordinateClick
                        )) ||
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/messageListMarker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/components/MessageList.tsx frontend/src/test/messageListMarker.test.tsx
git commit -m "feat(chat): render location markers as clickable cards"
```

---

## Task 7: LocationPickerModal

**Files:**
- Create: `frontend/src/components/LocationPickerModal.tsx`
- Test: `frontend/src/test/locationPickerModal.test.tsx`

The modal keeps a `selected` LatLng in state, initialized to `initialCenter`. Map clicks and marker drag update `selected` (verified at runtime; jsdom cannot simulate Leaflet interaction). Confirm calls `onConfirm(selected.lat, selected.lon, label)`. Because `selected` defaults to `initialCenter`, confirm works without a map interaction, which makes it unit-testable.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/locationPickerModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LocationPickerModal } from '../components/LocationPickerModal';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  CircleMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn() }),
  useMapEvents: () => null,
}));

describe('LocationPickerModal', () => {
  it('confirms with the initial center and a typed label', () => {
    const onConfirm = vi.fn();
    render(
      <LocationPickerModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        contacts={[]}
        initialCenter={[52.123456, 4.123456]}
        initialLabel=""
      />
    );
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Meetup' } });
    fireEvent.click(screen.getByRole('button', { name: /insert/i }));
    expect(onConfirm).toHaveBeenCalledWith(52.123456, 4.123456, 'Meetup');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/locationPickerModal.test.tsx`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the modal**

Create `frontend/src/components/LocationPickerModal.tsx`:

```tsx
import { useState, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { TILE_LAYERS, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from '../utils/mapTiles';
import { isValidLocation } from '../utils/pathUtils';
import { Button } from './ui/button';
import type { Contact } from '../types';

interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (lat: number, lon: number, label: string) => void;
  contacts: Contact[];
  /** Initial map center and default selected point. */
  initialCenter: [number, number];
  /** Prefill for the label field. */
  initialLabel?: string;
}

// Leaflet click handler: moves the selection to the tapped point.
function ClickCapture({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  contacts,
  initialCenter,
  initialLabel = '',
}: LocationPickerModalProps) {
  const [selected, setSelected] = useState<[number, number]>(initialCenter);
  const [label, setLabel] = useState(initialLabel);

  const handlePick = useCallback((lat: number, lon: number) => {
    setSelected([lat, lon]);
  }, []);

  if (!open) return null;

  const baseLayer = TILE_LAYERS[0];
  const nodeMarkers = contacts.filter((c) => isValidLocation(c.lat, c.lon));

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pick a location"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xl">
        <h2 className="text-base font-semibold">Pick a location</h2>
        <div className="h-64 overflow-hidden rounded border border-border">
          <MapContainer
            center={initialCenter}
            zoom={13}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            className="h-full w-full"
            style={{ background: baseLayer.background }}
          >
            <TileLayer url={baseLayer.url} attribution={baseLayer.attribution} maxZoom={baseLayer.maxZoom} />
            <ClickCapture onPick={handlePick} />
            {nodeMarkers.map((c) => (
              <CircleMarker
                key={c.public_key}
                center={[c.lat!, c.lon!]}
                radius={6}
                pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.7, weight: 1 }}
                eventHandlers={{
                  click: () => {
                    setSelected([c.lat!, c.lon!]);
                    if (c.name) setLabel(c.name);
                  },
                }}
              />
            ))}
            <CircleMarker
              center={selected}
              radius={9}
              pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.6, weight: 3 }}
            />
          </MapContainer>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {selected[0].toFixed(6)}, {selected[1].toFixed(6)}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. Meetup point"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected[0], selected[1], label)}>Insert</Button>
        </div>
      </div>
    </div>
  );
}
```

Note: confirm the `Button` component's available `variant` values in `./ui/button`; if `outline` is not defined, use an available variant for Cancel. The behavior (Insert calls `onConfirm`) must not change.

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/locationPickerModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/components/LocationPickerModal.tsx frontend/src/test/locationPickerModal.test.tsx
git commit -m "feat(location): add map-based location picker modal"
```

---

## Task 8: ChatHeader pin button, source popover, GPS, and modal

**Files:**
- Modify: `frontend/src/components/ChatHeader.tsx`
- Test: `frontend/src/test/chatHeaderLocation.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/chatHeaderLocation.test.tsx`. It renders `ChatHeader` for a DM with valid radio coords and asserts the pin popover offers "My radio location" and that clicking it inserts via `onInsertLocation`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHeader } from '../components/ChatHeader';
import type { Conversation, RadioConfig } from '../types';

// The modal pulls in Leaflet; stub it so ChatHeader renders in jsdom.
vi.mock('../components/LocationPickerModal', () => ({
  LocationPickerModal: () => null,
}));

const config = {
  public_key: 'bb'.repeat(32),
  name: 'MyRadio',
  lat: 52.123456,
  lon: 4.123456,
  tx_power: 20,
  max_tx_power: 22,
  radio: { freq: 869.525, bw: 250, sf: 11, cr: 5 },
  path_hash_mode: 0,
  path_hash_mode_supported: false,
} as unknown as RadioConfig;

const conversation: Conversation = { type: 'contact', id: 'cc'.repeat(32), name: 'Bob' };

function baseProps(onInsertLocation: ReturnType<typeof vi.fn>) {
  return {
    conversation,
    contacts: [],
    channels: [],
    config,
    notificationsSupported: false,
    notificationsEnabled: false,
    notificationsPermission: 'default' as NotificationPermission,
    onTrace: vi.fn(),
    onPathDiscovery: vi.fn(),
    onToggleNotifications: vi.fn(),
    onToggleFavorite: vi.fn(),
    onDeleteChannel: vi.fn(),
    onDeleteContact: vi.fn(),
    onInsertLocation,
  };
}

describe('ChatHeader location insert', () => {
  it('inserts the radio location from the pin popover', () => {
    const onInsertLocation = vi.fn();
    render(<ChatHeader {...baseProps(onInsertLocation)} />);
    fireEvent.click(screen.getByRole('button', { name: /share location/i }));
    fireEvent.click(screen.getByRole('button', { name: /my radio location/i }));
    expect(onInsertLocation).toHaveBeenCalledWith(52.123456, 4.123456, 'MyRadio');
  });
});
```

Note: `ChatHeader` requires props beyond those listed if TypeScript flags them; supply any additional required props as `vi.fn()`/defaults to satisfy the interface without changing the asserted behavior.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/chatHeaderLocation.test.tsx`
Expected: FAIL (`onInsertLocation` unknown; no "Share location" button).

- [ ] **Step 3: Implement the pin button, popover, GPS, modal**

In `frontend/src/components/ChatHeader.tsx`:

Add `MapPin` to the lucide import list (line 2) and add these imports:

```ts
import { LocationPickerModal } from './LocationPickerModal';
import { isValidLocation } from '../utils/pathUtils';
```

Add `onInsertLocation` to `ChatHeaderProps`:

```ts
  onInsertLocation?: (lat: number, lon: number, label: string) => void;
```

Destructure it in the component params (near `onOpenChannelInfo,`):

```ts
  onInsertLocation,
```

Add state and a ref near the other `useState`/`useRef` declarations (around lines 69-74):

```ts
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const locationMenuRef = useRef<HTMLDivElement>(null);
```

Reset `locationMenuOpen`/`pickerOpen` when the conversation changes. Extend the existing reset effect (the one keyed on `conversation.id`, around lines 76-82) to also call:

```ts
    setLocationMenuOpen(false);
    setPickerOpen(false);
```

Add an outside-click effect (mirroring the notification dropdown one) after that reset effect:

```ts
  useEffect(() => {
    if (!locationMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (locationMenuRef.current && !locationMenuRef.current.contains(e.target as Node)) {
        setLocationMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [locationMenuOpen]);
```

Add the source resolution + handlers before the `return` (near the other handlers around line 152):

```ts
  const radioLocationAvailable = isValidLocation(config?.lat ?? null, config?.lon ?? null);
  const contactLocationAvailable =
    conversation.type === 'contact' && isValidLocation(activeContact?.lat ?? null, activeContact?.lon ?? null);
  const radioLabel = config?.name ?? '';
  const contactLabel = activeContact?.name ?? conversation.name;
  // Initial center for the picker: this contact, else radio, else a neutral world view.
  const pickerCenter: [number, number] = contactLocationAvailable
    ? [activeContact!.lat!, activeContact!.lon!]
    : radioLocationAvailable
      ? [config!.lat, config!.lon]
      : [20, 0];

  const insertRadioLocation = () => {
    if (!onInsertLocation || !config) return;
    onInsertLocation(config.lat, config.lon, radioLabel);
    setLocationMenuOpen(false);
  };

  const insertContactLocation = () => {
    if (!onInsertLocation || !activeContact || activeContact.lat == null || activeContact.lon == null) return;
    onInsertLocation(activeContact.lat, activeContact.lon, contactLabel);
    setLocationMenuOpen(false);
  };

  const insertGpsLocation = () => {
    if (!onInsertLocation || !('geolocation' in navigator)) {
      toast.error('Geolocation is not available');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGettingLocation(false);
        setLocationMenuOpen(false);
        onInsertLocation(position.coords.latitude, position.coords.longitude, radioLabel);
      },
      (err) => {
        setGettingLocation(false);
        toast.error('Failed to get location', { description: err.message });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
```

Add the pin button + popover into the action-row `<div className="flex items-center justify-end gap-0.5">` (before the favorite button, around line 470), rendered for both channels and contacts:

```tsx
        {(conversation.type === 'channel' || conversation.type === 'contact') && onInsertLocation && (
          <div className="relative" ref={locationMenuRef}>
            <button
              className="p-1 rounded hover:bg-accent text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setLocationMenuOpen((v) => !v)}
              title="Share location"
              aria-label="Share location"
              aria-expanded={locationMenuOpen}
            >
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
            {locationMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
                {radioLocationAvailable && (
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={insertRadioLocation}
                  >
                    My radio location
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  onClick={insertGpsLocation}
                  disabled={gettingLocation}
                >
                  {gettingLocation ? 'Locating…' : 'My current GPS'}
                </button>
                {contactLocationAvailable && (
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={insertContactLocation}
                  >
                    This node's location
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setLocationMenuOpen(false);
                    setPickerOpen(true);
                  }}
                >
                  Pick on map…
                </button>
              </div>
            )}
          </div>
        )}
```

Add the modal near the other modals at the end of the component (before the closing `</header>` region, alongside the existing modal renders):

```tsx
      {onInsertLocation && (
        <LocationPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onConfirm={(lat, lon, label) => {
            setPickerOpen(false);
            onInsertLocation(lat, lon, label);
          }}
          contacts={contacts}
          initialCenter={pickerCenter}
          initialLabel={contactLocationAvailable ? contactLabel : ''}
        />
      )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/chatHeaderLocation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add frontend/src/components/ChatHeader.tsx frontend/src/test/chatHeaderLocation.test.tsx
git commit -m "feat(chat): add location share button and source popover to header"
```

---

## Task 9: Insert handler in useConversationActions

**Files:**
- Modify: `frontend/src/hooks/useConversationActions.ts`

- [ ] **Step 1: Add the handler**

In `frontend/src/hooks/useConversationActions.ts`:

Add the import:

```ts
import { buildMarkerPayload } from '../utils/meshcoreOpenPayloads';
```

Add `handleInsertLocation` to `UseConversationActionsResult`:

```ts
  handleInsertLocation: (lat: number, lon: number, label: string) => void;
```

Define it near `handleSenderClick`:

```ts
  const handleInsertLocation = useCallback(
    (lat: number, lon: number, label: string) => {
      messageInputRef.current?.appendText(`${buildMarkerPayload(lat, lon, label)} `);
    },
    [messageInputRef]
  );
```

Add it to the returned object:

```ts
    handleInsertLocation,
```

- [ ] **Step 2: Verify build**

Run: `npm --prefix frontend run build`
Expected: PASS.

- [ ] **Step 3: Commit** (only if authorized)

```bash
git add frontend/src/hooks/useConversationActions.ts
git commit -m "feat(chat): add handleInsertLocation composer action"
```

---

## Task 10: Wire ConversationPane and App end-to-end

**Files:**
- Modify: `frontend/src/components/ConversationPane.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add props to ConversationPane**

In `frontend/src/components/ConversationPane.tsx`, add to the props interface (near `onChannelReferenceClick?`):

```ts
  onInsertLocation?: (lat: number, lon: number, label: string) => void;
  onCoordinateClick?: (lat: number, lon: number, label: string) => void;
```

Destructure both in the component params (near `onChannelReferenceClick,`):

```ts
  onInsertLocation,
  onCoordinateClick,
```

Pass `focusedLatLon`/`focusedLabel` to `MapView` (in the `activeConversation.type === 'map'` branch, around line 213):

```tsx
            <MapView
              contacts={contacts}
              focusedKey={activeConversation.mapFocusKey}
              focusedLatLon={activeConversation.mapFocusLatLon}
              focusedLabel={activeConversation.mapFocusLabel}
              config={config}
              blockedKeys={blockedKeys}
              blockedNames={blockedNames}
              onSelectContact={(contact) =>
                onSelectConversation({
                  type: 'contact',
                  id: contact.public_key,
                  name: getContactDisplayName(contact.name, contact.public_key, contact.last_advert),
                })
              }
            />
```

Pass `onInsertLocation` to `ChatHeader` (in the props list around line 289-313):

```tsx
        onInsertLocation={onInsertLocation}
```

Pass `onCoordinateClick` to `MessageList` (near `onChannelReferenceClick={onChannelReferenceClick}`, around line 344):

```tsx
          onCoordinateClick={onCoordinateClick}
```

- [ ] **Step 2: Wire App.tsx**

In `frontend/src/App.tsx`:

Add `handleInsertLocation` to the `useConversationActions` destructure (around line 466-473):

```ts
    handleSenderClick,
    handleInsertLocation,
    handleTrace,
```

Define `handleCoordinateClick` near `handleChannelReferenceClick` (around line 529). It uses `setActiveConversation`, already in scope (line 273):

```ts
  const handleCoordinateClick = useCallback(
    (lat: number, lon: number, label: string) => {
      setActiveConversation({
        type: 'map',
        id: 'map',
        name: 'Node Map',
        mapFocusLatLon: [lat, lon],
        ...(label && { mapFocusLabel: label }),
      });
    },
    [setActiveConversation]
  );
```

Add both to the ConversationPane props bag (near `onSenderClick`/`onChannelReferenceClick`, around line 620-621):

```ts
    onInsertLocation: handleInsertLocation,
    onCoordinateClick: handleCoordinateClick,
```

- [ ] **Step 3: Verify build, lint, and full test suite**

Run: `npm --prefix frontend run build`
Expected: PASS.

Run: `npm --prefix frontend run lint`
Expected: PASS (no new errors).

Run: `npm --prefix frontend run test:run`
Expected: PASS (all tests, including the new ones).

- [ ] **Step 4: Commit** (only if authorized)

```bash
git add frontend/src/components/ConversationPane.tsx frontend/src/App.tsx
git commit -m "feat(chat): wire copy-location-to-chat end-to-end"
```

---

## Task 11: Runtime verification (manual, required before claiming done)

Per repo CLAUDE.md, runtime behavior must be observed, not reasoned about. Build and run the app, then verify each of the following and record the observed result.

- [ ] **Step 1: Build the frontend**

Run: `npm --prefix frontend run build`
Expected: PASS.

- [ ] **Step 2: Start the app and open a DM and a channel**

Use the project's run procedure (see the `run` skill / project docs) to launch the app against a connected radio or a dev instance.

- [ ] **Step 3: Verify insert (both conversation types)**

For a DM and a channel:
- Click the pin ("Share location") in the header. Confirm the popover lists only the available sources (My radio location when the radio has a set location; My current GPS; This node's location for a DM whose contact has coords; Pick on map).
- Choose "My radio location". Confirm the composer receives `m:<lat>,<lon>|<radioName>|poi ` and the byte counter updates.
- Choose "My current GPS". Approve the browser prompt. Confirm coords insert; deny it once and confirm a toast error and no insert.
- In a DM with a located contact, choose "This node's location" and confirm the contact's coords + name insert.
- Choose "Pick on map", click a point (and click a node marker), type a label, Insert. Confirm the payload inserts with the chosen coords and label.

- [ ] **Step 4: Verify send + card render**

Send an inserted location. Confirm it renders as a location card (pin icon, label, coords) in the message list. Toggle rich payloads off (if exposed) and confirm it falls back to raw text.

- [ ] **Step 5: Verify click-to-map + deep link**

Click a location card. Confirm the app switches to the Node Map, centers on the point with the red highlight marker whose popup shows the label and coords, and the URL hash becomes `#map/at/<lat>,<lon>`. Reload the page and confirm the map reopens focused on the same point.

- [ ] **Step 6: Verify interop (if a meshcore-open peer or sample is available)**

Paste a meshcore-open marker string (e.g. `m:52.123456,4.123456|Test|poi`) as an incoming message or into a channel and confirm it renders as a clickable card.

- [ ] **Step 7: Record results**

Write down, for each check above, PASS/FAIL with what was observed. Mark anything not verifiable in the environment as NOT VERIFIED.

---

## Self-Review (completed during authoring)

- Spec coverage: format (Task 2), four sources + popover + GPS + picker (Tasks 7, 8), default labels = node/contact name for quick sources (Task 8), tile extraction (Task 1), card render under rich-payloads gate + reply-prefixed (Task 6), click→map with highlight (Tasks 5, 10), `map/at` deep-link (Tasks 3, 4). All covered.
- Type consistency: `onInsertLocation(lat, lon, label)`, `onCoordinateClick(lat, lon, label)`, `buildMarkerPayload(lat, lon, label)`, `parseMarker → ParsedMarker`, `focusedLatLon: [number, number]`, `mapFocusLatLon`/`mapFocusLabel` are used identically across tasks.
- Out of scope (unchanged): persistent shared flag pins and guessed locations.
- Verification-required flags noted where the plan assumes a shape to confirm at implementation time: `RichPayloadContext`/`PathHopWidthContext` value shapes and `Message` required fields (Task 6 test), `Button` variants (Tasks 7, 8), and any extra required `ChatHeader` props (Task 8 test). Confirm these against the real files; behavioral assertions stay fixed.
