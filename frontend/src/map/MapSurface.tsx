import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useT } from '../i18n';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { cn } from '../lib/utils';
import {
  BASEMAPS,
  getBasemap,
  getSavedBasemapId,
  saveBasemapId,
  rasterStyle,
  applyBasemap,
  markBasemapApplied,
  type BasemapEntry,
} from './engine/basemaps';
import { setMapLock2D } from './engine/mapLock2D';
import { setBuildings3D } from './engine/buildings3D';
import { isWebglAvailable } from './engine/webgl';
import { MapControls, type FabConfig, type ExtraFab } from './controls/MapControls';

export interface MapSurfaceProps {
  fabs: FabConfig;
  initialCenter?: [number, number];
  initialZoom?: number;
  onReady?: (map: MlMap) => void;
  onBasemapReapply?: () => void;
  className?: string;
  children?: ReactNode;
  // Control passthrough to MapControls.
  tilt3D?: boolean;
  onToggleTilt?: (on: boolean) => void;
  buildings?: boolean;
  onToggleBuildings?: (on: boolean) => void;
  nodeScale?: number;
  onNodeScale?: (v: number) => void;
  linksOn?: boolean;
  onToggleLinks?: (on: boolean) => void;
  onSearch?: (query: string) => void;
  legendContent?: ReactNode;
  extraFabs?: ExtraFab[];
}

/** Synchronous initial style for map creation. A vector-recolor basemap cannot
 *  be built synchronously (it fetches then recolours), so it mounts on plain
 *  OpenFreeMap dark and is upgraded via applyBasemap once the map has loaded. */
function initialStyleFor(entry: BasemapEntry): string | StyleSpecification {
  if (entry.kind === 'raster') return rasterStyle(entry);
  if (entry.kind === 'vector') return String(entry.styleUrl);
  return String(getBasemap('ofm-dark').styleUrl);
}

export function MapSurface(props: MapSurfaceProps) {
  const {
    fabs,
    initialCenter = [5.1, 52.1],
    initialZoom = 7,
    onReady,
    onBasemapReapply,
    className,
    children,
    tilt3D = false,
    buildings = false,
  } = props;
  const t = useT();
  const dark = useIsDarkTheme();
  const theme: 'light' | 'dark' = dark ? 'dark' : 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const webglOk = useRef(isWebglAvailable());
  const [selectedBasemapId, setSelectedBasemapId] = useState<string>(() => getSavedBasemapId());

  // Create the map once.
  useEffect(() => {
    if (!webglOk.current || !containerRef.current) return;
    const entry = getBasemap(selectedBasemapId);
    const map = new MlMap({
      container: containerRef.current,
      style: initialStyleFor(entry),
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (entry.kind === 'vector-recolor') markBasemapApplied(map, getBasemap('ofm-dark'));
    else markBasemapApplied(map, entry);

    map.on('load', () => {
      setMapLock2D(map, !tilt3D);
      if (entry.kind === 'vector-recolor') {
        applyBasemap(map, entry, { reapplyOverlays: onBasemapReapply, theme });
      }
      onReady?.(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-once: subsequent basemap/theme changes are handled by other effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize with the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Apply basemap changes after mount.
  const firstBasemap = useRef(true);
  useEffect(() => {
    if (firstBasemap.current) {
      firstBasemap.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    saveBasemapId(selectedBasemapId);
    applyBasemap(map, getBasemap(selectedBasemapId), {
      reapplyOverlays: onBasemapReapply,
      theme,
      buildingsOn: buildings,
      onBuildings: setBuildings3D,
    });
  }, [selectedBasemapId, onBasemapReapply, theme, buildings]);

  if (!webglOk.current) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-muted p-4 text-center text-sm text-muted-foreground',
          className
        )}
      >
        {t('map_webgl_unavailable')}
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Fill the parent for real: maplibre-gl.css forces `.maplibregl-map`
          to position:relative, which cancels an `absolute inset-0` container
          and collapses its height to 0. Use h-full/w-full so the height
          resolves against the relative parent instead. */}
      <div ref={containerRef} className="h-full w-full" />
      {children}
      <MapControls
        fabs={fabs}
        basemaps={BASEMAPS.map((b) => ({ id: b.id, label: b.label }))}
        selectedBasemapId={selectedBasemapId}
        onSelectBasemap={setSelectedBasemapId}
        tilt3D={props.tilt3D}
        onToggleTilt={props.onToggleTilt}
        buildings={props.buildings}
        onToggleBuildings={props.onToggleBuildings}
        nodeScale={props.nodeScale}
        onNodeScale={props.onNodeScale}
        linksOn={props.linksOn}
        onToggleLinks={props.onToggleLinks}
        onSearch={props.onSearch}
        legendContent={props.legendContent}
        extraFabs={props.extraFabs}
      />
    </div>
  );
}
