// Stored wardrive data on the repo's MiniMap: track lines and reception
// points coloured by RSSI. Used on the wardrive page and in Settings >
// Wardrive.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { useT } from '../../i18n';
import { MiniMap } from '../../map/MiniMap';
import type { WardriveData } from '../api';
import { rssiColor, toGeoJson } from './geo';

const LINE_COLOR = '#a78bfa';
const LEGEND: [number | null, string][] = [
  [-75, '≥ -80'],
  [-85, '-80 … -90'],
  [-95, '-90 … -100'],
  [-105, '-100 … -110'],
  [-115, '< -110'],
];

export function WardriveMap({ data, className }: { data: WardriveData; className?: string }) {
  const t = useT();
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const geo = useMemo(() => toGeoJson(data), [data]);
  const geoRef = useRef(geo);
  geoRef.current = geo;

  const setData = useCallback((map: MlMap, fit: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    m.getSource('wd-lines')?.setData(geoRef.current.lines);
    m.getSource('wd-points')?.setData(geoRef.current.points);
    if (fit && geoRef.current.bounds) {
      map.fitBounds(geoRef.current.bounds, { padding: 32, maxZoom: 15, duration: 0 });
    }
  }, []);

  const ensureLayers = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      if (!m.getSource('wd-lines')) {
        m.addSource('wd-lines', { type: 'geojson', data: geoRef.current.lines });
        m.addLayer({
          id: 'wd-lines',
          type: 'line',
          source: 'wd-lines',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': LINE_COLOR, 'line-width': 3, 'line-opacity': 0.75 },
        });
      }
      if (!m.getSource('wd-points')) {
        m.addSource('wd-points', { type: 'geojson', data: geoRef.current.points });
        m.addLayer({
          id: 'wd-points',
          type: 'circle',
          source: 'wd-points',
          paint: {
            'circle-radius': 5,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#111827',
            'circle-stroke-width': 1,
          },
        });
      }
      setData(map, false);
    },
    [setData]
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      setData(map, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', 'wd-points', (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        popupRef.current?.remove();
        popupRef.current = new MlPopup({ closeButton: true, offset: 10 })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setText(
            t('wardrive_map_popup', {
              time: new Date(String(p.rx_at)).toLocaleString(),
              rssi: p.rssi ?? t('wardrive_map_unknown'),
              snr: p.snr ?? t('wardrive_map_unknown'),
              user: String(p.username ?? ''),
              radio: String(p.radio ?? ''),
            })
          )
          .addTo(map);
      });
      m.on('mouseenter', 'wd-points', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'wd-points', () => {
        m.getCanvas().style.cursor = '';
      });
    },
    [ensureLayers, setData, t]
  );

  useEffect(() => {
    if (mapRef.current) setData(mapRef.current, true);
  }, [geo, setData]);

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    []
  );

  return (
    <div className={className}>
      <div className="h-80 overflow-hidden rounded border border-border">
        <MiniMap
          zoom={11}
          center={[5.3, 52.1]}
          onReady={handleReady}
          ariaLabel={t('wardrive_map_aria')}
          onBasemapReapply={() => {
            if (mapRef.current) ensureLayers(mapRef.current);
          }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('wardrive_map_legend')}</span>
        {LEGEND.map(([sample, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: rssiColor(sample) }}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: rssiColor(null) }}
          />
          {t('wardrive_map_unknown')}
        </span>
      </div>
    </div>
  );
}
