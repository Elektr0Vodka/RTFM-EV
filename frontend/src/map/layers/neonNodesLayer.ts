import type { Map as MlMap } from 'maplibre-gl';
import { loadDeck } from './tracesDeck';
import { acquireDeckSlot, type DeckSlot } from './sharedDeckOverlay';
import { CONTACT_TYPE_REPEATER, type Contact } from '../../types';
import { NODE_RECENCY_COLORS, NODE_TYPE_STROKE, recencyTier, type RecencyTier } from './nodesLayer';

// Neon node rendering: deck.gl layers that draw each node as a translucent
// halo circle under a bright core (the classic "neon" technique), in the map's
// shared interleaved deck.gl overlay (sharedDeckOverlay). It is the opt-in
// alternative to the flat GL circle layer (nodesLayer). The per-node activity
// pulse is supplied by the existing packet glow overlay, so this module only
// draws the static neon node body.
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
  /** Contact type, so the core ring can encode type like the flat layer's stroke. */
  type: number;
}

export function buildNeonNodeData(contacts: Contact[], nowSec: number): NeonNodeDatum[] {
  const out: NeonNodeDatum[] = [];
  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;
    out.push({
      pos: [c.lon, c.lat],
      tier: recencyTier(c.last_seen, nowSec),
      repeater: c.type === CONTACT_TYPE_REPEATER,
      type: c.type,
    });
  }
  return out;
}

/** Per-node draw height (roof under 3D buildings); `version` changes whenever
 *  any height does, so deck.gl re-reads the positions. */
export interface NodeHeights {
  at: (lon: number, lat: number) => number;
  version: number;
}

const GROUND_HEIGHTS: NodeHeights = { at: () => 0, version: 0 };

/** Build the halo + core deck.gl layers. Pure apart from the injected deck
 *  module, so it is unit-testable with a fake deck. */
export function buildNeonNodeLayers(
  deck: typeof import('deck.gl'),
  data: NeonNodeDatum[],
  nodeScale = 1,
  roleColors: Record<number, string> = NODE_TYPE_STROKE,
  heights: NodeHeights = GROUND_HEIGHTS
): unknown[] {
  const ScatterplotLayer = deck.ScatterplotLayer as unknown as new (
    p: Record<string, unknown>
  ) => unknown;

  const position = (d: NeonNodeDatum): [number, number, number] => [
    d.pos[0],
    d.pos[1],
    heights.at(d.pos[0], d.pos[1]),
  ];
  const coreR = (d: NeonNodeDatum) => (d.repeater ? REPEATER_CORE_R : CORE_R) * nodeScale;
  // Core ring encodes node TYPE via the per-role colour (same source as the flat
  // layer's stroke and the legend), so neon honours the node-colour picker.
  const ringColor = (d: NeonNodeDatum): [number, number, number, number] => {
    const hex = roleColors[d.type] ?? NODE_TYPE_STROKE[d.type];
    const [r, g, b] = hex ? hexToRgb(hex) : [8, 14, 22];
    return [r, g, b, 220];
  };

  const halo = new ScatterplotLayer({
    id: 'neon-nodes-halo',
    data,
    getPosition: position,
    getRadius: (d: NeonNodeDatum) => coreR(d) * HALO_SCALE,
    radiusUnits: 'pixels',
    getFillColor: (d: NeonNodeDatum) => {
      const [r, g, b] = TIER_RGB[d.tier];
      return [r, g, b, 60];
    },
    stroked: false,
    billboard: true,
    updateTriggers: { getRadius: nodeScale, getPosition: heights.version },
    // Always on top: 3D buildings never hide a node (deck.gl 9 parameter names;
    // the legacy depthTest/depthMask are ignored). No depth writes, so
    // overlapping halos read as additive glow, not occlusion.
    parameters: { depthCompare: 'always', depthWriteEnabled: false },
  });

  const core = new ScatterplotLayer({
    id: 'neon-nodes-core',
    data,
    getPosition: position,
    getRadius: coreR,
    radiusUnits: 'pixels',
    radiusMinPixels: 2,
    getFillColor: (d: NeonNodeDatum) => {
      const [r, g, b] = TIER_RGB[d.tier];
      return [r, g, b, 235];
    },
    // Ring encodes node type (role colour), matching the flat layer + legend.
    stroked: true,
    getLineColor: ringColor,
    lineWidthMinPixels: 1.5,
    billboard: true,
    updateTriggers: {
      getRadius: nodeScale,
      getLineColor: roleColors,
      getPosition: heights.version,
    },
    parameters: { depthCompare: 'always', depthWriteEnabled: false },
  });

  return [halo, core];
}

export interface NeonNodesOverlay {
  setData(contacts: Contact[], nowSec: number): void;
  setNodeScale(scale: number): void;
  setRoleColors(colors: Record<number, string>): void;
  setVisible(visible: boolean): void;
  setHeights(heights: NodeHeights): void;
  destroy(): void;
}

export function createNeonNodesOverlay(map: MlMap): NeonNodesOverlay {
  let slot: DeckSlot | null = null;
  let data: NeonNodeDatum[] = [];
  let nodeScale = 1;
  let roleColors: Record<number, string> = NODE_TYPE_STROKE;
  let heights: NodeHeights = GROUND_HEIGHTS;
  let visible = false;
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const apply = (): void => slot?.refresh();

  const ensure = (): void => {
    if (slot || destroyed || loading) return;
    loading = loadDeck()
      .then((deck) => {
        if (destroyed) return;
        slot = acquireDeckSlot(map, 'neon', deck, () =>
          visible ? buildNeonNodeLayers(deck, data, nodeScale, roleColors, heights) : []
        );
      })
      .catch(() => {
        loading = null;
      });
  };

  return {
    setData(contacts: Contact[], nowSec: number): void {
      data = buildNeonNodeData(contacts, nowSec);
      if (slot) apply();
      else if (visible) ensure();
    },
    setNodeScale(scale: number): void {
      nodeScale = scale;
      if (slot) apply();
    },
    setRoleColors(colors: Record<number, string>): void {
      roleColors = colors;
      if (slot) apply();
    },
    setHeights(next: NodeHeights): void {
      heights = next;
      if (slot) apply();
    },
    setVisible(v: boolean): void {
      visible = v;
      if (v && !slot) ensure();
      else apply();
    },
    destroy(): void {
      destroyed = true;
      slot?.release();
      slot = null;
    },
  };
}
