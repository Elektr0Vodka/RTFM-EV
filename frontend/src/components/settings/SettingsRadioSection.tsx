import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Download, MapPinned, Upload } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { Checkbox } from '../ui/checkbox';
import { MeshcomodSettings } from './MeshcomodSettings';
import { useT } from '../../i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { api } from '../../api';
import { RADIO_PRESETS } from '../../utils/radioPresets';
import { stripRegionScopePrefix } from '../../utils/regionScope';
import { allDutchScopes } from '../../lib/dutchGeo';
import type {
  AppSettings,
  AppSettingsUpdate,
  HealthStatus,
  RadioAdvertMode,
  RadioConfig,
  RadioConfigUpdate,
  RadioDiscoveryResponse,
  RadioDiscoveryTarget,
  RadioPresetEntry,
  RadioPresetsStore,
  RadioRegionDiscoveryResponse,
  RadioStatsSnapshot,
} from '../../types';

function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatAirtime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-xs font-mono tabular-nums ${warn ? 'text-warning font-semibold' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function RadioDetailsCollapsible({ stats }: { stats: RadioStatsSnapshot }) {
  const t = useT();
  const age = stats.timestamp ? Math.max(0, Math.floor(Date.now() / 1000) - stats.timestamp) : null;
  const packets = {
    recv: stats.packets_recv,
    sent: stats.packets_sent,
    flood_tx: stats.flood_tx,
    direct_tx: stats.direct_tx,
    flood_rx: stats.flood_rx,
    direct_rx: stats.direct_rx,
  };

  return (
    <details className="group">
      <summary className="text-sm font-medium text-foreground cursor-pointer select-none flex items-center gap-1">
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
        {t('settings_radio_details_heading')}
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-input bg-muted/20 p-3">
        {age !== null && (
          <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
            {age < 5
              ? t('settings_radio_updated_just_now')
              : t('settings_radio_updated_seconds_ago', { age })}
          </p>
        )}

        {/* Core */}
        {stats.uptime_secs != null && (
          <StatRow
            label={t('settings_radio_stat_uptime')}
            value={formatUptime(stats.uptime_secs)}
          />
        )}
        {stats.battery_mv != null && stats.battery_mv > 0 && (
          <StatRow
            label={t('settings_radio_stat_battery')}
            value={`${(stats.battery_mv / 1000).toFixed(2)}V`}
          />
        )}
        {stats.queue_len != null && (
          <StatRow
            label={t('settings_radio_stat_tx_queue')}
            value={`${stats.queue_len} / 16`}
            warn={stats.queue_len >= 14}
          />
        )}
        {stats.errors != null && (
          <StatRow
            label={t('settings_radio_stat_errors')}
            value={String(stats.errors)}
            warn={stats.errors > 0}
          />
        )}

        {/* RF */}
        {stats.noise_floor != null && (
          <StatRow
            label={t('settings_radio_stat_noise_floor')}
            value={`${stats.noise_floor} dBm`}
          />
        )}
        {stats.last_rssi != null && (
          <StatRow label={t('settings_radio_stat_last_rssi')} value={`${stats.last_rssi} dBm`} />
        )}
        {stats.last_snr != null && (
          <StatRow label={t('settings_radio_stat_last_snr')} value={`${stats.last_snr} dB`} />
        )}

        {/* Airtime */}
        {(stats.tx_air_secs != null || stats.rx_air_secs != null) && (
          <>
            {stats.tx_air_secs != null && (
              <StatRow
                label={t('settings_radio_stat_tx_airtime')}
                value={formatAirtime(stats.tx_air_secs)}
              />
            )}
            {stats.rx_air_secs != null && (
              <StatRow
                label={t('settings_radio_stat_rx_airtime')}
                value={formatAirtime(stats.rx_air_secs)}
              />
            )}
          </>
        )}

        {/* Packets */}
        {packets.recv != null && (
          <StatRow label={t('settings_radio_stat_packets_received')} value={String(packets.recv)} />
        )}
        {packets.sent != null && (
          <StatRow label={t('settings_radio_stat_packets_sent')} value={String(packets.sent)} />
        )}
        {packets.flood_tx != null && (
          <StatRow label={t('settings_radio_stat_flood_tx')} value={String(packets.flood_tx)} />
        )}
        {packets.flood_rx != null && (
          <StatRow label={t('settings_radio_stat_flood_rx')} value={String(packets.flood_rx)} />
        )}
        {packets.direct_tx != null && (
          <StatRow label={t('settings_radio_stat_direct_tx')} value={String(packets.direct_tx)} />
        )}
        {packets.direct_rx != null && (
          <StatRow label={t('settings_radio_stat_direct_rx')} value={String(packets.direct_rx)} />
        )}
      </div>
    </details>
  );
}

export function SettingsRadioSection({
  config,
  health,
  appSettings,
  pageMode,
  onSave,
  onSaveAppSettings,
  onSetPrivateKey,
  onReboot,
  onDisconnect,
  onReconnect,
  onAdvertise,
  meshDiscovery,
  meshDiscoveryLoadingTarget,
  onDiscoverMesh,
  regionDiscovery,
  regionDiscoveryLoading,
  onDiscoverRegions,
  onClose,
  className,
}: {
  config: RadioConfig;
  health: HealthStatus | null;
  appSettings: AppSettings;
  pageMode: boolean;
  onSave: (update: RadioConfigUpdate) => Promise<void>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onSetPrivateKey: (key: string) => Promise<void>;
  onReboot: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onReconnect: () => Promise<void>;
  onAdvertise: (mode: RadioAdvertMode) => Promise<void>;
  meshDiscovery: RadioDiscoveryResponse | null;
  meshDiscoveryLoadingTarget: RadioDiscoveryTarget | null;
  onDiscoverMesh: (target: RadioDiscoveryTarget) => Promise<void>;
  regionDiscovery: RadioRegionDiscoveryResponse | null;
  regionDiscoveryLoading: boolean;
  onDiscoverRegions: (publicKeys?: string[]) => Promise<void>;
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  // Radio config state
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [txPower, setTxPower] = useState('');
  const [freq, setFreq] = useState('');
  const [bw, setBw] = useState('');
  const [sf, setSf] = useState('');
  const [cr, setCr] = useState('');
  const [pathHashMode, setPathHashMode] = useState('0');
  const [advertLocationSource, setAdvertLocationSource] = useState<'off' | 'current'>('current');
  const [multiAcksEnabled, setMultiAcksEnabled] = useState(false);
  const [telemetryModeBase, setTelemetryModeBase] = useState(0);
  const [telemetryModeLoc, setTelemetryModeLoc] = useState(0);
  const [telemetryModeEnv, setTelemetryModeEnv] = useState(0);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identity state
  const [privateKey, setPrivateKey] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityRebooting, setIdentityRebooting] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Flood & advert control state
  const [advertIntervalHours, setAdvertIntervalHours] = useState('0');
  const [floodScope, setFloodScope] = useState('');
  const [knownRegions, setKnownRegions] = useState('');
  const [maxRadioContacts, setMaxRadioContacts] = useState('');
  const [floodBusy, setFloodBusy] = useState(false);
  const [floodError, setFloodError] = useState<string | null>(null);
  const [regionSyncUrl, setRegionSyncUrl] = useState('');
  const [regionSyncing, setRegionSyncing] = useState(false);

  // Advertise state
  const [advertisingMode, setAdvertisingMode] = useState<RadioAdvertMode | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);

  useEffect(() => {
    setName(config.name);
    setLat(String(config.lat));
    setLon(String(config.lon));
    setTxPower(String(config.tx_power));
    setFreq(String(config.radio.freq));
    setBw(String(config.radio.bw));
    setSf(String(config.radio.sf));
    setCr(String(config.radio.cr));
    setPathHashMode(String(config.path_hash_mode));
    setAdvertLocationSource(config.advert_location_source ?? 'current');
    setMultiAcksEnabled(config.multi_acks_enabled ?? false);
    setTelemetryModeBase(config.telemetry_mode_base ?? 0);
    setTelemetryModeLoc(config.telemetry_mode_loc ?? 0);
    setTelemetryModeEnv(config.telemetry_mode_env ?? 0);
  }, [config]);

  useEffect(() => {
    setAdvertIntervalHours(String(Math.round(appSettings.advert_interval / 3600)));
    setFloodScope(stripRegionScopePrefix(appSettings.flood_scope));
    setKnownRegions((appSettings.known_regions ?? []).join('\n'));
    setMaxRadioContacts(String(appSettings.max_radio_contacts));
    setRegionSyncUrl(appSettings.region_sync_url ?? '');
  }, [appSettings]);

  // The preset dropdown is driven by this list: the built-in RADIO_PRESETS by
  // default, or the list last synced from the official MeshCore presets API.
  const [presetList, setPresetList] = useState<RadioPresetEntry[]>(RADIO_PRESETS);
  const [presetSyncedAt, setPresetSyncedAt] = useState<number | null>(null);
  const [presetInfo, setPresetInfo] = useState('');
  const [presetSyncing, setPresetSyncing] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  const applyPresetStore = (store: RadioPresetsStore) => {
    if (store.synced_at !== null && store.entries.length > 0) {
      setPresetList(store.entries);
      setPresetSyncedAt(store.synced_at);
      setPresetInfo(store.info_message);
    } else {
      // Never synced (or reset): fall back to the bundled built-in presets.
      setPresetList(RADIO_PRESETS);
      setPresetSyncedAt(null);
      setPresetInfo('');
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getRadioPresets()
      .then((store) => {
        if (!cancelled) applyPresetStore(store);
      })
      .catch(() => {
        // Keep the built-in list if the backend is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSyncPresets = async () => {
    setPresetSyncing(true);
    setPresetError(null);
    try {
      applyPresetStore(await api.syncRadioPresets());
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Could not sync presets');
    } finally {
      setPresetSyncing(false);
    }
  };

  const handleResetPresets = async () => {
    setPresetError(null);
    try {
      applyPresetStore(await api.resetRadioPresets());
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Could not reset presets');
    }
  };

  const currentPreset = useMemo(() => {
    const freqNum = parseFloat(freq);
    const bwNum = parseFloat(bw);
    const sfNum = parseInt(sf, 10);
    const crNum = parseInt(cr, 10);

    for (const preset of presetList) {
      if (
        preset.freq === freqNum &&
        preset.bw === bwNum &&
        preset.sf === sfNum &&
        preset.cr === crNum
      ) {
        return preset.name;
      }
    }
    return 'custom';
  }, [freq, bw, sf, cr, presetList]);

  const handlePresetChange = (presetName: string) => {
    if (presetName === 'custom') return;
    const preset = presetList.find((p) => p.name === presetName);
    if (preset) {
      setFreq(String(preset.freq));
      setBw(String(preset.bw));
      setSf(String(preset.sf));
      setCr(String(preset.cr));
    }
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      toast.error(t('settings_radio_toast_geo_not_supported_title'), {
        description: t('settings_radio_toast_geo_not_supported_desc'),
      });
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLon(position.coords.longitude.toFixed(6));
        setGettingLocation(false);
        toast.success(t('settings_radio_toast_location_updated'));
      },
      (err) => {
        setGettingLocation(false);
        toast.error(t('settings_radio_toast_failed_get_location'), {
          description: err.message,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const buildUpdate = (): RadioConfigUpdate | null => {
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    const parsedTxPower = parseInt(txPower, 10);
    const parsedFreq = parseFloat(freq);
    const parsedBw = parseFloat(bw);
    const parsedSf = parseInt(sf, 10);
    const parsedCr = parseInt(cr, 10);

    if (
      [parsedLat, parsedLon, parsedTxPower, parsedFreq, parsedBw, parsedSf, parsedCr].some((v) =>
        isNaN(v)
      )
    ) {
      setError(t('settings_radio_error_numeric_fields'));
      return null;
    }

    const parsedPathHashMode = parseInt(pathHashMode, 10);

    return {
      name,
      lat: parsedLat,
      lon: parsedLon,
      tx_power: parsedTxPower,
      ...(advertLocationSource !== (config.advert_location_source ?? 'current')
        ? { advert_location_source: advertLocationSource }
        : {}),
      ...(multiAcksEnabled !== (config.multi_acks_enabled ?? false)
        ? { multi_acks_enabled: multiAcksEnabled }
        : {}),
      ...(telemetryModeBase !== (config.telemetry_mode_base ?? 0)
        ? { telemetry_mode_base: telemetryModeBase }
        : {}),
      ...(telemetryModeLoc !== (config.telemetry_mode_loc ?? 0)
        ? { telemetry_mode_loc: telemetryModeLoc }
        : {}),
      ...(telemetryModeEnv !== (config.telemetry_mode_env ?? 0)
        ? { telemetry_mode_env: telemetryModeEnv }
        : {}),
      radio: {
        freq: parsedFreq,
        bw: parsedBw,
        sf: parsedSf,
        cr: parsedCr,
      },
      ...(config.path_hash_mode_supported &&
      !isNaN(parsedPathHashMode) &&
      parsedPathHashMode !== config.path_hash_mode
        ? { path_hash_mode: parsedPathHashMode }
        : {}),
    };
  };

  const handleSave = async () => {
    setError(null);
    const update = buildUpdate();
    if (!update) return;

    setBusy(true);
    try {
      await onSave(update);
      toast.success(t('settings_radio_toast_config_saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings_radio_failed_to_save'));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndReboot = async () => {
    setError(null);
    const update = buildUpdate();
    if (!update) return;

    setBusy(true);
    try {
      await onSave(update);
      toast.success(t('settings_radio_toast_config_saved_rebooting'));
      setRebooting(true);
      await onReboot();
      if (!pageMode) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings_radio_failed_to_save'));
    } finally {
      setRebooting(false);
      setBusy(false);
    }
  };

  const handleSetPrivateKey = async () => {
    if (!privateKey.trim()) {
      setIdentityError(t('settings_radio_private_key_required'));
      return;
    }
    setIdentityError(null);
    setIdentityBusy(true);

    try {
      await onSetPrivateKey(privateKey.trim());
      setPrivateKey('');
      toast.success(t('settings_radio_toast_private_key_set_rebooting'));
      setIdentityRebooting(true);
      await onReboot();
      if (!pageMode) {
        onClose();
      }
    } catch (err) {
      setIdentityError(
        err instanceof Error ? err.message : t('settings_radio_failed_set_private_key')
      );
    } finally {
      setIdentityRebooting(false);
      setIdentityBusy(false);
    }
  };

  const handleSaveFloodSettings = async () => {
    setFloodError(null);
    setFloodBusy(true);

    try {
      const update: AppSettingsUpdate = {};
      if (floodScope !== stripRegionScopePrefix(appSettings.flood_scope)) {
        update.flood_scope = floodScope;
      }
      // Known regions: one per line (commas also accepted), trimmed, blanks dropped.
      const parsedRegions = knownRegions
        .split(/[\n,]/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (JSON.stringify(parsedRegions) !== JSON.stringify(appSettings.known_regions ?? [])) {
        update.known_regions = parsedRegions;
      }
      const newMaxRadioContacts = parseInt(maxRadioContacts, 10);
      if (!isNaN(newMaxRadioContacts) && newMaxRadioContacts !== appSettings.max_radio_contacts) {
        update.max_radio_contacts = newMaxRadioContacts;
      }
      if (Object.keys(update).length > 0) {
        await onSaveAppSettings(update);
      }
      toast.success(t('settings_radio_toast_settings_saved'));
    } catch (err) {
      setFloodError(err instanceof Error ? err.message : t('settings_radio_failed_to_save'));
    } finally {
      setFloodBusy(false);
    }
  };

  const [advertIntervalBusy, setAdvertIntervalBusy] = useState(false);
  const [advertIntervalError, setAdvertIntervalError] = useState<string | null>(null);

  const handleSaveAdvertInterval = async () => {
    setAdvertIntervalError(null);
    setAdvertIntervalBusy(true);

    try {
      const hours = parseInt(advertIntervalHours, 10);
      const newAdvertInterval = isNaN(hours) ? 0 : hours * 3600;
      if (newAdvertInterval !== appSettings.advert_interval) {
        await onSaveAppSettings({ advert_interval: newAdvertInterval });
      }
      toast.success(t('settings_radio_toast_advert_interval_saved'));
    } catch (err) {
      setAdvertIntervalError(
        err instanceof Error ? err.message : t('settings_radio_failed_to_save')
      );
    } finally {
      setAdvertIntervalBusy(false);
    }
  };

  const handleAdvertise = async (mode: RadioAdvertMode) => {
    setAdvertisingMode(mode);
    try {
      await onAdvertise(mode);
    } finally {
      setAdvertisingMode(null);
    }
  };

  const handleDiscover = async (target: RadioDiscoveryTarget) => {
    setDiscoverError(null);
    try {
      await onDiscoverMesh(target);
    } catch (err) {
      setDiscoverError(
        err instanceof Error ? err.message : t('settings_radio_failed_mesh_discovery')
      );
    }
  };

  const handleDiscoverRegions = async () => {
    // Prefer repeaters from the most recent mesh-discovery sweep (they just
    // answered, so they're likely in range for the direct-routed regions
    // request); otherwise let the backend pick recent repeater contacts.
    const discoveredRepeaterKeys = (meshDiscovery?.results ?? [])
      .filter((r) => r.node_type === 'repeater')
      .map((r) => r.public_key);
    await onDiscoverRegions(discoveredRepeaterKeys);
  };

  const handleAddDiscoveredRegions = () => {
    if (!regionDiscovery || regionDiscovery.regions.length === 0) return;
    const existing = knownRegions
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set(existing.map((s) => s.toLowerCase()));
    const additions = regionDiscovery.regions.filter((r) => !seen.has(r.toLowerCase()));
    if (additions.length === 0) {
      toast.info(t('settings_radio_toast_regions_already_listed'));
      return;
    }
    setKnownRegions([...existing, ...additions].join('\n'));
    toast.success(t('settings_radio_toast_regions_added', { count: additions.length }));
  };

  const [dutchSeeding, setDutchSeeding] = useState(false);

  // One-click offline seed: merge the bundled Dutch flood-scope names into
  // known_regions, persist immediately (so ingest resolves new packets), then
  // backfill stored messages so their region pills fill in too. Verified: this
  // network's transport codes resolve to the national "nl" scope.
  const handleSeedDutchScopes = async () => {
    setDutchSeeding(true);
    try {
      const existing = knownRegions
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set(existing.map((s) => s.toLowerCase()));
      const additions = allDutchScopes().filter((s) => !seen.has(s.toLowerCase()));
      const merged = [...existing, ...additions];
      setKnownRegions(merged.join('\n'));
      await onSaveAppSettings({ known_regions: merged });
      const result = await api.backfillRegions();
      toast.success(
        t('settings_radio_toast_dutch_scopes_seeded', {
          added: additions.length,
          named: result.named,
        })
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings_radio_toast_dutch_scopes_failed')
      );
    } finally {
      setDutchSeeding(false);
    }
  };

  const handleSaveRegionSyncUrl = async () => {
    const trimmed = regionSyncUrl.trim();
    setRegionSyncUrl(trimmed);
    if (trimmed === (appSettings.region_sync_url ?? '')) return;
    try {
      await onSaveAppSettings({ region_sync_url: trimmed });
    } catch (err) {
      setRegionSyncUrl(appSettings.region_sync_url ?? '');
      toast.error(
        err instanceof Error ? err.message : t('settings_radio_toast_region_sync_url_save_failed')
      );
    }
  };

  const handleSyncRegions = async () => {
    if (!regionSyncUrl.trim()) {
      toast.error(t('settings_radio_toast_region_sync_no_url'));
      return;
    }
    setRegionSyncing(true);
    try {
      const { regions } = await api.syncRegions();
      if (regions.length === 0) {
        toast.info(t('settings_radio_toast_region_sync_empty'));
        return;
      }
      // Additive merge into the textarea (mirrors handleAddDiscoveredRegions);
      // the user reviews and persists via Save Messaging Settings.
      const existing = knownRegions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set(existing.map((s) => s.toLowerCase()));
      const additions = regions.filter((r) => !seen.has(r.toLowerCase()));
      if (additions.length === 0) {
        toast.info(t('settings_radio_toast_regions_already_listed'));
        return;
      }
      setKnownRegions([...existing, ...additions].join('\n'));
      toast.success(t('settings_radio_toast_regions_added', { count: additions.length }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings_radio_toast_region_sync_failed')
      );
    } finally {
      setRegionSyncing(false);
    }
  };

  const importInputRef = useRef<HTMLInputElement>(null);
  const [keyImportDialogOpen, setKeyImportDialogOpen] = useState(false);
  const pendingImportRef = useRef<Record<string, unknown> | null>(null);

  const buildConfigProfile = () => ({
    version: 1,
    exported_at: new Date().toISOString(),
    name: config.name,
    lat: config.lat,
    lon: config.lon,
    tx_power: config.tx_power,
    radio: { ...config.radio },
    path_hash_mode: config.path_hash_mode,
    advert_location_source: config.advert_location_source ?? 'current',
    multi_acks_enabled: config.multi_acks_enabled ?? false,
    telemetry_mode_base: config.telemetry_mode_base ?? 0,
    telemetry_mode_loc: config.telemetry_mode_loc ?? 0,
    telemetry_mode_env: config.telemetry_mode_env ?? 0,
  });

  const downloadJson = (profile: object, suffix: string) => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (config.name || 'radio').replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date()
      .toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replace(/[/:, ]+/g, '-');
    a.download = `${safeName}-${suffix}-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportConfig = async () => {
    const profile = buildConfigProfile();
    try {
      const { private_key } = await api.getPrivateKey();
      downloadJson({ ...profile, private_key }, 'config');
      toast.success(t('settings_radio_toast_export_with_key'));
    } catch {
      downloadJson(profile, 'config');
      toast.info(t('settings_radio_toast_export_without_key'), {
        description: t('settings_radio_toast_export_without_key_desc'),
      });
    }
  };

  const validateImportData = (
    data: unknown
  ): data is {
    name: string;
    radio: { freq: number; bw: number; sf: number; cr: number };
    [k: string]: unknown;
  } =>
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    typeof (data as Record<string, unknown>).name === 'string' &&
    'radio' in data &&
    typeof (data as Record<string, unknown>).radio === 'object' &&
    (data as Record<string, unknown>).radio !== null &&
    typeof (data as Record<string, Record<string, unknown>>).radio.freq === 'number' &&
    typeof (data as Record<string, Record<string, unknown>>).radio.bw === 'number' &&
    typeof (data as Record<string, Record<string, unknown>>).radio.sf === 'number' &&
    typeof (data as Record<string, Record<string, unknown>>).radio.cr === 'number';

  const populateFormFromImport = (data: Record<string, unknown>) => {
    const radio = data.radio as { freq: number; bw: number; sf: number; cr: number };
    setName(data.name as string);
    if (typeof data.lat === 'number') setLat(String(data.lat));
    if (typeof data.lon === 'number') setLon(String(data.lon));
    if (typeof data.tx_power === 'number') setTxPower(String(data.tx_power));
    setFreq(String(radio.freq));
    setBw(String(radio.bw));
    setSf(String(radio.sf));
    setCr(String(radio.cr));
    if (typeof data.path_hash_mode === 'number') setPathHashMode(String(data.path_hash_mode));
    if (data.advert_location_source === 'off' || data.advert_location_source === 'current')
      setAdvertLocationSource(data.advert_location_source);
    if (typeof data.multi_acks_enabled === 'boolean') setMultiAcksEnabled(data.multi_acks_enabled);
    if (typeof data.telemetry_mode_base === 'number')
      setTelemetryModeBase(data.telemetry_mode_base);
    if (typeof data.telemetry_mode_loc === 'number') setTelemetryModeLoc(data.telemetry_mode_loc);
    if (typeof data.telemetry_mode_env === 'number') setTelemetryModeEnv(data.telemetry_mode_env);
  };

  const buildUpdateFromImport = (data: Record<string, unknown>): RadioConfigUpdate => {
    const radio = data.radio as { freq: number; bw: number; sf: number; cr: number };
    const update: RadioConfigUpdate = {
      name: data.name as string,
      lat: typeof data.lat === 'number' ? data.lat : config.lat,
      lon: typeof data.lon === 'number' ? data.lon : config.lon,
      tx_power: typeof data.tx_power === 'number' ? (data.tx_power as number) : config.tx_power,
      radio,
    };
    if (data.advert_location_source === 'off' || data.advert_location_source === 'current')
      update.advert_location_source = data.advert_location_source;
    if (typeof data.multi_acks_enabled === 'boolean')
      update.multi_acks_enabled = data.multi_acks_enabled;
    if (typeof data.telemetry_mode_base === 'number')
      update.telemetry_mode_base = data.telemetry_mode_base as number;
    if (typeof data.telemetry_mode_loc === 'number')
      update.telemetry_mode_loc = data.telemetry_mode_loc as number;
    if (typeof data.telemetry_mode_env === 'number')
      update.telemetry_mode_env = data.telemetry_mode_env as number;
    if (config.path_hash_mode_supported && typeof data.path_hash_mode === 'number')
      update.path_hash_mode = data.path_hash_mode as number;
    return update;
  };

  const applyImport = async (data: Record<string, unknown>) => {
    populateFormFromImport(data);
    const update = buildUpdateFromImport(data);

    setBusy(true);
    setRebooting(true);
    try {
      if (typeof data.private_key === 'string' && data.private_key) {
        await onSetPrivateKey(data.private_key);
        toast.success(t('settings_radio_toast_import_with_key'));
      } else {
        toast.success(t('settings_radio_toast_import_config'));
      }
      await onSave(update);
      await onReboot();
      if (!pageMode) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings_radio_failed_import_config'));
    } finally {
      setRebooting(false);
      setBusy(false);
    }
  };

  const handleImportConfig = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!validateImportData(data)) {
        toast.error(t('settings_radio_toast_invalid_config_title'), {
          description: t('settings_radio_toast_invalid_config_desc'),
        });
        return;
      }

      if (typeof data.private_key === 'string' && data.private_key) {
        // Private key present — show warning dialog before applying
        pendingImportRef.current = data;
        setKeyImportDialogOpen(true);
      } else {
        await applyImport(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings_radio_failed_import_config'));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleConfirmKeyImport = async () => {
    setKeyImportDialogOpen(false);
    const data = pendingImportRef.current;
    pendingImportRef.current = null;
    if (data) await applyImport(data);
  };

  const radioState =
    health?.radio_state ?? (health?.radio_initializing ? 'initializing' : 'disconnected');
  const connectionActionLabel =
    radioState === 'paused'
      ? t('common_reconnect')
      : radioState === 'connected' || radioState === 'initializing'
        ? t('settings_radio_disconnect')
        : t('settings_radio_stop_trying');

  const connectionStatusLabel =
    radioState === 'connected'
      ? health?.connection_info || t('settings_radio_status_connected')
      : radioState === 'initializing'
        ? t('settings_radio_status_initializing', {
            info: health?.connection_info || t('settings_radio_status_radio_fallback'),
          })
        : radioState === 'connecting'
          ? health?.connection_info
            ? t('settings_radio_status_connecting_to', { info: health.connection_info })
            : t('settings_radio_status_connecting')
          : radioState === 'paused'
            ? health?.connection_info
              ? t('settings_radio_status_paused_with_info', { info: health.connection_info })
              : t('settings_radio_status_paused')
            : t('settings_radio_status_not_connected');

  const deviceInfoLabel = useMemo(() => {
    const info = health?.radio_device_info;
    if (!info) {
      return null;
    }

    const model = info.model?.trim() || null;
    const firmwareParts = [info.firmware_build?.trim(), info.firmware_version?.trim()].filter(
      (value): value is string => Boolean(value)
    );
    const capacityParts = [
      typeof info.max_contacts === 'number'
        ? t('settings_radio_contacts_suffix', { n: info.max_contacts })
        : null,
      typeof info.max_channels === 'number'
        ? t('settings_radio_channels_suffix', { n: info.max_channels })
        : null,
    ].filter((value): value is string => value !== null);

    if (!model && firmwareParts.length === 0 && capacityParts.length === 0) {
      return null;
    }

    let label = model ?? t('settings_radio_device_label_fallback');
    if (firmwareParts.length > 0) {
      label = t('settings_radio_device_running', { label, firmware: firmwareParts.join('/') });
    }
    if (capacityParts.length > 0) {
      label = t('settings_radio_device_capacity_suffix', {
        label,
        capacity: capacityParts.join(', '),
      });
    }
    return label;
  }, [health?.radio_device_info, t]);

  const handleConnectionAction = async () => {
    setConnectionBusy(true);
    try {
      if (radioState === 'paused') {
        await onReconnect();
        toast.success(t('settings_radio_toast_reconnect_requested'));
      } else {
        await onDisconnect();
        toast.success(t('settings_radio_toast_connection_paused'));
      }
    } catch (err) {
      toast.error(t('settings_radio_toast_connection_change_failed'), {
        description:
          err instanceof Error ? err.message : t('settings_radio_toast_check_connection_retry'),
      });
    } finally {
      setConnectionBusy(false);
    }
  };

  return (
    <div className={className}>
      {/* ── Connection ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_connection_heading')}
        </h3>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              radioState === 'connected'
                ? 'bg-status-connected'
                : radioState === 'initializing' || radioState === 'connecting'
                  ? 'bg-warning'
                  : 'bg-status-disconnected'
            }`}
          />
          <span
            className={
              radioState === 'paused' || radioState === 'disconnected'
                ? 'text-muted-foreground'
                : ''
            }
          >
            {connectionStatusLabel}
          </span>
        </div>
        {deviceInfoLabel && <p className="text-sm text-muted-foreground">{deviceInfoLabel}</p>}

        {health?.radio_stats && <RadioDetailsCollapsible stats={health.radio_stats} />}

        <Button
          type="button"
          variant="outline"
          onClick={handleConnectionAction}
          disabled={connectionBusy}
          className="w-full"
        >
          {connectionBusy ? `${connectionActionLabel}...` : connectionActionLabel}
        </Button>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radio_disconnect_note')}
        </p>
      </div>

      <Separator />

      {/* ── Identity ── */}
      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_identity_heading')}
        </h3>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">{t('settings_radio_name_label')}</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="public-key">{t('common_public_key')}</Label>
        <Input id="public-key" value={config.public_key} disabled className="font-mono text-xs" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="private-key">{t('settings_radio_private_key_label')}</Label>
        <Input
          id="private-key"
          type="password"
          autoComplete="off"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder={t('settings_radio_private_key_placeholder')}
        />
        <Button
          onClick={handleSetPrivateKey}
          disabled={identityBusy || identityRebooting || !privateKey.trim()}
          className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
          variant="outline"
        >
          {identityBusy || identityRebooting
            ? t('settings_radio_setting_rebooting')
            : t('settings_radio_set_private_key_reboot')}
        </Button>
      </div>

      {identityError && (
        <div className="text-sm text-destructive" role="alert">
          {identityError}
        </div>
      )}

      <Separator />

      {/* ── Radio Parameters ── */}
      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_parameters_heading')}
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="preset">{t('settings_radio_preset_label')}</Label>
          <div className="flex items-center gap-2">
            {presetSyncedAt !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetPresets}
                disabled={presetSyncing}
              >
                {t('settings_radio_preset_reset_builtin')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncPresets}
              disabled={presetSyncing}
            >
              {presetSyncing ? t('settings_radio_preset_syncing') : t('settings_radio_preset_sync')}
            </Button>
          </div>
        </div>
        <select
          id="preset"
          value={currentPreset}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="custom">{t('settings_radio_preset_custom')}</option>
          {presetList.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
        {presetError && (
          <p className="text-sm text-destructive" role="alert">
            {presetError}
          </p>
        )}
        {presetSyncedAt !== null && (
          <p className="text-xs text-muted-foreground">
            {presetInfo ? `${presetInfo} ` : ''}
            {t('settings_radio_presets_synced_count', {
              count: presetList.length,
              date: new Date(presetSyncedAt * 1000).toLocaleString(),
            })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="freq">{t('settings_radio_frequency_label')}</Label>
          <Input
            id="freq"
            type="number"
            step="any"
            value={freq}
            onChange={(e) => setFreq(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bw">{t('settings_radio_bandwidth_label')}</Label>
          <Input
            id="bw"
            type="number"
            step="any"
            value={bw}
            onChange={(e) => setBw(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sf">{t('settings_radio_spreading_factor_label')}</Label>
          <Input
            id="sf"
            type="number"
            min="7"
            max="12"
            value={sf}
            onChange={(e) => setSf(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cr">{t('settings_radio_coding_rate_label')}</Label>
          <Input
            id="cr"
            type="number"
            min="5"
            max="8"
            value={cr}
            onChange={(e) => setCr(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="tx-power">{t('settings_radio_tx_power_label')}</Label>
          <Input
            id="tx-power"
            type="number"
            value={txPower}
            onChange={(e) => setTxPower(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max-tx">{t('settings_radio_max_tx_power_label')}</Label>
          <Input id="max-tx" type="number" value={config.max_tx_power} disabled />
        </div>
      </div>

      {config.path_hash_mode_supported && (
        <div className="space-y-2">
          <Label htmlFor="path-hash-mode">{t('settings_radio_path_hash_mode_label')}</Label>
          <select
            id="path-hash-mode"
            value={pathHashMode}
            onChange={(e) => setPathHashMode(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="0">{t('settings_radio_path_hash_1byte')}</option>
            <option value="1">{t('settings_radio_path_hash_2byte')}</option>
            <option value="2">{t('settings_radio_path_hash_3byte')}</option>
          </select>
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
            <p className="font-semibold mb-1">{t('settings_radio_compat_warning_heading')}</p>
            <p>{t('settings_radio_compat_warning_desc')}</p>
          </div>
        </div>
      )}

      <Separator />

      {/* ── Location ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_radio_location_heading')}
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetLocation}
            disabled={gettingLocation}
          >
            {gettingLocation ? (
              t('settings_radio_getting_location')
            ) : (
              <>
                <MapPinned className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('settings_radio_use_my_location')}
              </>
            )}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lat" className="text-xs text-muted-foreground">
              {t('settings_radio_latitude_label')}
            </Label>
            <Input
              id="lat"
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lon" className="text-xs text-muted-foreground">
              {t('settings_radio_longitude_label')}
            </Label>
            <Input
              id="lon"
              type="number"
              step="any"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="advert-location-source">
            {t('settings_radio_advert_location_source_label')}
          </Label>
          <select
            id="advert-location-source"
            value={advertLocationSource}
            onChange={(e) => setAdvertLocationSource(e.target.value as 'off' | 'current')}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="off">{t('settings_radio_location_off')}</option>
            <option value="current">{t('settings_radio_location_include')}</option>
          </select>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_advert_location_desc')}
          </p>
        </div>
      </div>

      <Separator />

      {/* ── Telemetry Sharing ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_telemetry_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radio_telemetry_desc', {
            deny: t('settings_radio_telemetry_deny'),
            perContact: t('settings_radio_telemetry_per_contact'),
            allowAll: t('settings_radio_telemetry_allow_all'),
          })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="telemetry-mode-base" className="text-sm">
              {t('settings_radio_telemetry_base_label')}
            </Label>
            <select
              id="telemetry-mode-base"
              value={telemetryModeBase}
              onChange={(e) => setTelemetryModeBase(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value={0}>{t('settings_radio_telemetry_deny')}</option>
              <option value={1}>{t('settings_radio_telemetry_per_contact')}</option>
              <option value={2}>{t('settings_radio_telemetry_allow_all')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telemetry-mode-loc" className="text-sm">
              {t('settings_radio_telemetry_location_label')}
            </Label>
            <select
              id="telemetry-mode-loc"
              value={telemetryModeLoc}
              onChange={(e) => setTelemetryModeLoc(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value={0}>{t('settings_radio_telemetry_deny')}</option>
              <option value={1}>{t('settings_radio_telemetry_per_contact')}</option>
              <option value={2}>{t('settings_radio_telemetry_allow_all')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="telemetry-mode-env" className="text-sm">
              {t('settings_radio_telemetry_env_label')}
            </Label>
            <select
              id="telemetry-mode-env"
              value={telemetryModeEnv}
              onChange={(e) => setTelemetryModeEnv(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value={0}>{t('settings_radio_telemetry_deny')}</option>
              <option value={1}>{t('settings_radio_telemetry_per_contact')}</option>
              <option value={2}>{t('settings_radio_telemetry_allow_all')}</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={busy || rebooting}
          variant="outline"
          className="flex-1"
        >
          {busy && !rebooting ? t('settings_radio_saving') : t('settings_radio_save_config_button')}
        </Button>
        <Button onClick={handleSaveAndReboot} disabled={busy || rebooting} className="flex-1">
          {rebooting
            ? t('settings_radio_rebooting')
            : t('settings_radio_save_config_reboot_button')}
        </Button>
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_radio_reboot_note')}</p>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExportConfig} className="flex-1">
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('settings_radio_export_config_button')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => importInputRef.current?.click()}
          disabled={busy || rebooting}
          className="flex-1"
        >
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('settings_radio_import_reboot_button')}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportConfig(file);
          }}
        />
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_radio_export_import_note')}
      </p>

      <Separator />

      {/* ── Messaging ── */}
      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_messaging_heading')}
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
          <Checkbox
            id="multi-acks-enabled"
            checked={multiAcksEnabled}
            onCheckedChange={(checked) => setMultiAcksEnabled(checked === true)}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="multi-acks-enabled">{t('settings_radio_extra_ack_label')}</Label>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_radio_extra_ack_desc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
          <Checkbox
            id="auto-resend-channel"
            checked={appSettings.auto_resend_channel}
            onCheckedChange={(checked) =>
              onSaveAppSettings({ auto_resend_channel: checked === true })
            }
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="auto-resend-channel">{t('settings_radio_auto_resend_label')}</Label>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_radio_auto_resend_desc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
          <Checkbox
            id="show-mention-ticker"
            checked={appSettings.show_mention_ticker}
            onCheckedChange={(checked) =>
              onSaveAppSettings({ show_mention_ticker: checked === true })
            }
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="show-mention-ticker">
              {t('settings_radio_show_mention_ticker_label')}
            </Label>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_radio_show_mention_ticker_desc')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="flood-scope">{t('settings_radio_flood_scope_label')}</Label>
        <Input
          id="flood-scope"
          value={floodScope}
          onChange={(e) => setFloodScope(e.target.value)}
          placeholder={t('settings_radio_flood_scope_placeholder')}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radio_flood_scope_desc')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="known-regions">{t('settings_radio_known_regions_label')}</Label>
        <textarea
          id="known-regions"
          value={knownRegions}
          onChange={(e) => setKnownRegions(e.target.value)}
          rows={4}
          placeholder={t('settings_radio_known_regions_placeholder')}
          spellCheck={false}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radio_known_regions_desc')}
        </p>

        <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
              {t('settings_radio_discover_regions_label')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscoverRegions}
              disabled={regionDiscoveryLoading || !health?.radio_connected}
            >
              {regionDiscoveryLoading
                ? t('settings_radio_asking_repeaters')
                : t('settings_radio_discover_regions_button')}
            </Button>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_discover_regions_desc')}
          </p>
          {!health?.radio_connected && (
            <p className="text-sm text-destructive">{t('settings_radio_not_connected')}</p>
          )}
          {regionDiscovery && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t('settings_radio_repeaters_answered', {
                  count: regionDiscovery.repeaters_queried,
                  answered: regionDiscovery.repeaters_answered,
                  queried: regionDiscovery.repeaters_queried,
                })}
                {regionDiscovery.regions.length > 0
                  ? t('settings_radio_regions_found_suffix', {
                      count: regionDiscovery.regions.length,
                    })
                  : ''}
              </p>
              {regionDiscovery.regions.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {regionDiscovery.regions.map((region) => (
                      <span
                        key={region}
                        className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 font-mono"
                      >
                        {region}
                      </span>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddDiscoveredRegions}
                    className="border-success/50 text-success hover:bg-success/10"
                  >
                    {t('settings_radio_add_known_regions_button')}
                  </Button>
                </>
              ) : (
                regionDiscovery.repeaters_queried > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('settings_radio_no_regions_reported')}
                  </p>
                )
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
              {t('settings_radio_region_sync_label')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncRegions}
              disabled={regionSyncing || !regionSyncUrl.trim()}
            >
              {regionSyncing
                ? t('settings_radio_region_sync_button_loading')
                : t('settings_radio_region_sync_button')}
            </Button>
          </div>
          <Input
            id="region-sync-url"
            type="url"
            value={regionSyncUrl}
            placeholder="https://meshcore-analyzer.eu/api/regions/scopes"
            onChange={(e) => setRegionSyncUrl(e.target.value)}
            onBlur={handleSaveRegionSyncUrl}
            className="font-mono text-xs"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_region_sync_desc_prefix')}{' '}
            <code className="text-xs">{'{code, name}'}</code>{' '}
            {t('settings_radio_region_sync_desc_suffix')}
          </p>
        </div>

        <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
              {t('settings_radio_dutch_scopes_label')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSeedDutchScopes}
              disabled={dutchSeeding}
            >
              {dutchSeeding
                ? t('settings_radio_dutch_scopes_button_loading')
                : t('settings_radio_dutch_scopes_button')}
            </Button>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_dutch_scopes_desc')}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="max-contacts">{t('settings_radio_max_contacts_label')}</Label>
        <Input
          id="max-contacts"
          type="number"
          min="1"
          max="1000"
          value={maxRadioContacts}
          onChange={(e) => setMaxRadioContacts(e.target.value)}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radio_max_contacts_desc')}
        </p>
        {health?.radio_device_info?.max_contacts != null &&
          Number(maxRadioContacts) > health.radio_device_info.max_contacts && (
            <p className="text-xs text-warning">
              {t('settings_radio_max_contacts_warning', {
                n: health.radio_device_info.max_contacts,
              })}
            </p>
          )}
      </div>

      {floodError && (
        <div className="text-sm text-destructive" role="alert">
          {floodError}
        </div>
      )}

      <Button onClick={handleSaveFloodSettings} disabled={floodBusy} className="w-full">
        {floodBusy ? t('settings_radio_saving') : t('settings_radio_save_messaging_button')}
      </Button>

      <Separator />

      {/* ── Advertising & Discovery ── */}
      <div className="space-y-5">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radio_advertising_heading')}
        </h3>

        <div className="space-y-2">
          <Label htmlFor="advert-interval">{t('settings_radio_advert_interval_label')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="advert-interval"
              type="number"
              min="0"
              value={advertIntervalHours}
              onChange={(e) => setAdvertIntervalHours(e.target.value)}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">
              {t('settings_radio_hours_off_suffix')}
            </span>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_advert_interval_desc')}
          </p>
          {advertIntervalError && (
            <div className="text-sm text-destructive" role="alert">
              {advertIntervalError}
            </div>
          )}
          <Button
            onClick={handleSaveAdvertInterval}
            disabled={advertIntervalBusy}
            className="w-full"
          >
            {advertIntervalBusy
              ? t('settings_radio_saving')
              : t('settings_radio_save_advert_interval_button')}
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('settings_radio_send_advert_heading')}</h4>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_send_advert_desc')}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              onClick={() => handleAdvertise('flood')}
              disabled={advertisingMode !== null || !health?.radio_connected}
              className="w-full bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              {advertisingMode === 'flood'
                ? t('common_sending')
                : t('settings_radio_send_flood_button')}
            </Button>
            <Button
              onClick={() => handleAdvertise('zero_hop')}
              disabled={advertisingMode !== null || !health?.radio_connected}
              className="w-full"
            >
              {advertisingMode === 'zero_hop'
                ? t('common_sending')
                : t('settings_radio_send_zerohop_button')}
            </Button>
          </div>
          {!health?.radio_connected && (
            <p className="text-sm text-destructive">{t('settings_radio_not_connected')}</p>
          )}
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t('settings_radio_mesh_discovery_heading')}</h4>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radio_mesh_discovery_desc')}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { target: 'repeaters', label: t('settings_radio_discover_repeaters_button') },
              { target: 'sensors', label: t('settings_radio_discover_sensors_button') },
              { target: 'all', label: t('settings_radio_discover_both_button') },
            ].map(({ target, label }) => (
              <Button
                key={target}
                type="button"
                variant="outline"
                onClick={() => handleDiscover(target as RadioDiscoveryTarget)}
                disabled={meshDiscoveryLoadingTarget !== null || !health?.radio_connected}
                className="w-full"
              >
                {meshDiscoveryLoadingTarget === target ? t('settings_radio_listening') : label}
              </Button>
            ))}
          </div>
          {!health?.radio_connected && (
            <p className="text-sm text-destructive">{t('settings_radio_not_connected')}</p>
          )}
          {discoverError && (
            <p className="text-sm text-destructive" role="alert">
              {discoverError}
            </p>
          )}
          {meshDiscovery && (
            <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium">
                  {t('settings_radio_last_sweep', { count: meshDiscovery.results.length })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings_radio_listen_window', {
                    duration: meshDiscovery.duration_seconds.toFixed(0),
                  })}
                </p>
              </div>
              {meshDiscovery.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('settings_radio_no_nodes_responded')}
                </p>
              ) : (
                <div className="space-y-2">
                  {meshDiscovery.results.map((result) => (
                    <div
                      key={result.public_key}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">
                          {result.name ?? <span className="capitalize">{result.node_type}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t('settings_radio_heard_count', { count: result.heard_count })}
                        </span>
                      </div>
                      {result.name && (
                        <p className="text-xs capitalize text-muted-foreground">
                          {result.node_type}
                        </p>
                      )}
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {result.public_key}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('settings_radio_heard_here', {
                          localSnr: result.local_snr ?? t('settings_radio_na'),
                          localRssi: result.local_rssi ?? t('settings_radio_na'),
                          remoteSnr: result.remote_snr ?? t('settings_radio_na'),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <MeshcomodSettings health={health} />
      </div>

      {/* ── Private Key Import Warning ── */}
      <Dialog
        open={keyImportDialogOpen}
        onOpenChange={(open) => {
          setKeyImportDialogOpen(open);
          if (!open) pendingImportRef.current = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings_radio_import_key_dialog_title')}</DialogTitle>
            <DialogDescription>{t('settings_radio_import_key_dialog_desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setKeyImportDialogOpen(false);
                pendingImportRef.current = null;
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button
              onClick={handleConfirmKeyImport}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              variant="outline"
            >
              {t('settings_radio_import_key_confirm_button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
