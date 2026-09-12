import { useCallback, useEffect, useRef, useState } from 'react';
import { Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import { isValidLocation } from '../utils/pathUtils';
import { Button } from './ui/button';
import type { Contact } from '../types';
import { useT } from '../i18n';
import { MiniMap } from '../map/MiniMap';

interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (lat: number, lon: number, label: string) => void;
  contacts: Contact[];
  /** Initial map center and default selected point ([lat, lon]). */
  initialCenter: [number, number];
  /** Prefill for the label field. */
  initialLabel?: string;
}

export function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  contacts,
  initialCenter,
  initialLabel = '',
}: LocationPickerModalProps) {
  const t = useT();
  const [selected, setSelected] = useState<[number, number]>(initialCenter); // [lat, lon]
  const [label, setLabel] = useState(initialLabel);
  const mapRef = useRef<MlMap | null>(null);
  const selMarkerRef = useRef<MlMarker | null>(null);

  const nodeMarkers = contacts.filter((c) => isValidLocation(c.lat, c.lon));

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      m.addSource('lp-nodes', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: nodeMarkers.map((c) => ({
            type: 'Feature',
            properties: { name: c.name ?? '', lat: c.lat, lon: c.lon },
            geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          })),
        },
      });
      m.addLayer({
        id: 'lp-nodes',
        type: 'circle',
        source: 'lp-nodes',
        paint: {
          'circle-radius': 6,
          'circle-color': '#3b82f6',
          'circle-opacity': 0.7,
          'circle-stroke-color': '#3b82f6',
          'circle-stroke-width': 1,
        },
      });
      // Picking a node marker selects it and prefills the label.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', 'lp-nodes', (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        setSelected([Number(f.properties.lat), Number(f.properties.lon)]);
        if (f.properties.name) setLabel(String(f.properties.name));
      });
      m.on('mouseenter', 'lp-nodes', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'lp-nodes', () => {
        m.getCanvas().style.cursor = '';
      });
      // Clicking empty map moves the selection (skip when a node was clicked).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', (e: any) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ['lp-nodes'] });
        if (hit && hit.length) return;
        setSelected([e.lngLat.lat, e.lngLat.lng]);
      });

      const el = document.createElement('div');
      el.style.cssText =
        'width:18px;height:18px;border-radius:9999px;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.4);cursor:grab';
      const marker = new MlMarker({ element: el, draggable: true }).setLngLat([selected[1], selected[0]]).addTo(map);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        setSelected([ll.lat, ll.lng]);
      });
      selMarkerRef.current = marker;
    },
    // selected is intentionally read once for the initial marker; later changes
    // are pushed via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeMarkers],
  );

  useEffect(() => {
    selMarkerRef.current?.setLngLat([selected[1], selected[0]]);
  }, [selected]);
  useEffect(
    () => () => {
      selMarkerRef.current?.remove();
      selMarkerRef.current = null;
    },
    [],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('location_picker_title')}
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xl">
        <h2 className="text-base font-semibold">{t('location_picker_title')}</h2>
        <p className="text-xs text-muted-foreground">{t('location_picker_instructions')}</p>
        <div className="h-64 overflow-hidden rounded border border-border">
          <MiniMap center={[initialCenter[1], initialCenter[0]]} zoom={13} onReady={handleReady} />
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {selected[0].toFixed(6)}, {selected[1].toFixed(6)}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('location_picker_label_field')}</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('location_picker_label_placeholder')}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common_cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected[0], selected[1], label)}>
            {t('location_picker_insert_button')}
          </Button>
        </div>
      </div>
    </div>
  );
}
