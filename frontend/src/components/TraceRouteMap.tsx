import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import type { Contact, RadioConfig, RadioTraceNode } from '../types';
import { useT } from '../i18n';
import { MiniMap } from '../map/MiniMap';
import { getBasemap, getSavedBasemapId } from '../map/engine/basemaps';
import { getHopColor, markerEl, SENDER_COLOR } from '../map/routeMapVisuals';
import {
  buildTraceMapSegments,
  formatSNR,
  resolveTraceNodeLocations,
  type TraceMapNode,
} from '../utils/traceMapUtils';

interface TraceRouteMapProps {
  /** Ordered trace nodes: the synthetic local origin, each hop, then the
   *  backend-reported local terminal. Same list `TracePane` renders as rows. */
  nodes: RadioTraceNode[];
  /** Repeater contacts, used to place hops at their known/manual location. */
  contacts: Contact[];
  config: RadioConfig | null;
  /** Fixed map height in px. Ignored when `fill` is set. */
  height?: number;
  /** When true, the map fills its parent's height instead of using `height`. */
  fill?: boolean;
}

interface MarkerSpec {
  lngLat: [number, number];
  label: string;
  color: string;
  title: string;
}

const SOURCE_ID = 'trace-route-line';
const SOLID_LAYER = 'trace-route-line-solid';
const DASHED_LAYER = 'trace-route-line-dashed';
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

/** Draws a trace result (from `TracePane`) on a small map: hops placed at
 *  their known or manually-overridden location, connected by a route line
 *  that follows the basemap tone (PR #183). A segment spanning one or more
 *  hops with no known location is drawn dashed to show the gap; those hops
 *  are skipped, not guessed at. Per-hop SNR is shown as a marker tooltip. */
export function TraceRouteMap({
  nodes,
  contacts,
  config,
  height = 220,
  fill = false,
}: TraceRouteMapProps) {
  const t = useT();
  // Contrast with the basemap, not the app theme, matching PathRouteMap.
  const [basemapTone, setBasemapTone] = useState<'light' | 'dark'>(
    () => getBasemap(getSavedBasemapId()).tone ?? 'dark'
  );
  const lineColor = basemapTone === 'dark' ? '#e2e8f0' : '#1e293b';
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);

  const contactsByKey = useMemo(() => new Map(contacts.map((c) => [c.public_key, c])), [contacts]);

  const mapNodes = useMemo<TraceMapNode[]>(
    () => resolveTraceNodeLocations(nodes, config, contactsByKey),
    [nodes, config, contactsByKey]
  );
  const locatedNodes = useMemo(
    () => mapNodes.filter((n) => n.lat !== null && n.lon !== null),
    [mapNodes]
  );
  const points = useMemo<[number, number][]>(
    () => locatedNodes.map((n) => [n.lon as number, n.lat as number]),
    [locatedNodes]
  );
  const hasAnyGps = points.length > 0;
  const someMissingGps = mapNodes.length > locatedNodes.length;
  const lastIndex = mapNodes.length - 1;

  const segments = useMemo(() => buildTraceMapSegments(mapNodes), [mapNodes]);
  const lineFeatures = useMemo(() => {
    const features = segments.map((seg) => ({
      type: 'Feature' as const,
      properties: { dashed: seg.dashed ? 1 : 0 },
      geometry: { type: 'LineString' as const, coordinates: seg.coordinates },
    }));
    return { type: 'FeatureCollection' as const, features };
  }, [segments]);

  const markerSpecs = useMemo<MarkerSpec[]>(() => {
    return locatedNodes.map((n) => {
      const isLocal = n.index === 0 || n.index === lastIndex;
      const label = isLocal ? t('trace_badge_self') : String(n.index);
      const color = isLocal ? SENDER_COLOR : getHopColor(n.index - 1);
      const shortKey = n.publicKey ? n.publicKey.slice(0, 12) : t('trace_unknown_key');
      const namePart = n.name || shortKey;
      const snrText = formatSNR(n.snr);
      const title = snrText ? `${namePart} · ${t('trace_snr_label')} ${snrText}` : namePart;
      return { lngLat: [n.lon as number, n.lat as number], label, color, title };
    });
  }, [locatedNodes, lastIndex, t]);

  const draw = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      if (!m.getSource(SOURCE_ID)) {
        m.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
        m.addLayer({
          id: SOLID_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'dashed'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': lineColor, 'line-width': 3, 'line-opacity': 0.85 },
        });
        m.addLayer({
          id: DASHED_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'dashed'], 1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': lineColor,
            'line-width': 3,
            'line-opacity': 0.85,
            'line-dasharray': [2, 2],
          },
        });
      } else {
        m.setPaintProperty?.(SOLID_LAYER, 'line-color', lineColor);
        m.setPaintProperty?.(DASHED_LAYER, 'line-color', lineColor);
      }
      m.getSource(SOURCE_ID)?.setData(lineFeatures.features.length ? lineFeatures : EMPTY_FC);
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = markerSpecs.map((s) =>
        new MlMarker({ element: markerEl(s.label, s.color, s.title) })
          .setLngLat(s.lngLat)
          .addTo(map)
      );
    },
    [lineFeatures, markerSpecs, lineColor]
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      draw(map);
    },
    [draw]
  );

  useEffect(() => {
    if (mapRef.current) draw(mapRef.current);
  }, [draw]);
  useEffect(
    () => () => {
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
    },
    []
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
        aria-label={t('trace_map_aria_label')}
        style={fill ? undefined : { height }}
      >
        <MiniMap
          fitPoints={points}
          fitMaxZoom={14}
          zoom={10}
          onReady={handleReady}
          onBasemapTone={setBasemapTone}
          onBasemapReapply={() => {
            if (mapRef.current) draw(mapRef.current);
          }}
        />
      </div>
      {someMissingGps && (
        <p className="mt-1 shrink-0 text-xs text-muted-foreground">
          {t('path_map_missing_gps_note')}
        </p>
      )}
    </div>
  );
}
