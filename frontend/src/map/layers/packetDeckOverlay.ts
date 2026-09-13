import type { Map as MlMap } from 'maplibre-gl';
import { loadDeck } from './tracesDeck';
import type { ArcDatum, GlowDatum, PacketRenderModel, PulseDatum } from '../packets/packetTimeline';

// Single deck.gl overlay that renders the live packet visualization (arcs +
// pulses + glow) in both flat 2D and tilted 3D. Interleaved with the MapLibre
// scene via MapLibreOverlay, so it shares one WebGL context and tilts with the
// camera. deck.gl is fetched lazily on first use (reusing tracesDeck's loader).

const rnd = (x: number): number => Math.round(x);
const rgba = (c: [number, number, number], a: number): [number, number, number, number] => [
  c[0],
  c[1],
  c[2],
  a,
];

/** Build the deck.gl layer list from a render model. Pure apart from the
 *  injected deck module, so it is unit-testable with a fake deck. */
export function buildPacketLayers(deck: typeof import('deck.gl'), m: PacketRenderModel): unknown[] {
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
    getWidth: (d: ArcDatum) => d.width,
    getHeight: 0.3,
    widthUnits: 'pixels',
    parameters: { depthTest: true },
  });

  const pulseHalo = new ScatterplotLayer({
    id: 'pkt-pulse-halo',
    data: m.pulses,
    getPosition: (d: PulseDatum) => d.pos,
    getRadius: (d: PulseDatum) => 6 + 10 * d.k,
    radiusUnits: 'pixels',
    getFillColor: (d: PulseDatum) => rgba(d.color, rnd(80 * (0.35 + 0.65 * d.k))),
    billboard: true,
    parameters: { depthTest: false, depthMask: false },
  });

  const pulseCore = new ScatterplotLayer({
    id: 'pkt-pulse-core',
    data: m.pulses,
    getPosition: (d: PulseDatum) => d.pos,
    getRadius: (d: PulseDatum) => 2.5 + 3 * d.k,
    radiusUnits: 'pixels',
    getFillColor: (d: PulseDatum) => rgba(d.color, 255),
    billboard: true,
    parameters: { depthTest: false, depthMask: false },
  });

  const glow = new ScatterplotLayer({
    id: 'pkt-glow',
    data: m.glows,
    getPosition: (d: GlowDatum) => d.pos,
    getRadius: (d: GlowDatum) => 4 + 8 * d.intensity,
    radiusUnits: 'pixels',
    getFillColor: (d: GlowDatum) => rgba(d.color, rnd(200 * d.intensity)),
    billboard: true,
    parameters: { depthTest: false, depthMask: false },
  });

  return [arcs, pulseHalo, pulseCore, glow];
}

export interface PacketDeckOverlay {
  setModel(m: PacketRenderModel): void;
  clear(): void;
  destroy(): void;
}

export function createPacketDeckOverlay(map: MlMap): PacketDeckOverlay {
  let overlay: { setProps: (p: Record<string, unknown>) => void } | null = null;
  let deckMod: typeof import('deck.gl') | null = null;
  let model: PacketRenderModel = { arcs: [], pulses: [], glows: [] };
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const repaint = () => (map as unknown as { triggerRepaint?: () => void }).triggerRepaint?.();

  const apply = (): void => {
    if (!overlay || !deckMod) return;
    overlay.setProps({ layers: buildPacketLayers(deckMod, model) });
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
    setModel(m: PacketRenderModel): void {
      model = m;
      if (overlay) apply();
      else ensure();
    },
    clear(): void {
      model = { arcs: [], pulses: [], glows: [] };
      if (overlay) {
        overlay.setProps({ layers: [] });
        repaint();
      }
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
