import type { Map as MlMap } from 'maplibre-gl';
import { loadDeck } from './tracesDeck';
import { acquireDeckSlot, type DeckSlot } from './sharedDeckOverlay';
import type { ArcDatum, GlowDatum, PacketRenderModel, PulseDatum } from '../packets/packetTimeline';

// deck.gl layers for the live packet visualization (arcs + pulses + glow) in
// both flat 2D and tilted 3D. They draw in the map's shared interleaved deck.gl
// overlay (sharedDeckOverlay, deck.gl's @deck.gl/maplibre MapLibreOverlay; the
// older @deck.gl/mapbox MapboxOverlay reads map.transform, which MapLibre 6
// removed, and its exception kills MapLibre's render loop). deck.gl is fetched
// lazily on first use (reusing tracesDeck's loader).

const rnd = (x: number): number => Math.round(x);
const rgba = (c: [number, number, number], a: number): [number, number, number, number] => [
  c[0],
  c[1],
  c[2],
  a,
];

/** Build the deck.gl layer list from a render model. Pure apart from the
 *  injected deck module, so it is unit-testable with a fake deck. */
export function buildPacketLayers(
  deck: typeof import('deck.gl'),
  m: PacketRenderModel,
  arcWidthScale = 1
): unknown[] {
  const ArcLayer = deck.ArcLayer as unknown as new (p: Record<string, unknown>) => unknown;
  const ScatterplotLayer = deck.ScatterplotLayer as unknown as new (
    p: Record<string, unknown>
  ) => unknown;

  const arcs = new ArcLayer({
    id: 'pkt-arcs',
    data: m.arcs,
    getSourcePosition: (d: ArcDatum) => d.s,
    getTargetPosition: (d: ArcDatum) => d.t,
    getSourceColor: (d: ArcDatum) => rgba(d.color, rnd(255 * d.opacity)),
    getTargetColor: (d: ArcDatum) => rgba(d.color, rnd(255 * d.opacity)),
    getWidth: (d: ArcDatum) => d.width * arcWidthScale,
    // deck.gl caches accessor results; bump the trigger when the scale changes.
    updateTriggers: { getWidth: arcWidthScale },
    getHeight: 0.3,
    widthUnits: 'pixels',
    // deck.gl 9 parameter names; the legacy depthTest/depthMask are ignored.
    parameters: { depthCompare: 'less-equal' },
  });

  const pulseHalo = new ScatterplotLayer({
    id: 'pkt-pulse-halo',
    data: m.pulses,
    getPosition: (d: PulseDatum) => d.pos,
    getRadius: (d: PulseDatum) => 6 + 10 * d.k,
    radiusUnits: 'pixels',
    getFillColor: (d: PulseDatum) => rgba(d.color, rnd(80 * (0.35 + 0.65 * d.k))),
    billboard: true,
    parameters: { depthCompare: 'always', depthWriteEnabled: false },
  });

  const pulseCore = new ScatterplotLayer({
    id: 'pkt-pulse-core',
    data: m.pulses,
    getPosition: (d: PulseDatum) => d.pos,
    getRadius: (d: PulseDatum) => 2.5 + 3 * d.k,
    radiusUnits: 'pixels',
    getFillColor: (d: PulseDatum) => rgba(d.color, 255),
    billboard: true,
    parameters: { depthCompare: 'always', depthWriteEnabled: false },
  });

  const glow = new ScatterplotLayer({
    id: 'pkt-glow',
    data: m.glows,
    getPosition: (d: GlowDatum) => d.pos,
    getRadius: (d: GlowDatum) => 4 + 8 * d.intensity,
    radiusUnits: 'pixels',
    getFillColor: (d: GlowDatum) => rgba(d.color, rnd(200 * d.intensity)),
    billboard: true,
    parameters: { depthCompare: 'always', depthWriteEnabled: false },
  });

  return [arcs, pulseHalo, pulseCore, glow];
}

export interface PacketDeckOverlay {
  setModel(m: PacketRenderModel): void;
  setArcWidthScale(scale: number): void;
  clear(): void;
  destroy(): void;
}

export function createPacketDeckOverlay(map: MlMap): PacketDeckOverlay {
  let slot: DeckSlot | null = null;
  let model: PacketRenderModel = { arcs: [], pulses: [], glows: [] };
  let arcWidthScale = 1;
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const apply = (): void => slot?.refresh();

  const ensure = (): void => {
    if (slot || destroyed || loading) return;
    loading = loadDeck()
      .then((deck) => {
        if (destroyed) return;
        slot = acquireDeckSlot(map, 'packets', deck, () =>
          buildPacketLayers(deck, model, arcWidthScale)
        );
      })
      .catch(() => {
        loading = null;
      });
  };

  return {
    setModel(m: PacketRenderModel): void {
      model = m;
      if (slot) apply();
      else ensure();
    },
    setArcWidthScale(scale: number): void {
      arcWidthScale = scale;
      if (slot) apply();
    },
    clear(): void {
      model = { arcs: [], pulses: [], glows: [] };
      slot?.refresh();
    },
    destroy(): void {
      destroyed = true;
      slot?.release();
      slot = null;
    },
  };
}
