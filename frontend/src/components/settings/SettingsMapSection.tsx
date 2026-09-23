import { useCallback, useEffect, useRef, useState } from 'react';
import { Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { useT } from '../../i18n';
import { MiniMap } from '../../map/MiniMap';
import { DEFAULT_HOME_ZOOM, type MapHomeMode } from '../../map/homeView';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SettingsTileCacheSection } from './SettingsTileCacheSection';

/** Fallback centre for the picker when no home location has been set yet. */
const DEFAULT_PICKER_CENTER: [number, number] = [5.1, 52.1];

function isValidLat(v: number | null): v is number {
  return v != null && Number.isFinite(v) && v >= -90 && v <= 90;
}
function isValidLon(v: number | null): v is number {
  return v != null && Number.isFinite(v) && v >= -180 && v <= 180;
}

export function SettingsMapSection({
  appSettings,
  onSaveAppSettings,
  className,
}: {
  appSettings: AppSettings;
  onSaveAppSettings: (update: AppSettingsUpdate) => void;
  className?: string;
}) {
  const t = useT();
  const mode: MapHomeMode = appSettings.map_home_mode ?? 'auto';

  // Draft home camera, seeded once from the saved settings. We intentionally do
  // NOT re-seed from appSettings on every change: the user is actively editing
  // here, and a re-seed effect would clobber in-progress edits.
  const [lat, setLat] = useState<number | null>(appSettings.map_home_lat ?? null);
  const [lon, setLon] = useState<number | null>(appSettings.map_home_lon ?? null);
  const [zoom, setZoom] = useState<number>(appSettings.map_home_zoom ?? DEFAULT_HOME_ZOOM);

  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);

  const placeMarker = useCallback((lngLat: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      markerRef.current = new MlMarker({ color: '#3b82f6', draggable: true })
        .setLngLat(lngLat)
        .addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current?.getLngLat();
        if (!p) return;
        setLon(p.lng);
        setLat(p.lat);
      });
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, []);

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const start: [number, number] =
        isValidLon(lon) && isValidLat(lat) ? [lon, lat] : DEFAULT_PICKER_CENTER;
      placeMarker(start);
      // Click drops/moves the home marker (sets lat/lon); it does not recenter.
      map.on('click', (e) => {
        setLon(e.lngLat.lng);
        setLat(e.lngLat.lat);
        placeMarker([e.lngLat.lng, e.lngLat.lat]);
      });
      // The mini-map's own zoom is captured as the saved home zoom.
      map.on('moveend', () => setZoom(map.getZoom()));
    },
    // Seed values are read once on mount; setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeMarker]
  );

  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    []
  );

  const handleLatInput = (value: string) => {
    if (value === '') {
      setLat(null);
      return;
    }
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) return;
    setLat(n);
    if (isValidLon(lon) && n >= -90 && n <= 90) {
      placeMarker([lon, n]);
      mapRef.current?.setCenter([lon, n]);
    }
  };

  const handleLonInput = (value: string) => {
    if (value === '') {
      setLon(null);
      return;
    }
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) return;
    setLon(n);
    if (isValidLat(lat) && n >= -180 && n <= 180) {
      placeMarker([n, lat]);
      mapRef.current?.setCenter([n, lat]);
    }
  };

  const handleZoomInput = (value: string) => {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(22, Math.max(0, n));
    setZoom(clamped);
    mapRef.current?.setZoom(clamped);
  };

  const canSaveHome = isValidLat(lat) && isValidLon(lon);

  const saveHome = () => {
    if (!canSaveHome) return;
    onSaveAppSettings({
      map_home_mode: 'home',
      map_home_lat: lat,
      map_home_lon: lon,
      map_home_zoom: zoom,
    });
  };

  return (
    <div className={className}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_map_home_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_map_home_description')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="map-home-mode">{t('settings_map_mode_label')}</Label>
        <select
          id="map-home-mode"
          value={mode}
          onChange={(e) => onSaveAppSettings({ map_home_mode: e.target.value as MapHomeMode })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="auto">{t('settings_map_mode_auto')}</option>
          <option value="home">{t('settings_map_mode_home')}</option>
          <option value="last">{t('settings_map_mode_last')}</option>
        </select>
        <p className="text-[0.8125rem] text-muted-foreground">
          {mode === 'auto' && t('settings_map_mode_auto_desc')}
          {mode === 'home' && t('settings_map_mode_home_desc')}
          {mode === 'last' && t('settings_map_mode_last_desc')}
        </p>
      </div>

      {mode === 'home' && (
        <div className="space-y-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_map_home_pick_hint')}
          </p>
          <div
            className="overflow-hidden rounded border border-border"
            style={{ height: 240 }}
            aria-label={t('settings_map_picker_aria')}
          >
            <MiniMap
              center={isValidLon(lon) && isValidLat(lat) ? [lon, lat] : DEFAULT_PICKER_CENTER}
              zoom={zoom}
              onReady={handleReady}
              onBasemapReapply={() => {
                if (isValidLon(lon) && isValidLat(lat)) placeMarker([lon, lat]);
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="map-home-lat">{t('settings_map_lat_label')}</Label>
              <Input
                id="map-home-lat"
                type="number"
                inputMode="decimal"
                step="any"
                value={lat ?? ''}
                onChange={(e) => handleLatInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-home-lon">{t('settings_map_lon_label')}</Label>
              <Input
                id="map-home-lon"
                type="number"
                inputMode="decimal"
                step="any"
                value={lon ?? ''}
                onChange={(e) => handleLonInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-home-zoom">{t('settings_map_zoom_label')}</Label>
              <Input
                id="map-home-zoom"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                max={22}
                value={Number.isFinite(zoom) ? zoom : ''}
                onChange={(e) => handleZoomInput(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={saveHome} disabled={!canSaveHome}>
              {t('settings_map_home_save')}
            </Button>
            {!canSaveHome && (
              <span className="text-[0.8125rem] text-muted-foreground">
                {t('settings_map_home_unset')}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-border/60 pt-4">
        <SettingsTileCacheSection />
      </div>
    </div>
  );
}
