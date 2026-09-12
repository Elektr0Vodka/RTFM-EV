import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidLocation } from '../utils/pathUtils';
import type { ResolvedPath, SenderInfo } from '../utils/pathUtils';
import { themeRasterTile } from '../utils/mapTiles';
import { useIsDarkTheme } from '../hooks';
import { useT } from '../i18n';

interface PathRouteMapProps {
  /** Single resolved route (legacy callers). Ignored when `routes` is given. */
  resolved?: ResolvedPath;
  /**
   * Multiple resolved routes to overlay on one map. When more than one is
   * present each route draws its own coloured line and a legend is shown.
   */
  routes?: ResolvedPath[];
  senderInfo: SenderInfo;
  /** Fixed map height in px. Ignored when `fill` is set. */
  height?: number;
  /** When true, the map fills its parent's height instead of using `height`. */
  fill?: boolean;
}

// Distinct line colours per overlaid route (indexed by route number - 1).
const ROUTE_LINE_COLORS = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#22c55e', // green
  '#ec4899', // pink
  '#a855f7', // purple
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ef4444', // red
];

function getRouteColor(routeIndex: number): string {
  return ROUTE_LINE_COLORS[routeIndex % ROUTE_LINE_COLORS.length];
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

function makeIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="
      width:24px;height:24px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      border:2px solid rgba(255,255,255,0.8);
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    ">${label}</div>`,
  });
}

function getHopColor(hopIndex: number): string {
  return HOP_COLORS[hopIndex % HOP_COLORS.length];
}

/** Collect all valid [lat, lon] points for bounds fitting */
function collectPoints(resolved: ResolvedPath): [number, number][] {
  const pts: [number, number][] = [];
  if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
    pts.push([resolved.sender.lat!, resolved.sender.lon!]);
  }
  for (const hop of resolved.hops) {
    for (const m of hop.matches) {
      if (isValidLocation(m.lat, m.lon)) {
        pts.push([m.lat!, m.lon!]);
      }
    }
  }
  if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
    pts.push([resolved.receiver.lat!, resolved.receiver.lon!]);
  }
  return pts;
}

/**
 * Ordered list of route points for the connecting line: sender, then one
 * representative (first located) contact per hop, then receiver. Hops with no
 * located contact are skipped so the line still spans the gap.
 */
function collectRouteLine(resolved: ResolvedPath): [number, number][] {
  const line: [number, number][] = [];
  if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
    line.push([resolved.sender.lat!, resolved.sender.lon!]);
  }
  for (const hop of resolved.hops) {
    const m = hop.matches.find((x) => isValidLocation(x.lat, x.lon));
    if (m) line.push([m.lat!, m.lon!]);
  }
  if (isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
    line.push([resolved.receiver.lat!, resolved.receiver.lon!]);
  }
  return line;
}

/** Watches the map container for size changes and tells Leaflet to re-tile. */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Fit map bounds once on mount, then let the user pan/zoom freely */
function RouteMapBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    fitted.current = true;
    if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(points as L.LatLngBoundsExpression, { padding: [30, 30], maxZoom: 14 });
    }
  }, [map, points]);

  return null;
}

export function PathRouteMap({
  resolved,
  routes,
  senderInfo,
  height = 220,
  fill = false,
}: PathRouteMapProps) {
  const t = useT();
  const dark = useIsDarkTheme();
  const tile = themeRasterTile(dark);
  const singleLineColor = dark ? '#e2e8f0' : '#1e293b';

  const routeList: ResolvedPath[] =
    routes && routes.length > 0 ? routes : resolved ? [resolved] : [];
  const isMulti = routeList.length > 1;

  // Union of all located points across every route, for bounds fitting.
  const points: [number, number][] = [];
  for (const r of routeList) points.push(...collectPoints(r));
  const hasAnyGps = points.length > 0;

  // Count nodes missing GPS across all routes (sender/receiver counted once).
  const shared = routeList[0];
  let totalNodes = 0;
  let nodesWithGps = 0;
  if (shared) {
    totalNodes += 2; // sender + receiver
    if (isValidLocation(shared.sender.lat, shared.sender.lon)) nodesWithGps++;
    if (isValidLocation(shared.receiver.lat, shared.receiver.lon)) nodesWithGps++;
    for (const r of routeList) {
      for (const hop of r.hops) {
        if (hop.matches.length === 0) {
          totalNodes++;
        } else {
          totalNodes += hop.matches.length;
          nodesWithGps += hop.matches.filter((m) => isValidLocation(m.lat, m.lon)).length;
        }
      }
    }
  }
  const someMissingGps = hasAnyGps && nodesWithGps < totalNodes;

  if (!hasAnyGps || !shared) {
    return (
      <div className="h-14 rounded border border-border bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
        {t('path_map_no_gps')}
      </div>
    );
  }

  const center: [number, number] = points[0];

  return (
    <div className={fill ? 'flex flex-col h-full min-h-0' : undefined}>
      <div
        className={
          fill
            ? 'rounded border border-border overflow-hidden flex-1 min-h-0'
            : 'rounded border border-border overflow-hidden'
        }
        role="img"
        aria-label={t('path_map_aria_label')}
        style={fill ? undefined : { height }}
      >
        <MapContainer
          center={center}
          zoom={10}
          maxZoom={tile.maxZoom}
          className="h-full w-full"
          style={{ background: tile.background }}
        >
          <InvalidateOnResize />
          <TileLayer
            key={tile.id}
            attribution={tile.attribution}
            url={tile.url}
            maxZoom={tile.maxZoom}
          />
          <RouteMapBounds points={points} />

          {/* Connecting line(s) along each route (drawn under the markers) */}
          {routeList.map((r, ri) => {
            const routeLine = collectRouteLine(r);
            if (routeLine.length < 2) return null;
            return (
              <Polyline
                key={`route-line-${ri}`}
                positions={routeLine}
                pathOptions={{
                  color: isMulti ? getRouteColor(ri) : singleLineColor,
                  weight: 3,
                  opacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            );
          })}

          {/* Sender marker (shared by all routes) */}
          {isValidLocation(shared.sender.lat, shared.sender.lon) && (
            <Marker
              position={[shared.sender.lat!, shared.sender.lon!]}
              icon={makeIcon('S', SENDER_COLOR)}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <span className="font-mono">{shared.sender.prefix}</span>
                {' · '}
                {senderInfo.name || t('path_modal_sender_label')}
              </Tooltip>
            </Marker>
          )}

          {/* Hop markers: coloured by route when overlaying, else by hop number */}
          {routeList.map((r, ri) =>
            r.hops.map((hop, hopIdx) =>
              hop.matches
                .filter((m) => isValidLocation(m.lat, m.lon))
                .map((m, mIdx) => (
                  <Marker
                    key={`r${ri}-hop-${hopIdx}-${mIdx}`}
                    position={[m.lat!, m.lon!]}
                    icon={makeIcon(
                      String(hopIdx + 1),
                      isMulti ? getRouteColor(ri) : getHopColor(hopIdx)
                    )}
                  >
                    <Tooltip direction="top" offset={[0, -14]}>
                      {isMulti && (
                        <>
                          <span>{t('path_modal_path_number', { n: ri + 1 })}</span>
                          {' · '}
                        </>
                      )}
                      <span className="font-mono">{hop.prefix}</span>
                      {' · '}
                      {m.name || m.public_key.slice(0, 12)}
                    </Tooltip>
                  </Marker>
                ))
            )
          )}

          {/* Receiver marker (shared by all routes) */}
          {isValidLocation(shared.receiver.lat, shared.receiver.lon) && (
            <Marker
              position={[shared.receiver.lat!, shared.receiver.lon!]}
              icon={makeIcon('R', RECEIVER_COLOR)}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <span className="font-mono">{shared.receiver.prefix}</span>
                {' · '}
                {shared.receiver.name || t('path_map_receiver_fallback')}
              </Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
      {isMulti && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 shrink-0" aria-hidden="true">
          {routeList.map((r, ri) => (
            <span
              key={`legend-${ri}`}
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: getRouteColor(ri) }}
              />
              {t('path_map_route_legend', { n: ri + 1, hops: r.hops.length })}
            </span>
          ))}
        </div>
      )}
      {someMissingGps && (
        <p className="text-xs text-muted-foreground mt-1 shrink-0">
          {t('path_map_missing_gps_note')}
        </p>
      )}
    </div>
  );
}
