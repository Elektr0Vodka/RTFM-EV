import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import type { Contact, LatestTelemetry } from '../../types';
import { mvToPercent } from '../../utils/batteryDisplay';

// Opt-in map overlay: a battery icon (coloured by level) + a temperature/age
// badge per node, fed by GET /contacts/telemetry/latest. It sits ABOVE the node
// circle/label layers and never changes their styling. Readings older than
// STALE_SEC are rendered faded. Battery is primary (the icon); temperature is
// secondary (the text); everything else stays in the per-node telemetry panes.

export const STALE_SEC = 24 * 3600;
export const TELEMETRY_MIN_ZOOM = 10;

const SOURCE_ID = 'rt-telemetry';
const LAYER_ID = 'rt-telemetry-badges';

const BATTERY_LEVELS = [0, 1, 2, 3, 4] as const;

/** Map battery volts to a 0..4 level bucket (0 empty, 4 full) via the mV OCV curve. */
export function batteryLevelBucket(volts: number): number {
  const pct = mvToPercent(volts * 1000); // batteryDisplay expects millivolts
  if (pct < 10) return 0;
  if (pct < 30) return 1;
  if (pct < 55) return 2;
  if (pct < 80) return 3;
  return 4;
}

/** Compact relative age, e.g. 'now', '5m', '3h', '2d'. */
export function ageStr(sec: number): string {
  if (sec < 90) return 'now';
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export function buildTelemetryFeatures(
  contacts: Contact[],
  latest: Record<string, LatestTelemetry>,
  nowSec: number
) {
  const features = [];
  for (const c of contacts) {
    if (c.lat == null || c.lon == null) continue;
    const t = latest[c.public_key];
    if (!t) continue;
    const hasBattery = t.battery_volts != null;
    const hasTemp = t.temperature != null;
    if (!hasBattery && !hasTemp) continue;

    const battLevel = hasBattery ? batteryLevelBucket(t.battery_volts as number) : -1;
    const ageSec = Math.max(0, Math.round(nowSec - t.timestamp));
    const tempLabel = hasTemp ? `${Math.round(t.temperature as number)}°` : '';
    const label = [tempLabel, ageStr(ageSec)].filter(Boolean).join(' · ');

    features.push({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lon as number, c.lat as number] },
      properties: {
        id: c.public_key,
        battLevel,
        label,
        stale: ageSec > STALE_SEC,
      },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

function iconImageExpr(): ExpressionSpecification {
  return [
    'case',
    ['>=', ['get', 'battLevel'], 0],
    ['concat', 'batt-', ['to-string', ['get', 'battLevel']]],
    'batt-none',
  ] as unknown as ExpressionSpecification;
}

function staleOpacityExpr(): ExpressionSpecification {
  return ['case', ['get', 'stale'], 0.45, 1] as unknown as ExpressionSpecification;
}

/** Draw a small battery glyph (level 0..4) or a neutral dot (level -1). */
function makeIcon(level: number): ImageData | null {
  const w = 26;
  const h = 12;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);

  if (level < 0) {
    // Temperature-only node: a faint anchor dot so the text has a marker.
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.beginPath();
    ctx.arc(6, h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    return ctx.getImageData(0, 0, w, h);
  }

  const color = level <= 0 ? '#ef4444' : level <= 2 ? '#f59e0b' : '#22c55e';
  const bodyW = 20;
  const bodyH = 10;
  const x = 1;
  const y = 1;
  // Outline
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, bodyW, bodyH);
  // Terminal nub
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x + bodyW + 1, y + 3, 2, 4);
  // Proportional fill
  const fillW = Math.max(0, Math.round((bodyW - 2) * (level / 4)));
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, fillW, bodyH - 2);
  return ctx.getImageData(0, 0, w, h);
}

function registerIcons(m: {
  hasImage: (id: string) => boolean;
  addImage: (id: string, img: ImageData) => void;
}) {
  const add = (id: string, level: number) => {
    if (m.hasImage(id)) return;
    const img = makeIcon(level);
    if (img) m.addImage(id, img);
  };
  BATTERY_LEVELS.forEach((lvl) => add(`batt-${lvl}`, lvl));
  add('batt-none', -1);
}

export interface TelemetryLayerOptions {
  minzoom?: number;
}

export function createTelemetryLayer(map: MlMap, opts: TelemetryLayerOptions = {}) {
  const minzoom = opts.minzoom ?? TELEMETRY_MIN_ZOOM;
  let lastData: ReturnType<typeof buildTelemetryFeatures> = {
    type: 'FeatureCollection',
    features: [],
  };
  let visible = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;

  function addSourceAndLayer() {
    registerIcons(m);
    if (!m.getSource(SOURCE_ID)) {
      m.addSource(SOURCE_ID, { type: 'geojson', data: lastData });
    }
    if (!m.getLayer(LAYER_ID)) {
      m.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        minzoom,
        layout: {
          visibility: visible ? 'visible' : 'none',
          'icon-image': iconImageExpr(),
          'icon-size': 1,
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-offset': [1.1, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false,
          'text-optional': true,
          'text-font': ['Noto Sans Regular', 'Open Sans Regular', 'sans-serif'],
        },
        paint: {
          'icon-opacity': staleOpacityExpr(),
          'text-color': '#f8fafc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.2,
          'text-opacity': staleOpacityExpr(),
        },
      });
    }
  }

  function setData(contacts: Contact[], latest: Record<string, LatestTelemetry>, nowSec: number) {
    lastData = buildTelemetryFeatures(contacts, latest, nowSec);
    const src = m.getSource(SOURCE_ID);
    if (src) src.setData(lastData);
  }

  function setVisible(on: boolean) {
    visible = on;
    if (m.getLayer(LAYER_ID)) {
      m.setLayoutProperty(LAYER_ID, 'visibility', on ? 'visible' : 'none');
    }
  }

  function ensure() {
    addSourceAndLayer();
  }
  function reattach() {
    // A basemap setStyle drops custom sources/layers/images; re-add them.
    addSourceAndLayer();
  }

  return { ensure, reattach, setData, setVisible };
}
