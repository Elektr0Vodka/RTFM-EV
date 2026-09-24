import type { Map as MlMap } from 'maplibre-gl';

// One interleaved deck.gl overlay per MapLibre map, shared by every deck-drawn
// feature on that map. deck.gl's MapLibreOverlay supports a single interleaved
// overlay per map (a second one throws "supports one interleaved overlay per
// map"), so the live packet overlay and the neon nodes could not both attach:
// whichever came second silently never drew. Each feature owns a named slot with
// a layer builder, and the overlay renders the slots' layers combined, in
// SLOT_ORDER.

export type DeckSlotKey = 'neon' | 'packets';

// Draw order, bottom to top: neon node bodies under the packet arcs and pulses.
const SLOT_ORDER: DeckSlotKey[] = ['neon', 'packets'];

/** The MapLibre custom-layer id deck.gl uses for layers without a `beforeId`. */
export const DECK_LAYER_GROUP_ID = 'deck-maplibre-layer-group-last';

export interface DeckSlot {
  /** Re-run this slot's builder (its inputs changed) and redraw. */
  refresh(): void;
  release(): void;
}

interface SlotEntry {
  build: () => unknown[];
  /** Last built layers; null means build on the next apply. */
  layers: unknown[] | null;
}

type Overlay = { setProps: (p: Record<string, unknown>) => void };

type MapApi = {
  on?: (ev: string, cb: () => void) => void;
  off?: (ev: string, cb: () => void) => void;
  addControl: (c: unknown) => void;
  removeControl: (c: unknown) => void;
  getLayer?: (id: string) => unknown;
  isStyleLoaded?: () => boolean | void;
  triggerRepaint?: () => void;
  getCanvas?: () => HTMLCanvasElement;
};

interface SharedState {
  overlay: Overlay | null;
  deck: typeof import('deck.gl');
  slots: Map<DeckSlotKey, SlotEntry>;
  layers: unknown[];
  onRender: () => void;
  onContextRestored: () => void;
}

const _shared = new WeakMap<object, SharedState>();

/** Undo luma.gl's hooks on a WebGL context that MapLibre also draws with.
 *  Interleaved deck.gl makes luma.gl install caching wrappers for state setters,
 *  getters and useProgram as own properties of the context object, and park its
 *  device on `gl.luma` / `gl.lumaState`. After a context loss the GPU state is
 *  reset but that cache is not, so wrapped calls (MapLibre's too) are silently
 *  skipped and the map renders transparent; a second device would wrap the
 *  wrappers and make it worse. Removing the own-property wrappers restores the
 *  prototype methods; the rebuilt overlay then installs fresh hooks. */
export function resetLumaOnContext(gl: WebGL2RenderingContext): void {
  const g = gl as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(g)) {
    if (typeof g[key] === 'function') delete g[key];
  }
  delete g.luma;
  delete g.lumaState;
}

// deck.gl layer instances keep the GPU resources of the deck they were drawn by,
// so a new overlay (after a context restore) needs freshly built layers: re-sent
// instances issue draw calls against the lost device and nothing shows.
function attach(m: MapApi, s: SharedState): void {
  for (const slot of s.slots.values()) slot.layers = null;
  const overlay = new s.deck.MapLibreOverlay({
    interleaved: true,
    layers: [],
  }) as unknown as Overlay;
  s.overlay = overlay;
  m.addControl(overlay);
  apply(m, s);
}

function apply(m: MapApi, s: SharedState): void {
  if (!s.overlay) return;
  const layers: unknown[] = [];
  for (const key of SLOT_ORDER) {
    const slot = s.slots.get(key);
    if (!slot) continue;
    if (!slot.layers) slot.layers = slot.build();
    layers.push(...slot.layers);
  }
  s.layers = layers;
  s.overlay.setProps({ layers });
  m.triggerRepaint?.();
}

/** Join the map's shared deck overlay under `key`, creating the overlay on first
 *  use. `deck` is the lazily loaded deck.gl module (see loadDeck); `build`
 *  returns the slot's current layers and must create new layer instances. */
export function acquireDeckSlot(
  map: MlMap,
  key: DeckSlotKey,
  deck: typeof import('deck.gl'),
  build: () => unknown[]
): DeckSlot {
  const m = map as unknown as MapApi;
  let s = _shared.get(map);
  if (!s) {
    const state: SharedState = {
      overlay: null,
      deck,
      slots: new Map(),
      layers: [],
      // deck only adds its MapLibre layer group while isStyleLoaded() is true,
      // which is false until the style's tiles have loaded, and it does not
      // retry. Layers set during a basemap switch (the Nova upgrade right after
      // map load) therefore never drew. Re-add the group once the style is
      // ready; passing the same array makes deck diff nothing else.
      onRender: () => {
        if (!state.overlay || state.layers.length === 0) return;
        if (m.getLayer?.(DECK_LAYER_GROUP_ID)) return;
        if (!m.isStyleLoaded?.()) return;
        state.overlay.setProps({ layers: state.layers });
      },
      // A GPU reset (seen in Chrome) loses every WebGL context on the page.
      // MapLibre restores its own, but the overlay's custom layer cannot be
      // restored. Rebuild it once the map's context is back. luma.gl caches its
      // device (with compiled programs) on the context object, which survives
      // the loss, so drop that cache too or the rebuild reuses dead programs.
      onContextRestored: () => {
        if (!state.overlay) return;
        try {
          m.removeControl(state.overlay);
        } catch {
          /* the lost custom layer may already be gone */
        }
        try {
          const gl = m.getCanvas?.()?.getContext('webgl2');
          if (gl) resetLumaOnContext(gl);
        } catch {
          /* best effort */
        }
        attach(m, state);
      },
    };
    s = state;
    _shared.set(map, s);
    m.on?.('render', s.onRender);
    m.on?.('webglcontextrestored', s.onContextRestored);
    s.slots.set(key, { build, layers: null });
    attach(m, s);
  } else {
    s.slots.set(key, { build, layers: null });
    apply(m, s);
  }
  const state = s;

  return {
    refresh(): void {
      const slot = state.slots.get(key);
      if (_shared.get(map) !== state || !slot) return;
      slot.layers = null;
      apply(m, state);
    },
    release(): void {
      if (_shared.get(map) !== state || !state.slots.delete(key)) return;
      if (state.slots.size > 0) {
        apply(m, state);
        return;
      }
      m.off?.('render', state.onRender);
      m.off?.('webglcontextrestored', state.onContextRestored);
      _shared.delete(map);
      if (state.overlay) {
        try {
          m.removeControl(state.overlay);
        } catch {
          /* control may already be gone with the map */
        }
        state.overlay = null;
      }
    },
  };
}
