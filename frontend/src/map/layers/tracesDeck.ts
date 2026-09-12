import type { Map as MlMap } from 'maplibre-gl';

export interface HopPoint {
  lon: number;
  lat: number;
}

export interface ArcRow {
  s: [number, number, number];
  t: [number, number, number];
  color: [number, number, number];
}

/** Build ArcLayer source/target rows from a hop path (pure, unit-tested). */
export function arcRows(points: HopPoint[], color: [number, number, number]): ArcRow[] {
  const rows: ArcRow[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    rows.push({
      s: [points[i].lon, points[i].lat, 0],
      t: [points[i + 1].lon, points[i + 1].lat, 0],
      color,
    });
  }
  return rows;
}

// Lazy-load deck.gl (large) only on the first 3D switch. Cache the promise so
// repeated toggles reuse the single fetched chunk; drop it on failure so a
// later toggle can retry.
let _deck: Promise<typeof import('deck.gl')> | null = null;
export function loadDeck(): Promise<typeof import('deck.gl')> {
  if (!_deck) {
    _deck = import('deck.gl');
    _deck.catch(() => {
      _deck = null;
    });
  }
  return _deck;
}

export interface DeckTracesController {
  setArcs(rows: ArcRow[]): void;
  clear(): void;
  destroy(): void;
}

/** deck.gl arc/trace overlay for 3D mode. Interleaved with the MapLibre scene
 *  via MapLibreOverlay so arcs sit inside the same WebGL context and tilt with
 *  the camera. deck.gl is fetched lazily on first use. */
export function createDeckTraces(map: MlMap): DeckTracesController {
  // deck.gl types are heavy and only reachable after the lazy import, so the
  // overlay/layer constructor are held loosely here.
  let overlay: { setProps: (p: Record<string, unknown>) => void } | null = null;
  let ArcLayerCtor: (new (props: Record<string, unknown>) => unknown) | null = null;
  let rows: ArcRow[] = [];
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const repaint = () => (map as unknown as { triggerRepaint?: () => void }).triggerRepaint?.();

  function apply(): void {
    if (!overlay || !ArcLayerCtor) return;
    const layer = new ArcLayerCtor({
      id: 'rt-traces',
      data: rows,
      getSourcePosition: (d: ArcRow) => d.s,
      getTargetPosition: (d: ArcRow) => d.t,
      getSourceColor: (d: ArcRow) => d.color,
      getTargetColor: (d: ArcRow) => d.color,
      getWidth: 2,
      getHeight: 0.4,
    });
    overlay.setProps({ layers: [layer] });
    repaint();
  }

  function ensure(): void {
    if (overlay || destroyed || loading) return;
    loading = loadDeck()
      .then((deck) => {
        if (destroyed) return;
        ArcLayerCtor = deck.ArcLayer as unknown as new (props: Record<string, unknown>) => unknown;
        overlay = new deck.MapLibreOverlay({ interleaved: true, layers: [] }) as unknown as {
          setProps: (p: Record<string, unknown>) => void;
        };
        (map as unknown as { addControl: (c: unknown) => void }).addControl(overlay);
        apply();
      })
      .catch(() => {
        loading = null;
      });
  }

  return {
    setArcs(next: ArcRow[]): void {
      rows = next;
      if (overlay) apply();
      else ensure();
    },
    clear(): void {
      rows = [];
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
