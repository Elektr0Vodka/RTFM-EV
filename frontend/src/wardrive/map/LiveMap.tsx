// The wardrive screen's map: the app's MapSurface (saved basemap, theme tone,
// 3D buildings) filling the screen, without its own button stack (the screen
// has its own rail). Shows the trail, this session's receptions coloured by
// signal tier, the selected reception and the own position. Follow keeps the
// own position centred, north up; a drag by the user hands control back.
import type { Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { MapSurface } from '../../map/MapSurface';
import { setBuildings3D } from '../../map/engine/buildings3D';
import { setMapLock2D } from '../../map/engine/mapLock2D';
import type { LiveEntry } from '../liveLog';
import type { Fix } from '../messages';
import { PITCH_3D, followView, liveGeoJson, trailGeoJson } from './liveLayers';

export interface LiveMapProps {
  entries: LiveEntry[];
  selectedId: number | null;
  fix: Fix | null;
  trail: [number, number][];
  follow: boolean;
  tilt3D: boolean;
  onUserPan(): void;
  onSelect(id: number): void;
}

const NL_CENTER: [number, number] = [5.3, 52.1];

export function LiveMap({
  entries,
  selectedId,
  fix,
  trail,
  follow,
  tilt3D,
  onUserPan,
  onSelect,
}: LiveMapProps) {
  const mapRef = useRef<MlMap | null>(null);
  const toneRef = useRef<'light' | 'dark'>('dark');
  const [ready, setReady] = useState(false);
  const cvd = useCvdMode() !== 'off';

  const live = useMemo(() => liveGeoJson(entries, selectedId, cvd), [entries, selectedId, cvd]);
  const line = useMemo(() => trailGeoJson(trail), [trail]);
  const me = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: fix
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [fix.lon, fix.lat] },
              properties: {},
            },
          ]
        : [],
    }),
    [fix]
  );
  const dataRef = useRef({ live, line, me });
  dataRef.current = { live, line, me };
  const handlersRef = useRef({ onUserPan, onSelect });
  handlersRef.current = { onUserPan, onSelect };

  const pushData = useCallback((map: MlMap) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    const d = dataRef.current;
    m.getSource('wd-trail')?.setData(d.line);
    m.getSource('wd-live-points')?.setData(d.live.points);
    m.getSource('wd-live-selected')?.setData(d.live.selected);
    m.getSource('wd-me')?.setData(d.me);
  }, []);

  const ensureLayers = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      const d = dataRef.current;
      if (!m.getSource('wd-trail')) {
        m.addSource('wd-trail', { type: 'geojson', data: d.line });
        m.addLayer({
          id: 'wd-trail',
          type: 'line',
          source: 'wd-trail',
          paint: { 'line-color': '#8b5cf6', 'line-width': 3, 'line-opacity': 0.8 },
        });
      }
      if (!m.getSource('wd-live-points')) {
        m.addSource('wd-live-points', { type: 'geojson', data: d.live.points });
        m.addLayer({
          id: 'wd-live-points',
          type: 'circle',
          source: 'wd-live-points',
          paint: {
            'circle-radius': 6,
            'circle-color': ['get', 'color'],
            'circle-opacity': ['case', ['get', 'kept'], 0.95, 0.45],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#000000',
          },
        });
      }
      if (!m.getSource('wd-live-selected')) {
        m.addSource('wd-live-selected', { type: 'geojson', data: d.live.selected });
        m.addLayer({
          id: 'wd-live-selected',
          type: 'circle',
          source: 'wd-live-selected',
          paint: {
            'circle-radius': 11,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-width': 3,
            'circle-stroke-color': ['get', 'color'],
          },
        });
      }
      if (!m.getSource('wd-me')) {
        m.addSource('wd-me', { type: 'geojson', data: d.me });
        m.addLayer({
          id: 'wd-me',
          type: 'circle',
          source: 'wd-me',
          paint: {
            'circle-radius': 8,
            'circle-color': '#2563eb',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          },
        });
      }
      pushData(map);
    },
    [pushData]
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      map.on('dragstart', (e: { originalEvent?: unknown }) => {
        // Only a drag by the user, not a camera move of our own.
        if (e.originalEvent) handlersRef.current.onUserPan();
      });
      map.on('click', 'wd-live-points', (e: MapLayerMouseEvent) => {
        const id = Number(e.features?.[0]?.properties?.id);
        if (Number.isFinite(id)) handlersRef.current.onSelect(id);
      });
      setReady(true);
    },
    [ensureLayers]
  );

  useEffect(() => {
    if (ready && mapRef.current) pushData(mapRef.current);
  }, [ready, live, line, me, pushData]);

  // A reception picked in the live log: show where it was heard.
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || selectedId === null || selectedId === selectedRef.current) return;
    selectedRef.current = selectedId;
    const entry = entries.find((e) => e.id === selectedId);
    if (entry && entry.lat !== null && entry.lon !== null) {
      map.easeTo({ center: [entry.lon, entry.lat], duration: 500 });
    }
  }, [ready, selectedId, entries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !follow || !fix) return;
    map.easeTo({ center: [fix.lon, fix.lat], ...followView(map.getZoom(), tilt3D), duration: 500 });
  }, [ready, follow, fix, tilt3D]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setMapLock2D(map, !tilt3D);
    void setBuildings3D(map, tilt3D, toneRef.current).then(() => {
      map.easeTo({ pitch: tilt3D ? PITCH_3D : 0, duration: 500 });
    });
  }, [ready, tilt3D]);

  return (
    <MapSurface
      fabs={{}}
      className="h-full w-full"
      initialCenter={fix ? [fix.lon, fix.lat] : NL_CENTER}
      initialZoom={fix ? 15 : 8}
      onReady={handleReady}
      onBasemapReapply={() => {
        const map = mapRef.current;
        if (!map) return;
        ensureLayers(map);
        if (tilt3D) void setBuildings3D(map, true, toneRef.current);
      }}
      onBasemapTone={(tone) => {
        toneRef.current = tone;
      }}
    />
  );
}
