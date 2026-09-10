import { useState, useEffect, useRef } from 'react';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { lppDisplayUnit } from '../repeater/repeaterPaneShared';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { BulkDeleteContactsModal } from './BulkDeleteContactsModal';
import type {
  AppSettings,
  AppSettingsUpdate,
  Contact,
  TelemetryHistoryEntry,
  TelemetrySchedule,
} from '../../types';

export function SettingsRadioAppSection({
  appSettings,
  onSaveAppSettings,
  blockedKeys = [],
  blockedNames = [],
  onToggleBlockedKey,
  onToggleBlockedName,
  contacts = [],
  onBulkDeleteContacts,
  trackedTelemetryRepeaters = [],
  onToggleTrackedTelemetry,
  trackedTelemetryContacts = [],
  onToggleTrackedTelemetryContact,
  className,
}: {
  appSettings: AppSettings;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  blockedKeys?: string[];
  blockedNames?: string[];
  onToggleBlockedKey?: (key: string) => void;
  onToggleBlockedName?: (name: string) => void;
  contacts?: Contact[];
  onBulkDeleteContacts?: (deletedKeys: string[]) => void;
  trackedTelemetryRepeaters?: string[];
  onToggleTrackedTelemetry?: (publicKey: string) => Promise<void>;
  trackedTelemetryContacts?: string[];
  onToggleTrackedTelemetryContact?: (publicKey: string) => Promise<void>;
  className?: string;
}) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const [discoveryBlockedTypes, setDiscoveryBlockedTypes] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [latestTelemetry, setLatestTelemetry] = useState<
    Record<string, TelemetryHistoryEntry | null>
  >({});
  const telemetryFetchedRef = useRef(false);

  const [latestContactTelemetry, setLatestContactTelemetry] = useState<
    Record<string, TelemetryHistoryEntry | null>
  >({});
  const contactTelemetryFetchedRef = useRef(false);

  const [schedule, setSchedule] = useState<TelemetrySchedule | null>(null);
  const [intervalDraft, setIntervalDraft] = useState<number>(appSettings.telemetry_interval_hours);

  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setDiscoveryBlockedTypes(appSettings.discovery_blocked_types ?? []);
    setIntervalDraft(appSettings.telemetry_interval_hours);
  }, [appSettings]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTelemetrySchedule()
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    trackedTelemetryRepeaters.length,
    trackedTelemetryContacts.length,
    appSettings.telemetry_interval_hours,
    appSettings.telemetry_routed_hourly,
  ]);

  useEffect(() => {
    if (trackedTelemetryRepeaters.length === 0 || telemetryFetchedRef.current) return;
    telemetryFetchedRef.current = true;
    let cancelled = false;
    const fetches = trackedTelemetryRepeaters.map((key) =>
      api.repeaterTelemetryHistory(key).then(
        (history) => [key, history.length > 0 ? history[history.length - 1] : null] as const,
        () => [key, null] as const
      )
    );
    Promise.all(fetches).then((entries) => {
      if (cancelled) return;
      setLatestTelemetry(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [trackedTelemetryRepeaters]);

  useEffect(() => {
    if (trackedTelemetryContacts.length === 0 || contactTelemetryFetchedRef.current) return;
    contactTelemetryFetchedRef.current = true;
    let cancelled = false;
    const fetches = trackedTelemetryContacts.map((key) =>
      api.contactTelemetryHistory(key).then(
        (history) => [key, history.length > 0 ? history[history.length - 1] : null] as const,
        () => [key, null] as const
      )
    );
    Promise.all(fetches).then((entries) => {
      if (cancelled) return;
      setLatestContactTelemetry(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [trackedTelemetryContacts]);

  const persistAppSettings = (update: AppSettingsUpdate, revert: () => void): Promise<void> => {
    const chained = saveChainRef.current.then(async () => {
      try {
        await onSaveAppSettings(update);
      } catch (err) {
        console.error('Failed to save radio-app settings:', err);
        revert();
        toast.error(t('settings_radioapp_toast_save_failed'), {
          description: err instanceof Error ? err.message : t('error_unknown'),
        });
      }
    });
    saveChainRef.current = chained;
    return chained;
  };

  return (
    <div className={className}>
      {/* ── Tracked Repeater Telemetry ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radioapp_tracked_repeater_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radioapp_tracked_repeater_desc', {
            max: schedule?.max_tracked ?? 8,
            tracked: trackedTelemetryRepeaters.length,
          })}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="telemetry-interval" className="text-sm">
            {t('settings_radioapp_collection_interval_label')}
          </Label>
          <div className="flex items-center gap-2">
            <select
              id="telemetry-interval"
              value={intervalDraft}
              onChange={(e) => {
                const nextValue = Number(e.target.value);
                if (!Number.isFinite(nextValue) || nextValue === intervalDraft) return;
                const prevValue = intervalDraft;
                setIntervalDraft(nextValue);
                void persistAppSettings({ telemetry_interval_hours: nextValue }, () =>
                  setIntervalDraft(prevValue)
                );
              }}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {(schedule?.options ?? [1, 2, 3, 4, 6, 8, 12, 24]).map((hrs) => (
                <option key={hrs} value={hrs}>
                  {t('settings_radioapp_every_hours', { count: hrs, hrs })}{' '}
                  {t('settings_radioapp_checks_per_day', {
                    count: Math.floor(24 / hrs),
                    checks: Math.floor(24 / hrs),
                  })}
                </option>
              ))}
            </select>
          </div>
          {schedule && schedule.effective_hours !== schedule.preferred_hours && (
            <p className="text-xs text-warning">
              {t('settings_radioapp_pref_hours', {
                count: schedule.preferred_hours,
                effective: schedule.effective_hours,
              })}{' '}
              {t('settings_radioapp_repeaters_tracked', { count: schedule.tracked_count })}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={appSettings.telemetry_routed_hourly}
            onChange={() => {
              const next = !appSettings.telemetry_routed_hourly;
              void persistAppSettings({ telemetry_routed_hourly: next }, () => {});
            }}
            className="w-4 h-4 rounded border-input accent-primary mt-0.5"
          />
          <div>
            <span className="text-sm">{t('settings_radioapp_poll_routed_label')}</span>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_radioapp_poll_routed_desc')}
            </p>
          </div>
        </label>

        {schedule?.next_run_at != null && (
          <p className="text-xs text-muted-foreground">
            {schedule.routed_hourly
              ? t('settings_radioapp_next_flood_run_at')
              : t('settings_radioapp_next_run_at')}{' '}
            {formatTime(schedule.next_run_at)} {t('settings_radioapp_utc_top_of_hour_suffix')}
          </p>
        )}
        {schedule?.next_routed_run_at != null && (
          <p className="text-xs text-muted-foreground">
            {t('settings_radioapp_next_routed_run_at')}{' '}
            {formatTime(schedule.next_routed_run_at)} {t('settings_radioapp_utc_top_of_hour_suffix')}
          </p>
        )}

        {trackedTelemetryRepeaters.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t('settings_radioapp_no_tracked_repeaters')}
          </p>
        ) : (
          <div className="space-y-2">
            {trackedTelemetryRepeaters.map((key) => {
              const contact = contacts.find((c) => c.public_key === key);
              const displayName = contact?.name ?? key.slice(0, 12);
              const routeSource = contact?.effective_route_source ?? 'flood';
              const hasRealPath =
                contact?.effective_route != null && contact.effective_route.path_len >= 0;
              const routeLabel = !hasRealPath
                ? t('settings_radioapp_route_flood')
                : routeSource === 'override'
                  ? t('settings_radioapp_route_routed')
                  : routeSource === 'direct'
                    ? t('settings_radioapp_route_direct')
                    : t('settings_radioapp_route_flood');
              const routeColor = hasRealPath
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground bg-muted';
              const snap = latestTelemetry[key];
              const d = snap?.data;
              return (
                <div key={key} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{displayName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.625rem] text-muted-foreground font-mono">
                          {key.slice(0, 12)}
                        </span>
                        <span
                          className={`text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${routeColor}`}
                        >
                          {routeLabel}
                        </span>
                      </div>
                    </div>
                    {onToggleTrackedTelemetry && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleTrackedTelemetry(key)}
                        className="h-7 text-xs flex-shrink-0 text-destructive hover:text-destructive"
                      >
                        {t('settings_radioapp_remove_button')}
                      </Button>
                    )}
                  </div>
                  {d ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.625rem] text-muted-foreground">
                      <span>{d.battery_volts?.toFixed(2)}V</span>
                      <span>{t('settings_radioapp_noise_dbm', { value: d.noise_floor_dbm ?? '' })}</span>
                      <span>
                        {t('settings_radioapp_rx_count', {
                          value:
                            d.packets_received != null ? d.packets_received.toLocaleString() : '?',
                        })}
                      </span>
                      <span>
                        {t('settings_radioapp_tx_count', {
                          value: d.packets_sent != null ? d.packets_sent.toLocaleString() : '?',
                        })}
                      </span>
                      {d.lpp_sensors?.map((s) => {
                        const display = lppDisplayUnit(s.type_name, s.value, distanceUnit);
                        const val =
                          typeof display.value === 'number'
                            ? display.value % 1 === 0
                              ? display.value
                              : display.value.toFixed(1)
                            : display.value;
                        const label = s.type_name.charAt(0).toUpperCase() + s.type_name.slice(1);
                        return (
                          <span key={`${s.type_name}-${s.channel}`}>
                            {label} {val}
                            {display.unit ? ` ${display.unit}` : ''}
                          </span>
                        );
                      })}
                      <span className="ml-auto">
                        {t('settings_radioapp_checked_at', { time: formatTime(snap.timestamp) })}
                      </span>
                    </div>
                  ) : snap === null ? (
                    <div className="mt-1 text-[0.625rem] text-muted-foreground italic">
                      {t('settings_radioapp_no_telemetry_yet')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Tracked Contact Telemetry ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radioapp_tracked_contact_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_radioapp_tracked_contact_desc')}
        </p>

        {trackedTelemetryContacts.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t('settings_radioapp_no_tracked_contacts')}
          </p>
        ) : (
          <div className="space-y-2">
            {trackedTelemetryContacts.map((key) => {
              const contact = contacts.find((c) => c.public_key === key);
              const displayName = contact?.name ?? key.slice(0, 12);
              const routeSource = contact?.effective_route_source ?? 'flood';
              const hasRealPath =
                contact?.effective_route != null && contact.effective_route.path_len >= 0;
              const routeLabel = !hasRealPath
                ? t('settings_radioapp_route_flood')
                : routeSource === 'override'
                  ? t('settings_radioapp_route_routed')
                  : routeSource === 'direct'
                    ? t('settings_radioapp_route_direct')
                    : t('settings_radioapp_route_flood');
              const routeColor = hasRealPath
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground bg-muted';
              const snap = latestContactTelemetry[key];
              const d = snap?.data;
              return (
                <div key={key} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{displayName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.625rem] text-muted-foreground font-mono">
                          {key.slice(0, 12)}
                        </span>
                        <span
                          className={`text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${routeColor}`}
                        >
                          {routeLabel}
                        </span>
                      </div>
                    </div>
                    {onToggleTrackedTelemetryContact && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleTrackedTelemetryContact(key)}
                        className="h-7 text-xs flex-shrink-0 text-destructive hover:text-destructive"
                      >
                        {t('settings_radioapp_remove_button')}
                      </Button>
                    )}
                  </div>
                  {d ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.625rem] text-muted-foreground">
                      {d.lpp_sensors?.map((s) => {
                        if (typeof s.value !== 'number') return null;
                        const display = lppDisplayUnit(s.type_name, s.value, distanceUnit);
                        const val =
                          typeof display.value === 'number'
                            ? display.value % 1 === 0
                              ? display.value
                              : display.value.toFixed(1)
                            : display.value;
                        const label = s.type_name.charAt(0).toUpperCase() + s.type_name.slice(1);
                        return (
                          <span key={`${s.type_name}-${s.channel}`}>
                            {label} {val}
                            {display.unit ? ` ${display.unit}` : ''}
                          </span>
                        );
                      })}
                      <span className="ml-auto">
                        {t('settings_radioapp_checked_at', { time: formatTime(snap.timestamp) })}
                      </span>
                    </div>
                  ) : snap === null ? (
                    <div className="mt-1 text-[0.625rem] text-muted-foreground italic">
                      {t('settings_radioapp_no_telemetry_yet')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Contact Management ── */}
      <div className="space-y-5">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_radioapp_contact_mgmt_heading')}
        </h3>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">
            {t('settings_radioapp_block_discovery_heading')}
          </h4>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radioapp_block_discovery_desc')}
          </p>
          <div className="space-y-1.5">
            {(
              [
                [1, t('settings_radioapp_block_clients')],
                [2, t('settings_radioapp_block_repeaters')],
                [3, t('settings_radioapp_block_room_servers')],
                [4, t('settings_radioapp_block_sensors')],
              ] as const
            ).map(([typeCode, label]) => {
              const checked = discoveryBlockedTypes.includes(typeCode);
              return (
                <label key={typeCode} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const prev = discoveryBlockedTypes;
                      const next = checked
                        ? prev.filter((code) => code !== typeCode)
                        : [...prev, typeCode];
                      setDiscoveryBlockedTypes(next);
                      void persistAppSettings({ discovery_blocked_types: next }, () =>
                        setDiscoveryBlockedTypes(prev)
                      );
                    }}
                    className="rounded border-input"
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {discoveryBlockedTypes.length > 0 && (
            <p className="text-xs text-warning">
              {t('settings_radioapp_new_types_blocked', {
                types: discoveryBlockedTypes
                  .map((code) =>
                    code === 1
                      ? t('settings_radioapp_type_clients')
                      : code === 2
                        ? t('settings_radioapp_type_repeaters')
                        : code === 3
                          ? t('settings_radioapp_type_room_servers')
                          : t('settings_radioapp_type_sensors')
                  )
                  .join(', '),
              })}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t('settings_radioapp_blocked_contacts_heading')}</h4>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radioapp_blocked_contacts_desc')}
          </p>

          {blockedKeys.length === 0 && blockedNames.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {t('settings_radioapp_no_blocked_contacts')}
            </p>
          ) : (
            <div className="space-y-2">
              {blockedKeys.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground font-medium">
                    {t('settings_radioapp_blocked_keys_label')}
                  </span>
                  <div className="mt-1 space-y-1">
                    {blockedKeys.map((key) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono truncate flex-1">{key}</span>
                        {onToggleBlockedKey && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onToggleBlockedKey(key)}
                            className="h-7 text-xs flex-shrink-0"
                          >
                            {t('settings_radioapp_unblock_button')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {blockedNames.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground font-medium">
                    {t('settings_radioapp_blocked_names_label')}
                  </span>
                  <div className="mt-1 space-y-1">
                    {blockedNames.map((name) => (
                      <div key={name} className="flex items-center justify-between gap-2">
                        <span className="text-sm truncate flex-1">{name}</span>
                        {onToggleBlockedName && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onToggleBlockedName(name)}
                            className="h-7 text-xs flex-shrink-0"
                          >
                            {t('settings_radioapp_unblock_button')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t('settings_radioapp_bulk_delete_heading')}</h4>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_radioapp_bulk_delete_desc')}
          </p>
          <Button variant="outline" className="w-full" onClick={() => setBulkDeleteOpen(true)}>
            {t('settings_radioapp_open_bulk_delete_button')}
          </Button>
          <BulkDeleteContactsModal
            open={bulkDeleteOpen}
            onClose={() => setBulkDeleteOpen(false)}
            contacts={contacts}
            onDeleted={(keys) => onBulkDeleteContacts?.(keys)}
          />
        </div>
      </div>
    </div>
  );
}
