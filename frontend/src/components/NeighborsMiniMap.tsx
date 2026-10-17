import { useCallback, useEffect, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';
import { MiniMap } from '../map/MiniMap';
import { useCvdColors, useCvdMode } from '../hooks/useCvdColors';
import type { Tone } from '../utils/accessibility';

interface Neighbor {
  lat: number | null;
  lon: number | null;
  name: string | null;
  pubkey_prefix: string;
  snr: number;
}

interface Props {
  neighbors: Neighbor[];
  radioLat?: number | null;
  radioLon?: number | null;
  radioName?: string | null;
}

type ValidNeighbor = Neighbor & { lat: number; lon: number };

/** snr < 0 bad, 0..6 mid, >= 6 good: red / yellow / green, or the given
 *  colourblind stops. */
export function snrStepExpr(
  colors: { bad: string; mid: string; good: string } = {
    bad: '#ef4444',
    mid: '#eab308',
    good: '#22c55e',
  }
): unknown[] {
  return ['step', ['get', 'snr'], colors.bad, 0, colors.mid, 6, colors.good];
}

export function NeighborsMiniMap({ neighbors, radioLat, radioLon, radioName }: Props) {
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  // Colourblind mode: SNR circles take the palette's signal stops for the basemap's tone.
  const [basemapTone, setBasemapTone] = useState<Tone>('dark');
  const cvdMode = useCvdMode();
  const cvdColors = useCvdColors(basemapTone);
  const snrExpr = cvdMode === 'off' ? snrStepExpr() : snrStepExpr(cvdColors.signal);
  const snrExprRef = useRef(snrExpr);
  snrExprRef.current = snrExpr;

  const valid = neighbors.filter((n): n is ValidNeighbor => n.lat != null && n.lon != null);
  const hasRadio = radioLat != null && radioLon != null && !(radioLat === 0 && radioLon === 0);

  const setData = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      const lines = hasRadio
        ? valid.map((n) => ({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [radioLon, radioLat],
                [n.lon, n.lat],
              ],
            },
          }))
        : [];
      const neighborPts = valid.map((n) => ({
        type: 'Feature',
        properties: { snr: n.snr, label: n.name || n.pubkey_prefix },
        geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      }));
      const radioPts = hasRadio
        ? [
            {
              type: 'Feature',
              properties: { label: radioName || 'Our Radio' },
              geometry: { type: 'Point', coordinates: [radioLon, radioLat] },
            },
          ]
        : [];
      m.getSource('nm-lines')?.setData({ type: 'FeatureCollection', features: lines });
      m.getSource('nm-neighbors')?.setData({ type: 'FeatureCollection', features: neighborPts });
      m.getSource('nm-radio')?.setData({ type: 'FeatureCollection', features: radioPts });
    },
    [valid, hasRadio, radioLat, radioLon, radioName]
  );

  const ensureLayers = useCallback(
    (map: MlMap) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      if (!m.getSource('nm-lines')) {
        m.addSource('nm-lines', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'nm-lines',
          type: 'line',
          source: 'nm-lines',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': '#3b82f6',
            'line-width': 1.5,
            'line-opacity': 0.5,
            'line-dasharray': [2, 2],
          },
        });
      }
      if (!m.getSource('nm-neighbors')) {
        m.addSource('nm-neighbors', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'nm-neighbors',
          type: 'circle',
          source: 'nm-neighbors',
          paint: {
            'circle-radius': 6,
            'circle-color': snrExprRef.current,
            'circle-opacity': 0.85,
            'circle-stroke-color': '#000',
            'circle-stroke-width': 1,
          },
        });
      }
      if (!m.getSource('nm-radio')) {
        m.addSource('nm-radio', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'nm-radio',
          type: 'circle',
          source: 'nm-radio',
          paint: {
            'circle-radius': 8,
            'circle-color': '#3b82f6',
            'circle-opacity': 1,
            'circle-stroke-color': '#1d4ed8',
            'circle-stroke-width': 2,
          },
        });
      }
      setData(map);
    },
    [setData]
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = map as any;
      for (const layer of ['nm-neighbors', 'nm-radio']) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.on('click', layer, (e: any) => {
          const f = e.features?.[0];
          if (!f) return;
          popupRef.current?.remove();
          popupRef.current = new MlPopup({ closeButton: true, offset: 10 })
            .setLngLat(f.geometry.coordinates as [number, number])
            .setText(String(f.properties?.label ?? ''))
            .addTo(map);
        });
        m.on('mouseenter', layer, () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = '';
        });
      }
    },
    [ensureLayers]
  );

  useEffect(() => {
    if (mapRef.current) setData(mapRef.current);
  }, [setData]);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mapRef.current as any;
    if (m?.getLayer?.('nm-neighbors')) m.setPaintProperty('nm-neighbors', 'circle-color', snrExpr);
    // snrExpr is rebuilt each render; its inputs are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvdMode, cvdColors]);
  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    []
  );

  if (valid.length === 0 && !hasRadio) return null;

  const fitPoints: [number, number][] = [
    ...(hasRadio ? [[radioLon as number, radioLat as number] as [number, number]] : []),
    ...valid.map((n) => [n.lon, n.lat] as [number, number]),
  ];

  return (
    <div
      className="min-h-48 flex-1 overflow-hidden rounded border border-border"
      aria-label="Map showing repeater neighbor locations"
    >
      <MiniMap
        fitPoints={fitPoints}
        zoom={10}
        onReady={handleReady}
        onBasemapTone={setBasemapTone}
        onBasemapReapply={() => {
          if (mapRef.current) ensureLayers(mapRef.current);
        }}
      />
    </div>
  );
}
