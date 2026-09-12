import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import { isValidLocation } from '../utils/pathUtils';
import type { ResolvedPath, SenderInfo } from '../utils/pathUtils';
import { useIsDarkTheme } from '../hooks';
import { useT } from '../i18n';
import { MiniMap } from '../map/MiniMap';

interface PathRouteMapProps {
  resolved: ResolvedPath;
  senderInfo: SenderInfo;
  /** Fixed map height in px. Ignored when `fill` is set. */
  height?: number;
  /** When true, the map fills its parent's height instead of using `height`. */
  fill?: boolean;
}

// Colors for hop markers (indexed by hop number - 1)
const HOP_COLORS = [
  '#f97316', // Hop 1: orange
  '#eab308', // Hop 2: yellow
  '#22c55e', // Hop 3: green
  '#06b6d4', // Hop 4: cyan
  '#ec4899', // Hop 5: pink
  '#f43f5e', // Hop 6: rose
  '#a855f7', // Hop 7: purple
  '#64748b', // Hop 8: slate
];
const SENDER_COLOR = '#3b82f6'; // blue
const RECEIVER_COLOR = '#8b5cf6'; // violet

function getHopColor(hopIndex: number): string {
  return HOP_COLORS[hopIndex % HOP_COLORS.length];
}

function markerEl(label: string, color: string, title: string): HTMLElement {
  const el = document.createElement('div');
  el.title = title;
  el.textContent = label;
  el.style.cssText =
    'width:24px;height:24px;border-radius:50%;color:#fff;display:flex;align-items:center;' +
    'justify-content:center;font-size:11px;font-weight:700;border:2px solid rgba(255,255,255,0.8);' +
    `box-shadow:0 1px 4px rgba(0,0,0,0.4);background:${color};`;
  return el;
}

interface MarkerSpec {
  lngLat: [number, number];
  label: string;
  color: string;
  title: string;
}

/** All valid [lng, lat] points for bounds fitting. */
function collectPoints(resolved: ResolvedPath): [number, number][] {
  const pts: [number, number][] = [];
  if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
    pts.push([resolved.sender.lon!, resolved.sender.lat!]);
  }
  for (const hop of resolved.hops) {
    for (const m of hop.matches) {
      if (isValidLocation(m.lat, m.lon)) pts.push([m.lon!, m.lat!]);
    }
  }
  if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
    pts.push([resolved.receiver.lon!, resolved.receiver.lat!]);
  }
  return pts;
}

/** Ordered [lng, lat] route line: sender, first located contact per hop,
 *  receiver. Hops with no located contact are skipped so the line spans them. */
function collectRouteLine(resolved: ResolvedPath): [number, number][] {
  const line: [number, number][] = [];
  if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
    line.push([resolved.sender.lon!, resolved.sender.lat!]);
  }
  for (const hop of resolved.hops) {
    const m = hop.matches.find((x) => isValidLocation(x.lat, x.lon));
    if (m) line.push([m.lon!, m.lat!]);
  }
  if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
    line.push([resolved.receiver.lon!, resolved.receiver.lat!]);
  }
  return line;
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

export function PathRouteMap({ resolved, senderInfo, height = 220, fill = false }: PathRouteMapProps) {
  const t = useT();
  const dark = useIsDarkTheme();
  const lineColor = dark ? '#e2e8f0' : '#1e293b';
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);

  const points = useMemo(() => collectPoints(resolved), [resolved]);
  const routeLine = useMemo(() => collectRouteLine(resolved), [resolved]);
  const hasAnyGps = points.length > 0;

  const markerSpecs = useMemo<MarkerSpec[]>(() => {
    const specs: MarkerSpec[] = [];
    if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
      specs.push({
        lngLat: [resolved.sender.lon!, resolved.sender.lat!],
        label: 'S',
        color: SENDER_COLOR,
        title: `${resolved.sender.prefix} · ${senderInfo.name || t('path_modal_sender_label')}`,
      });
    }
    resolved.hops.forEach((hop, hopIdx) => {
      for (const m of hop.matches) {
        if (!isValidLocation(m.lat, m.lon)) continue;
        specs.push({
          lngLat: [m.lon!, m.lat!],
          label: String(hopIdx + 1),
          color: getHopColor(hopIdx),
          title: `${hop.prefix} · ${m.name || m.public_key.slice(0, 12)}`,
        });
      }
    });
    if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
      specs.push({
        lngLat: [resolved.receiver.lon!, resolved.receiver.lat!],
        label: 'R',
        color: RECEIVER_COLOR,
        title: `${resolved.receiver.prefix} · ${resolved.receiver.name || t('path_map_receiver_fallback')}`,
      });
    }
    return specs;
  }, [resolved, senderInfo, t]);

  const someMissingGps = useMemo(() => {
    if (!hasAnyGps) return false;
    let totalNodes = 2;
    let nodesWithGps = 0;
    if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) nodesWithGps++;
    if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) nodesWithGps++;
    for (const hop of resolved.hops) {
      if (hop.matches.length === 0) totalNodes++;
      else {
        totalNodes += hop.matches.length;
        nodesWithGps += hop.matches.filter((m) => isValidLocation(m.lat, m.lon)).length;
      }
    }
    return nodesWithGps < totalNodes;
  }, [resolved, hasAnyGps]);

  const drawRoute = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      if (!m.getSource('pr-line')) {
        m.addSource('pr-line', { type: 'geojson', data: EMPTY_FC });
        m.addLayer({
          id: 'pr-line',
          type: 'line',
          source: 'pr-line',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': lineColor, 'line-width': 3, 'line-opacity': 0.85 },
        });
      }
      m.setPaintProperty('pr-line', 'line-color', lineColor);
      m.getSource('pr-line')?.setData(
        routeLine.length >= 2
          ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine } }
          : EMPTY_FC,
      );
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = markerSpecs.map((s) =>
        new MlMarker({ element: markerEl(s.label, s.color, s.title) }).setLngLat(s.lngLat).addTo(map),
      );
    },
    [routeLine, lineColor, markerSpecs],
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      drawRoute(map);
    },
    [drawRoute],
  );

  useEffect(() => {
    if (mapRef.current) drawRoute(mapRef.current);
  }, [drawRoute]);
  useEffect(
    () => () => {
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
    },
    [],
  );

  if (!hasAnyGps) {
    return (
      <div className="flex h-14 items-center justify-center rounded border border-border bg-muted/30 text-sm text-muted-foreground">
        {t('path_map_no_gps')}
      </div>
    );
  }

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col' : undefined}>
      <div
        className={
          fill
            ? 'min-h-0 flex-1 overflow-hidden rounded border border-border'
            : 'overflow-hidden rounded border border-border'
        }
        role="img"
        aria-label={t('path_map_aria_label')}
        style={fill ? undefined : { height }}
      >
        <MiniMap
          fitPoints={points}
          fitMaxZoom={14}
          zoom={10}
          onReady={handleReady}
          onBasemapReapply={() => {
            if (mapRef.current) drawRoute(mapRef.current);
          }}
        />
      </div>
      {someMissingGps && (
        <p className="mt-1 shrink-0 text-xs text-muted-foreground">{t('path_map_missing_gps_note')}</p>
      )}
    </div>
  );
}
