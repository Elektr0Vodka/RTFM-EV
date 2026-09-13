# Visualize packets: live map with VCR replay

Date: 2026-09-13
Branch: claude/visualize-packets-live-map-4c6bd9 (worktree maplibre-phase-2-tasks)
Status: design, pending user review

## Summary

Replace the map's current packet animation with a DMC-Observers-style live
visualization built on deck.gl, and add a VCR-style replay so the operator can
play, pause, speed up, scrub, and click to any point in recent history, then
snap back to live. We are a single observer, not an observer network, so links
represent "what this station witnessed" plus the inferred upstream route, not
observer-to-observer topology.

Reference studied: `G:\Github\repositories\Dutch-MeshCore\DutchMeshCore-Observers`
(`web/js/pages/map.js`, `web/js/lib/mapview.js`, `web/js/lib/replay.js`). We port
the visual techniques (deck.gl ArcLayer curves, arc-riding pulse dots, node glow
strobe, SNR color, freshness opacity, replay smoothing) and adapt the semantics
to a solo observer.

## Goals

- Fix the wrong/misleading packet paths by retiring the ad-hoc path resolver in
  `MapView.tsx` and resolving every packet's route through the canonical
  `networkGraph/packetNetworkGraph.ts` model.
- Render arcs, traveling pulses, and node glow with deck.gl so the visuals look
  identical in flat 2D and tilted 3D (unify, replacing the 2D canvas overlay and
  the 3D-only arc overlay).
- Show truth vs inference: the final witnessed hop (node heard directly) is solid;
  inferred upstream hops are faint/dashed.
- Add VCR replay: play/pause, speed, scrub and click a timeline, a Live button to
  re-pin to newest, and a look-back selector.
- Add controls: Pulses toggle, Glow toggle, smoothing Buffer slider, Geiger-click
  sound (off by default).
- Extend the legend with packet-type swatches and the SNR gradient + solid/dashed
  (witnessed/inferred) key.

## Non-goals (deferred to a later phase)

- Server-side historical frame aggregation (DMC `/map/frames`) and a network
  activity panel (busiest links / key relays). Replay depth is bounded by what
  `GET /packets/recent` can return on demand.
- Observer-to-observer topology, coverage H3 heatmaps, wardrive trails, tactical
  layers. Those are multi-observer features that do not apply to a solo station.
- Clock-skew correction across machines (DMC `clockOffset`). Packets are timestamped
  by our own backend, so client and source share one clock; the replay buffer still
  applies as a pure display-delay.

## Solo-observer link semantics (the correctness fix)

For each received packet:

1. Parse it (`utils/visualizerUtils.ts` `parsePacket`), then call
   `buildCanonicalPathForPacket(state, context, parsed, packet, activityAtMs)` to get
   the ordered topological node-id path (origin -> relays -> self).
2. Call `projectCanonicalPath(state, canonicalPath, visibility)` to get the rendered
   nodes plus `dashedLinkDetails` (which links are inferred / have hidden intermediate
   hops). `ProjectedPacketNetworkLink.hasDirectObservation` marks the witnessed edge.
3. Resolve each node id to `[lon, lat]` separately, because `PacketNetworkNode` carries
   no coordinates. Coordinates come from the map's existing contact indexes
   (`prefixIndex` / `nameIndex` over `mappableContacts`). A hop whose node has no known
   GPS is bridged (the arc connects the nearest known-GPS neighbors on the path) rather
   than dropped to `[0,0]`.

This is the root cause of "paths look wrong": today `MapView.tsx` computes the path
itself with an ad-hoc resolver that disagrees with the canonical model. After this
change there is one path authority (`packetNetworkGraph`) and one coordinate resolver.

Arc styling:
- Witnessed final hop (`hasDirectObservation === true`): solid, full-width by SNR.
- Inferred upstream hops: faint and dashed (deck.gl `ArcLayer` does not dash natively,
  so inferred hops use lower opacity + thinner width; dashing, if added, uses a
  `getDashArray`-style custom or a `PathLayer` fallback, decided in implementation).

## Architecture

New directory `frontend/src/map/packets/` for framework-agnostic logic, new deck.gl
layers under `frontend/src/map/layers/`, one new control component, and edits to
`MapSurface.tsx`, `MapControls.tsx`, and the legend.

### Playback engine: virtual clock, render-as-of-time

A single source of truth for "what time is shown":

`map/packets/PlaybackController.ts` (pure, unit-tested)
- State: `mode: 'live' | 'replay'`, `currentMs: number`, `rate: number`
  (0.25 / 0.5 / 1 / 2 / 4 / 8), `playing: boolean`, `lookbackMs: number`.
- Live mode: `currentMs` tracks wall clock minus `bufferMs` (the smoothing delay);
  the view follows the newest packet.
- Replay mode: on each animation frame, `currentMs += elapsed * rate` while playing;
  `seek(ms)` jumps (scrub/click); reaching the live edge auto-returns to live if the
  user pressed Live, otherwise it pauses at the end.
- Emits the current time to subscribers; owns no rendering.

Rationale over a faithful DMC port: DMC schedules each packet's animation forward in
time with timers, which cannot seek backward. Deriving all on-screen state as a pure
function of `currentMs` makes scrub/click to any time free, and makes the engine
testable without a map or a GPU.

### Time-indexed buffer and derived state

`map/packets/packetTimeline.ts` (pure, unit-tested)
- Ingests `RawPacket[]` (from the shared `useRawPackets()` store, plus on-demand
  look-back fetched via `api.getRecentPackets({ before_ts, limit })`), keyed and
  time-sorted, deduped with the existing observation key.
- For each packet, precomputes its resolved path once (canonical path + projected
  links + resolved coordinates) and caches it.
- `stateAsOf(currentMs)` returns the render model for a given time:
  - active arcs (links heard within the freshness window ending at `currentMs`),
    each with opacity from `livenessOpacity(ageMs)` and color from SNR,
  - in-flight pulses (packets whose `[heardMs, heardMs + PULSE_MS]` straddles
    `currentMs`), each with arc-riding position and a `sin(pi*t)` swell/fade
    envelope,
  - active glows (nodes that received within `GLOW_MS` before `currentMs`).
- Buffer bounds: keeps the union of the in-memory store and any fetched look-back,
  pruned to `lookbackMs` behind the newest packet; capped to protect memory.

Porting note: the freshness/opacity/pulse-position math mirrors DMC `mapview.js`
(`livenessOpacity`, `pulseProgress`, `pulsePosition`, `activeGlows`). We reimplement
these small pure functions in TypeScript with unit tests; we do not copy code.

### deck.gl rendering

`map/engine/deckOverlay.ts`
- One deck.gl overlay (interleaved) added to the MapLibre map in `MapSurface.tsx`,
  reusing the lazy `loadDeck()` pattern already in `layers/tracesDeck.ts`. This single
  overlay replaces `particleOverlay.ts` (2D canvas) and `tracesDeck.ts` (3D-only arcs).
- A `requestAnimationFrame` loop calls `PlaybackController.tick()` then
  `overlay.setProps({ layers })` with layers built from `packetTimeline.stateAsOf()`.
  The loop self-cancels when there is nothing animating and no replay is playing
  (no idle CPU), matching DMC's RAF discipline.

Layers (each a small factory returning `{ build(state): Layer }`):
- `layers/packetArcsLayer.ts`: deck.gl `ArcLayer`. Source/target from resolved hop
  coordinates; color by SNR (amber -> blue -> green); width by witnessed vs inferred;
  opacity by freshness. `getHeight` bow like the existing `tracesDeck`.
- `layers/packetPulseLayer.ts`: two `ScatterplotLayer`s (halo + core) riding the arc
  bow, colored by packet type from `PARTICLE_COLOR_MAP`, `depthTest:false` so pulses
  are never occluded.
- `layers/nodeGlowLayer.ts`: `ScatterplotLayer` halo keyed to recent receive, intensity
  decaying over `GLOW_MS`, colored by packet type.

The existing `nodesLayer`, `linksLayer`, `advertLinksLayer`, `externalNodesLayer` remain
as they are (MapLibre native layers). Only the packet-animation overlay moves to deck.gl.

### Controls

`map/controls/PlaybackBar.tsx` (new)
- A bottom-docked bar shown when "Visualize packets" is on: play/pause, speed selector,
  a timeline track (drag to scrub, click to seek) spanning `[now - lookbackMs, now]`
  with a playhead and tick density by packet arrival, a Live button (lit when following),
  and a look-back selector (buffer / 15m / 1h / 6h, default 1h). Selecting a deeper
  look-back triggers one `api.getRecentPackets({ before_ts, limit })` fetch to backfill
  the timeline.
- Keyboard: space = play/pause, left/right = step, L = live. All strings via i18n.

`map/controls/MapControls.tsx` (edit): add toggles under the existing "Visualize packets"
FAB group for Pulses, Glow, and a Buffer slider (0-12s smoothing), and a Sound toggle.
Reuses the existing `extraFabs` mechanism.

`map/packets/clickAudio.ts` (new): a synthesized soft click per newly shown packet,
deduped per packet, with a volume control. Off by default; respects the Sound toggle.

### Legend

`map/controls/legend/MapLegend.tsx` (edit): add a packet-type color section (swatches
from `PARTICLE_COLOR_MAP`), an SNR gradient bar (amber -> blue -> green with low/high
labels), and a line-style key (solid = witnessed hop, faint/dashed = inferred hop).

## Data flow

```
WS raw_packet ---> rawPacketStore (useRawPackets)  -------\
                                                           +--> packetTimeline (ingest + resolve path + coords)
api.getRecentPackets({before_ts}) (look-back backfill) ---/            |
                                                                        v
PlaybackController (virtual clock: live/replay/rate/seek) --> stateAsOf(currentMs)
                                                                        |
                                                                        v
                                         deckOverlay RAF loop -> ArcLayer + Pulse + Glow
                                                                        |
PlaybackBar (play/pause/speed/scrub/live/lookback) <-> PlaybackController
MapControls (pulses/glow/buffer/sound)  -->  layer + audio visibility
```

Path resolution authority: `packetNetworkGraph.ts`. Coordinate resolution: contact
indexes in `MapView.tsx`. No second path resolver.

## Error handling and edge cases

- WebGL unavailable: `engine/webgl.ts` already gates a fallback; if deck.gl cannot mount,
  the map still renders nodes/links and the packet overlay is hidden with a notice.
- Packets with no resolvable GPS on any hop: no arc drawn (cannot place it); still counted
  for glow on `self` if the witnessed node has GPS. Never place a hop at `[0,0]`.
- Look-back fetch failure: keep the in-memory buffer, surface a non-blocking error, stay
  in whatever mode the user was in.
- Replay while live packets keep arriving: new packets append to the buffer; the Live
  button reflects whether the playhead is pinned to the newest.
- Tab hidden: pause the RAF loop (visibility change), like DMC, to save battery.
- Large bursts: buffer smoothing spreads display; pulse count is capped (as the old
  overlay capped particles) to bound draw cost.

## Testing

Pure modules get unit tests (Vitest), matching existing `frontend/src/test/` patterns:
- `PlaybackController`: live-follow, rate advance, seek, live re-pin, end-of-buffer pause.
- `packetTimeline`: ingest/dedupe, `stateAsOf` arc/pulse/glow selection at chosen times,
  look-back merge, pruning, path + coordinate resolution including the no-GPS bridge.
- Freshness/pulse/glow math functions: boundary values (age 0, fresh edge, dim edge).
- `packetArcsLayer`/`packetPulseLayer` row builders (like the existing `arcRows` test).

Component test: `PlaybackBar` play/pause/seek/live interactions (React Testing Library).
Regression: existing `mapView.test.tsx`, `tracesDeck.test.ts`, `packetNetworkGraph.test.ts`,
visualizer tests must still pass.

Runtime verification (required before any "works" claim, per CLAUDE.md): load the branch
on the local Docker instance (`rtfm-ev-local`, :8000), observe live packets animating as
arcs+pulses+glow in flat 2D and in 3D tilt, exercise play/pause/speed/scrub/click/Live, and
confirm witnessed vs inferred styling on a real multi-hop packet. Record at least two
independent checks with output.

## CI-equivalent checks before pushing (per docs/agents/ci-checks.md)

Frontend: `lint`, `format:check` (prettier), `test:run`, `build`. Backend unchanged in
phase 1 (no Python edits expected); if any backend change appears, run `ruff check` and
`ruff format --check`.

## Documentation updates (same change)

- `CHANGELOG-DMC-EV.md`: add an entry under the map/frontend area.
- `README.md` / `README_ADVANCED.md`: update the map feature description (live packet
  visualization, replay).
- `frontend/AGENTS.md` and any map AGENTS doc: document the new `map/packets/` engine,
  the deck.gl overlay, and that `packetNetworkGraph` is the single path authority.
- i18n: all new user-facing strings need keys in EN/NL/DE (enforced by eslint + the parity
  test). Covers PlaybackBar, the new toggles, and legend labels.
- `docs/sources-of-truth.md`: note packet-path resolution authority if relevant.

## Phasing

1. Engine: `PlaybackController` + `packetTimeline` + `deckOverlay`, wired to live mode only
   (no VCR UI yet), replacing the old overlays. Verify live arcs/pulses/glow in 2D and 3D.
2. Controls: `PlaybackBar` VCR (play/pause/speed/scrub/click/live/look-back) + Pulses/Glow/
   Buffer/Sound toggles.
3. Legend + i18n + docs + Geiger audio polish.

Each phase ends with tests green and a runtime check.

## Open questions

- Dashing for inferred hops: confirm whether faint+thin is enough, or invest in a
  `PathLayer`/custom dash for true dashed arcs. Default: faint+thin in phase 1.
- Look-back options and default (proposed: buffer / 15m / 1h / 6h, default 1h).
