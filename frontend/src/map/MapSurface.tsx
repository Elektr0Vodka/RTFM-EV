import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useT } from '../i18n';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { cn } from '../lib/utils';
import {
  BASEMAPS,
  getBasemap,
  novaBasemap,
  getSavedBasemapId,
  saveBasemapId,
  rasterStyle,
  rasterFallbackFor,
  applyBasemap,
  markBasemapApplied,
  type BasemapEntry,
  type NovaTint,
} from './engine/basemaps';
import {
  CRT_CHANGE_EVENT,
  CRT_PHOSPHOR_HUE,
  getActiveCrtPhosphor,
  getCrtMapTint,
} from '../utils/crt';
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
  roleColors?: Record<number, string>;
  onRoleColorChange?: (type: number, color: string) => void;
  onResetRoleColors?: () => void;
  labelMode?: 'off' | 'name' | 'tag';
  onLabelMode?: (mode: 'off' | 'name' | 'tag') => void;
  arcWidthScale?: number;
  onArcWidthScale?: (v: number) => void;
  linkWidthScale?: number;
  onLinkWidthScale?: (v: number) => void;
  neonNodes?: boolean;
  onToggleNeon?: (on: boolean) => void;
  linksOn?: boolean;
  onToggleLinks?: (on: boolean) => void;
  linkMode?: 'liveness' | 'advert';
  onLinkMode?: (mode: 'liveness' | 'advert') => void;
  linkConfidence?: 1 | 2 | 3;
  onLinkConfidence?: (level: 1 | 2 | 3) => void;
  telemetryOn?: boolean;
  onToggleTelemetry?: (on: boolean) => void;
  sidebarOpen?: boolean;
  onSearch?: (query: string) => void;
  legendContent?: ReactNode;
  extraFabs?: ExtraFab[];
}

/** Synchronous initial style for map creation. A vector-recolor basemap cannot
 *  be built synchronously (it fetches then recolours), so it mounts on the
 *  tone-matched keyless raster (which paints instantly and reliably) and is
 *  upgraded via applyBasemap once the map has loaded. Mounting on the raster
 *  instead of a second OpenFreeMap style avoids the double vector fetch that
 *  could race and leave the basemap blank under OpenFreeMap rate-limiting, and
 *  guarantees a visible map even if the vector upgrade never completes. */
function initialStyleFor(entry: BasemapEntry): string | StyleSpecification {
  if (entry.kind === 'raster') return rasterStyle(entry);
  if (entry.kind === 'vector') return String(entry.styleUrl);
  return rasterStyle(rasterFallbackFor(entry));
}

/** Current Nova tint from CRT prefs, or undefined when the tint is off or the
 *  active theme is not a CRT theme (no phosphor hue to tint to). */
function novaTintFromPrefs(): NovaTint | undefined {
  if (!getCrtMapTint()) return undefined;
  const p = getActiveCrtPhosphor();
  if (!p) return undefined;
  return { id: p, hue: CRT_PHOSPHOR_HUE[p], desaturate: p === 'white' };
}

/** Resolve a basemap id to an entry, applying the CRT tint to Nova Dark only. */
function resolveBasemapEntry(id: string): BasemapEntry {
  const entry = getBasemap(id);
  if (entry.id === 'nova') {
    const tint = novaTintFromPrefs();
    if (tint) return novaBasemap(tint);
  }
  return entry;
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
    const entry = resolveBasemapEntry(selectedBasemapId);
    const map = new MlMap({
      container: containerRef.current,
      style: initialStyleFor(entry),
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (entry.kind === 'vector-recolor') markBasemapApplied(map, rasterFallbackFor(entry));
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

  // Re-tint the Nova basemap when a CRT preference changes (phosphor colour or the
  // map-tint toggle). A bump forces the apply-basemap effect below to re-run.
  const [tintSig, setTintSig] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onCrtChange = () => setTintSig((n) => n + 1);
    window.addEventListener(CRT_CHANGE_EVENT, onCrtChange);
    return () => window.removeEventListener(CRT_CHANGE_EVENT, onCrtChange);
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
    // applyBasemap no-ops when the entry's signature is unchanged, so a tintSig
    // bump on a non-Nova basemap costs nothing.
    applyBasemap(map, resolveBasemapEntry(selectedBasemapId), {
      reapplyOverlays: onBasemapReapply,
      theme,
      buildingsOn: buildings,
      onBuildings: setBuildings3D,
    });
  }, [selectedBasemapId, onBasemapReapply, theme, buildings, tintSig]);

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
        arcWidthScale={props.arcWidthScale}
        onArcWidthScale={props.onArcWidthScale}
        linkWidthScale={props.linkWidthScale}
        onLinkWidthScale={props.onLinkWidthScale}
        neonNodes={props.neonNodes}
        onToggleNeon={props.onToggleNeon}
        roleColors={props.roleColors}
        onRoleColorChange={props.onRoleColorChange}
        onResetRoleColors={props.onResetRoleColors}
        labelMode={props.labelMode}
        onLabelMode={props.onLabelMode}
        linksOn={props.linksOn}
        onToggleLinks={props.onToggleLinks}
        linkMode={props.linkMode}
        onLinkMode={props.onLinkMode}
        linkConfidence={props.linkConfidence}
        onLinkConfidence={props.onLinkConfidence}
        telemetryOn={props.telemetryOn}
        onToggleTelemetry={props.onToggleTelemetry}
        sidebarOpen={props.sidebarOpen}
        onSearch={props.onSearch}
        legendContent={props.legendContent}
        extraFabs={props.extraFabs}
      />
    </div>
  );
}
