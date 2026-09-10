# Copy location to chat

Design spec. Status: approved for planning.

## Goal

Add a "copy location to chat" feature to RTFM-EV, available identically for both
channels and DMs. A pin button in the conversation header lets the user insert a
shared-location payload into the message composer from one of four sources. Any
shared-location payload appearing in a chat message renders as a clickable
location card that opens the built-in map centered on that point.

The feature is purely frontend. No backend, database, or mesh protocol change is
required: the payload is ordinary plaintext.

## Established wire format (verified)

RTFM-EV already ports two MeshCore Open structured payloads for display
(`g:<gifId>` GIF, `r:<hash>:<index>` reaction) in
`frontend/src/utils/meshcoreOpenPayloads.ts`. Location sharing uses a third
payload in the same family. The format was read directly from meshcore-open
(github.com/zjs81/meshcore-open, `main` branch):

- Emit, from `lib/screens/map_screen.dart` `_formatMarkerMessage`:
  `m:<lat>,<lon>|<label>|<flags>` with `lat`/`lon` at 6 decimal places
  (`toStringAsFixed(6)`) and `flags` = `poi` for a shared point of interest.
  Example: `m:52.123456,4.123456|Home|poi`.
- Parse, from `lib/screens/map_screen.dart` `parseMarkerText`:
  regex `m:([\-0-9.]+),([\-0-9.]+)\|([^|]*)\|(.*)`. Both pipes are required.
  Group 3 is the label (may be empty, cannot contain `|`). Group 4 is the flags.
- `documentation/map-and-location.md` confirms the chat behavior: "Tapping a
  shared location pin in a chat opens the map centered on that pin."

Byte cost is well within the composer's 156-byte LoRa ceiling: an empty-label
payload `m:52.123456,4.123456||poi` is about 26 bytes; a short label adds its own
bytes. The existing composer byte counter reflects the inserted text.

Matching this format byte-for-byte gives interoperability: a location shared from
RTFM-EV renders as a flag pin in meshcore-open, and incoming meshcore-open
markers render as location cards in RTFM-EV.

## Decisions

1. Sources (all four): the radio's own configured coordinates, live browser GPS,
   the active contact's coordinates (DM only), and a point picked on a map.
2. Format: `m:<lat>,<lon>|<label>|poi`, coordinates at 6 decimals.
3. Entry point: a pin icon in the `ChatHeader` action row, shown for both
   channels and DMs, opening a popover of available sources.
4. Default label:
   - My radio location and my GPS: the radio name (`config.name`).
   - This node's location: the contact's display name.
   - Pick on map: an optional label field in the modal, defaulting to empty (or
     the snapped node's name when the pin is snapped to a known node marker).
   - Labels are sanitized: `|` removed, trimmed.
5. Rendering: incoming `m:` payloads render as a clickable location card via the
   existing `renderMeshcoreOpenPayload` path, under the same `renderRichPayloads`
   toggle that gates GIFs and reactions. The reply-prefixed form (`@[Name] m:...`)
   is handled like the GIF/reaction reply form.
6. Click behavior: the card opens the map view centered on the coordinates with a
   temporary highlight marker whose popup shows the label. A URL-hash deep-link
   (`map/at/<lat>,<lon>`) is included, mirroring the existing `map/focus/<key>`.
7. Out of scope: persistent shared-pin management (flag markers with hide/remove,
   guessed/inferred locations, dedupe across messages) as meshcore-open
   implements. Noted as backlog.

## Architecture

Two independent halves that share the marker payload format.

### A. Insert side

1. Payload helper (new), in `frontend/src/utils/meshcoreOpenPayloads.ts` or a
   dedicated `locationMarker.ts`:
   - `buildMarkerPayload(lat: number, lon: number, label: string): string` returns
     `m:${lat.toFixed(6)},${lon.toFixed(6)}|${sanitize(label)}|poi`.
   - `sanitize(label)` removes `|` and trims.
   - Unit-testable in isolation.

2. Shared tile presets (refactor): extract the `TILE_LAYERS` preset array and its
   related constants (`MAP_MIN_ZOOM`, `MAP_MAX_ZOOM`, and the
   `TileLayerPreset` type) from `frontend/src/components/MapView.tsx` into a new
   `frontend/src/utils/mapTiles.ts`. `MapView` imports from there; the new picker
   imports the same, so both offer identical keyless layers. This is a targeted
   move, no behavior change to `MapView`.

3. `LocationPickerModal` (new component),
   `frontend/src/components/LocationPickerModal.tsx`:
   - Props: `open`, `onClose`, `onConfirm(lat, lon, label)`, `contacts`,
     `config`, and an initial center hint.
   - Uses `react-leaflet` (`MapContainer`, `TileLayer`, `useMapEvents`) with the
     shared tile presets.
   - Opens centered on the best available location: this node's coords if a DM
     with valid contact coords, else the radio's coords, else fit to known
     contacts, else world view.
   - Click drops or moves a draggable marker; a live `toFixed(6)` readout updates.
   - Known contacts with valid coords render as context markers; clicking one
     snaps the pin to it and prefills the label with its name.
   - An optional label text input.
   - Confirm calls `onConfirm`; Cancel discards.

4. `ChatHeader` changes, `frontend/src/components/ChatHeader.tsx`:
   - Add a `MapPin` (lucide) icon button to the action row for both `channel` and
     `contact` conversations.
   - Clicking toggles a popover built with the same outside-click pattern already
     used by the notification dropdown (`notifDropdownRef`).
   - Popover lists only available sources:
     - "My radio location" when `isValidLocation(config.lat, config.lon)`.
     - "My current GPS" always (resolves on click; shows a brief locating state;
       toasts on denial/timeout like `SettingsRadioSection`).
     - "This node's location" for `contact` conversations when the active contact
       has valid coords.
     - "Pick on map..." always; opens `LocationPickerModal`.
   - Unavailable sources are omitted, not shown disabled.
   - New props (optional callbacks) supplied from `ConversationPane`:
     - `onInsertLocation(lat, lon, label)` used by the three quick sources and the
       modal's confirm.
   - The modal open state and the GPS-resolving state live in `ChatHeader`
     alongside its other modal state.

5. Wiring the insert into the composer:
   - Add `handleInsertLocation(lat, lon, label)` to
     `frontend/src/hooks/useConversationActions.ts`, sibling to
     `handleSenderClick`. It builds the payload with `buildMarkerPayload` and
     calls `messageInputRef.current?.appendText(payload + ' ')`, matching the
     trailing-space convention of `handleSenderClick`.
   - `handleInsertLocation` is returned from the hook and passed by `App.tsx`
     through `ConversationPane` to `ChatHeader` as `onInsertLocation`.
   - Quick sources call it with the default label; the modal calls it with the
     chosen label. GPS resolution (via `navigator.geolocation.getCurrentPosition`)
     happens in `ChatHeader` before calling `onInsertLocation`.

### B. Render and click side

1. Parser (new), in `frontend/src/utils/meshcoreOpenPayloads.ts`:
   - `parseMarkerPayload(text: string): { lat: number; lon: number; label: string;
     flags: string } | null` using the meshcore-open regex, then range-validating
     with `isValidLocation` from `frontend/src/utils/pathUtils.ts`. Returns null
     when the format does not match or coords are invalid.
   - Strict whole-body match (like `parseGif`/`parseReaction`).

2. Location card renderer, in `frontend/src/components/MessageList.tsx`:
   - Add a `MarkerPayload` render function returning a clickable card: a flag/pin
     icon, the label (when non-empty), and the `lat, lon` readout at 6 decimals.
   - Hook it into `renderPayloadBody` (whole-body) so it participates in
     `renderMeshcoreOpenPayload`, including the reply-prefixed branch. This keeps
     it under the `renderRichPayloads` gate, consistent with GIF/reaction.
   - The card's click calls a new `onCoordinateClick(lat, lon, label)` prop.

3. Prop threading (mirrors `onChannelReferenceClick` exactly):
   - `MessageList` gains `onCoordinateClick?: (lat, lon, label) => void`, passed
     into `renderMeshcoreOpenPayload`.
   - `ConversationPane` gains the same prop and passes it to `MessageList`.
   - `App.tsx` defines `handleCoordinateClick(lat, lon, label)` and provides it in
     the same props bag where `onChannelReferenceClick: handleChannelReferenceClick`
     is set.

4. Navigation and map focus:
   - `handleCoordinateClick` calls `setActiveConversation({ type: 'map', id: 'map',
     name: 'Node Map', mapFocusLatLon: [lat, lon], mapFocusLabel: label })`.
   - Extend the `Conversation` `map` variant in `frontend/src/types.ts` with
     optional `mapFocusLatLon?: [number, number]` and `mapFocusLabel?: string`
     (alongside the existing `mapFocusKey`).
   - `ConversationPane` passes `focusedLatLon` and `focusedLabel` to `MapView`.
   - `MapView` gains `focusedLatLon?: [number, number]` and `focusedLabel?: string`.
     When set, `MapBoundsHandler` centers on those coords (add them to its
     centering logic and deps), and a temporary highlight marker (a `CircleMarker`
     or a distinct pin) renders at that point with a popup showing the label and
     coords.

5. URL-hash deep-link, in `frontend/src/utils/urlHash.ts`:
   - Parse `map/at/<lat>,<lon>` into `{ type: 'map', name: 'map', mapFocusLatLon }`,
     mirroring the existing `map/focus/<key>` branch.
   - Build the hash for a map conversation carrying `mapFocusLatLon`.
   - Update `frontend/src/hooks/useConversationRouter.ts`
     (`resolveConversationFromHash` and phase-1 map handling) and
     `frontend/src/utils/lastViewedConversation.ts` to carry `mapFocusLatLon`
     through, matching how `mapFocusKey` is currently carried.

## Data flow

Insert: user clicks pin -> popover -> source selected (or map modal confirm) ->
`ChatHeader` resolves coords and default label -> `onInsertLocation` ->
`useConversationActions.handleInsertLocation` -> `buildMarkerPayload` ->
`messageInputRef.appendText` -> composer holds `m:...|...|poi ` -> user sends via
existing send path (raw text, no transform).

Click: message text `m:...|...|poi` -> `renderMeshcoreOpenPayload` ->
`parseMarkerPayload` -> location card -> `onCoordinateClick(lat, lon, label)` ->
`App.handleCoordinateClick` -> `setActiveConversation(map, mapFocusLatLon)` ->
`ConversationPane` -> `MapView` centers and drops highlight marker. URL hash
updates to `map/at/<lat>,<lon>`.

## Edge cases and error handling

- Radio location unset (`0,0` or null): "My radio location" omitted
  (`isValidLocation` already rejects both).
- GPS denied or times out: toast error, nothing inserted (mirror
  `SettingsRadioSection`).
- Contact without coords in a DM: "This node's location" omitted.
- Label containing `|`: stripped before building the payload so the parser stays
  unambiguous.
- Malformed or out-of-range incoming `m:` text: `parseMarkerPayload` returns null,
  so the message renders as ordinary text (no card, no crash).
- `renderRichPayloads` off: `m:` shows as raw text, same as GIF/reaction today.
- Refresh while focused on a shared coord: restored from the `map/at/...` hash.

## Testing

Unit:
- `buildMarkerPayload`: formatting, 6-decimal precision, label sanitization
  (pipe removal, trim, empty label).
- `parseMarkerPayload`: valid payloads, empty label, out-of-range coords rejected,
  non-matching text rejected, reply-prefixed handled by the existing splitter.
- `urlHash`: round-trip of `map/at/<lat>,<lon>` parse and build.

Runtime verification (must be observed, not reasoned about):
- In a DM and in a channel: open the pin popover, exercise each available source,
  confirm the composer receives the correct `m:...|...|poi` text and the byte
  counter reacts.
- Send a location; confirm it renders as a location card in the list.
- Click a location card; confirm the map opens centered on the point with the
  highlight marker and the URL hash becomes `map/at/<lat>,<lon>`.
- Paste a meshcore-open `m:` string and confirm it renders and is clickable.

## File-by-file change list

New:
- `frontend/src/utils/mapTiles.ts` (extracted tile presets).
- `frontend/src/components/LocationPickerModal.tsx`.
- Tests for the payload helpers and urlHash.

Modified:
- `frontend/src/utils/meshcoreOpenPayloads.ts` (build + parse marker payload;
  hook parse into `renderPayloadBody` usage).
- `frontend/src/components/MapView.tsx` (import shared tiles; add `focusedLatLon`
  / `focusedLabel` and highlight marker).
- `frontend/src/components/ChatHeader.tsx` (pin button, popover, GPS + modal).
- `frontend/src/components/MessageList.tsx` (location card renderer;
  `onCoordinateClick` prop and threading through `renderMeshcoreOpenPayload`).
- `frontend/src/components/ConversationPane.tsx` (`onInsertLocation`,
  `onCoordinateClick`, `focusedLatLon`/`focusedLabel` wiring).
- `frontend/src/hooks/useConversationActions.ts` (`handleInsertLocation`).
- `frontend/src/App.tsx` (`handleCoordinateClick`; wire `onInsertLocation` and
  `onCoordinateClick`).
- `frontend/src/types.ts` (`mapFocusLatLon`, `mapFocusLabel` on the map variant).
- `frontend/src/utils/urlHash.ts` (`map/at/<lat>,<lon>` parse + build).
- `frontend/src/hooks/useConversationRouter.ts` and
  `frontend/src/utils/lastViewedConversation.ts` (carry `mapFocusLatLon`).

## Backlog (not in this change)

- Persistent shared map pins (flag markers with hide/remove), matching
  meshcore-open's shared-marker subsystem. Fits the parity-audit backlog.
- Guessed/inferred contact locations from repeater paths (separate meshcore-open
  feature).
