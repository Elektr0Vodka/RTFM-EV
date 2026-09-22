import type { Map as MlMap } from 'maplibre-gl';
import { loadDeck } from './tracesDeck';
import type { ArcDatum, GlowDatum, PacketRenderModel, PulseDatum } from '../packets/packetTimeline';

// Single deck.gl overlay that renders the live packet visualization (arcs +
// pulses + glow) in both flat 2D and tilted 3D. Interleaved with the MapLibre
// scene via deck.gl's MapLibreOverlay (the @deck.gl/maplibre adapter; the older
// @deck.gl/mapbox MapboxOverlay reads map.transform, which MapLibre 6 removed,
// and its exception kills MapLibre's render loop). deck.gl is fetched lazily on
// first use (reusing tracesDeck's loader).

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

export interface PacketDeckOverlay {
  setModel(m: PacketRenderModel): void;
  setArcWidthScale(scale: number): void;
  clear(): void;
  destroy(): void;
}

export function createPacketDeckOverlay(map: MlMap): PacketDeckOverlay {
  let overlay: { setProps: (p: Record<string, unknown>) => void } | null = null;
  let deckMod: typeof import('deck.gl') | null = null;
  let model: PacketRenderModel = { arcs: [], pulses: [], glows: [] };
  let arcWidthScale = 1;
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const repaint = () => (map as unknown as { triggerRepaint?: () => void }).triggerRepaint?.();

  const apply = (): void => {
    if (!overlay || !deckMod) return;
    overlay.setProps({ layers: buildPacketLayers(deckMod, model, arcWidthScale) });
    repaint();
  };

  // A GPU reset (seen in Chrome) loses every WebGL context on the page. MapLibre
  // restores its own; deck.gl's canvas stays lost. Rebuild the overlay once the
  // map's context is back so packets reappear on their own. luma.gl caches its
  // device (with compiled programs) on the context object, which survives the
  // loss, so drop that cache too or the rebuild reuses dead programs.
  const onContextRestored = (): void => {
    if (destroyed || !overlay) return;
    try {
      (map as unknown as { removeControl: (c: unknown) => void }).removeControl(overlay);
    } catch {
      /* the lost custom layer may already be gone */
    }
    try {
      const canvas = (map as unknown as { getCanvas?: () => HTMLCanvasElement }).getCanvas?.();
      const gl = canvas?.getContext('webgl2');
      if (gl) resetLumaOnContext(gl);
    } catch {
      /* best effort */
    }
    overlay = null;
    loading = null;
    ensure();
  };
  (map as unknown as { on?: (ev: string, cb: () => void) => void }).on?.(
    'webglcontextrestored',
    onContextRestored
  );

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
    setArcWidthScale(scale: number): void {
      arcWidthScale = scale;
      if (overlay) apply();
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
      (map as unknown as { off?: (ev: string, cb: () => void) => void }).off?.(
        'webglcontextrestored',
        onContextRestored
      );
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
