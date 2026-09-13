import type { Map as MlMap } from 'maplibre-gl';
import { loadDeck } from './tracesDeck';
import { CONTACT_TYPE_REPEATER, type Contact } from '../../types';
import { NODE_RECENCY_COLORS, recencyTier, type RecencyTier } from './nodesLayer';

// Neon node rendering: a deck.gl overlay that draws each node as a translucent
// halo circle under a bright core (the classic "neon" technique), interleaved
// with the MapLibre scene. It is the opt-in alternative to the flat GL circle
// layer (nodesLayer). The per-node activity pulse is supplied by the existing
// packet glow overlay, so this module only draws the static neon node body.
// Technique adapted from the DutchMeshCore-Observers map (deck.gl ScatterplotLayer
// halo + core), with RTFM's recency-tier colours.

const CORE_R = 5;
const REPEATER_CORE_R = 7;
const HALO_SCALE = 2.6; // halo radius = core radius * HALO_SCALE

/** #rrggbb -> [r,g,b]. Falls back to mid-grey on a malformed value. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [148, 163, 184];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const TIER_RGB: Record<RecencyTier, [number, number, number]> = {
  recent: hexToRgb(NODE_RECENCY_COLORS.recent),
  today: hexToRgb(NODE_RECENCY_COLORS.today),
  stale: hexToRgb(NODE_RECENCY_COLORS.stale),
  old: hexToRgb(NODE_RECENCY_COLORS.old),
};

export interface NeonNodeDatum {
  pos: [number, number];
  tier: RecencyTier;
  repeater: boolean;
}

export function buildNeonNodeData(contacts: Contact[], nowSec: number): NeonNodeDatum[] {
  const out: NeonNodeDatum[] = [];
  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;
    out.push({
      pos: [c.lon, c.lat],
      tier: recencyTier(c.last_seen, nowSec),
      repeater: c.type === CONTACT_TYPE_REPEATER,
    });
  }
  return out;
}

/** Build the halo + core deck.gl layers. Pure apart from the injected deck
 *  module, so it is unit-testable with a fake deck. */
export function buildNeonNodeLayers(
  deck: typeof import('deck.gl'),
  data: NeonNodeDatum[],
  nodeScale = 1
): unknown[] {
  const ScatterplotLayer = deck.ScatterplotLayer as unknown as new (
    p: Record<string, unknown>
  ) => unknown;

  const coreR = (d: NeonNodeDatum) => (d.repeater ? REPEATER_CORE_R : CORE_R) * nodeScale;

  const halo = new ScatterplotLayer({
    id: 'neon-nodes-halo',
    data,
    getPosition: (d: NeonNodeDatum) => d.pos,
    getRadius: (d: NeonNodeDatum) => coreR(d) * HALO_SCALE,
    radiusUnits: 'pixels',
    getFillColor: (d: NeonNodeDatum) => {
      const [r, g, b] = TIER_RGB[d.tier];
      return [r, g, b, 60];
    },
    stroked: false,
    billboard: true,
    updateTriggers: { getRadius: nodeScale },
    // No depth writes so overlapping halos read as additive glow, not occlusion.
    parameters: { depthTest: false, depthMask: false },
  });

  const core = new ScatterplotLayer({
    id: 'neon-nodes-core',
    data,
    getPosition: (d: NeonNodeDatum) => d.pos,
    getRadius: coreR,
    radiusUnits: 'pixels',
    radiusMinPixels: 2,
    getFillColor: (d: NeonNodeDatum) => {
      const [r, g, b] = TIER_RGB[d.tier];
      return [r, g, b, 235];
    },
    // Dark rim makes the bright core pop against the halo (observer trick).
    stroked: true,
    getLineColor: [8, 14, 22, 220],
    lineWidthMinPixels: 1,
    billboard: true,
    updateTriggers: { getRadius: nodeScale },
    parameters: { depthTest: false, depthMask: false },
  });

  return [halo, core];
}

export interface NeonNodesOverlay {
  setData(contacts: Contact[], nowSec: number): void;
  setNodeScale(scale: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createNeonNodesOverlay(map: MlMap): NeonNodesOverlay {
  let overlay: { setProps: (p: Record<string, unknown>) => void } | null = null;
  let deckMod: typeof import('deck.gl') | null = null;
  let data: NeonNodeDatum[] = [];
  let nodeScale = 1;
  let visible = false;
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const repaint = () => (map as unknown as { triggerRepaint?: () => void }).triggerRepaint?.();

  const apply = (): void => {
    if (!overlay || !deckMod) return;
    overlay.setProps({ layers: visible ? buildNeonNodeLayers(deckMod, data, nodeScale) : [] });
    repaint();
  };

  const ensure = (): void => {
    if (overlay || destroyed || loading) return;
    loading = loadDeck()
      .then((deck) => {
        if (destroyed) return;
        deckMod = deck;
        overlay = new deck.MapLibreOverlay({ interleaved: true, layers: [] }) as unknown as {
          setProps: (p: Record<string, unknown>) => void;
        };
        (map as unknown as { addControl: (c: unknown) => void }).addControl(overlay);
        apply();
      })
      .catch(() => {
        loading = null;
      });
  };

  return {
    setData(contacts: Contact[], nowSec: number): void {
      data = buildNeonNodeData(contacts, nowSec);
      if (overlay) apply();
      else if (visible) ensure();
    },
    setNodeScale(scale: number): void {
      nodeScale = scale;
      if (overlay) apply();
    },
    setVisible(v: boolean): void {
      visible = v;
      if (v && !overlay) ensure();
      else apply();
    },
    destroy(): void {
      destroyed = true;
      if (overlay) {
        try {
          (map as unknown as { removeControl: (c: unknown) => void }).removeControl(overlay);
        } catch {
          /* control may already be gone with the map */
        }
        overlay = null;
      }
    },
  };
}
