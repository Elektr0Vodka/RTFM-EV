/**
 * Tools > Fleet: the asset register, one row per device the operator keeps
 * track of.
 *
 * The page reads and writes stored data only (`/api/fleet/assets`). Nothing on
 * it uses the radio. What the mesh reports about a node (name, type, last
 * seen) comes from the contact with the same public key. A row opens the
 * asset's own page (`FleetAssetView`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import { cn } from '@/lib/utils';
import type { Contact, FleetAsset, FleetAssetStatus, FleetSettings } from '../types';
import { formatDateTime } from '../utils/dateTimeFormat';
import { contactTypeLabel } from './ContactInfoBody';
import { relTime } from './meshHealthShared';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FleetVaultPanel } from './fleet/FleetVaultPanel';
import {
  FLEET_CSV_COLUMNS,
  FLEET_STATUSES,
  FleetStatusBadge,
  buildFleetCsv,
  fleetAttention,
  firmwareMatches,
  downloadFleetFile,
  filterFleetAssets,
  fleetAssetName,
  fleetExportFilename,
  fleetStatusLabelKey,
  ownedKeysWithoutAsset,
  sortFleetAssets,
  type FleetCsvColumn,
  type FleetSortDir,
  type FleetSortKey,
} from './fleet/fleetShared';

const NO_VALUE = '-';

const COLUMNS: { key: FleetSortKey; labelKey: string }[] = [
  { key: 'status', labelKey: 'fleet_field_status' },
  { key: 'name', labelKey: 'fleet_col_name' },
  { key: 'org_serial', labelKey: 'fleet_field_org_serial' },
  { key: 'model', labelKey: 'fleet_field_model' },
  { key: 'assigned_to', labelKey: 'fleet_field_assigned_to' },
  { key: 'site_name', labelKey: 'fleet_field_site_name' },
  { key: 'last_seen', labelKey: 'fleet_col_last_seen' },
  { key: 'battery', labelKey: 'fleet_health_battery' },
  { key: 'firmware', labelKey: 'fleet_health_firmware' },
  { key: 'last_maintenance', labelKey: 'fleet_col_last_maintenance' },
];

const CSV_HEADER_KEYS: Record<FleetCsvColumn, string> = {
  id: 'fleet_csv_id',
  label: 'fleet_field_label',
  public_key: 'fleet_field_public_key',
  contact_name: 'fleet_csv_contact_name',
  status: 'fleet_field_status',
  org_serial: 'fleet_field_org_serial',
  hw_serial: 'fleet_field_hw_serial',
  model: 'fleet_field_model',
  role: 'fleet_field_role',
  wifi_mac: 'fleet_field_wifi_mac',
  ble_mac: 'fleet_field_ble_mac',
  assigned_to: 'fleet_field_assigned_to',
  site_name: 'fleet_field_site_name',
  notes: 'fleet_field_notes',
  last_seen: 'fleet_col_last_seen',
  battery_volts: 'fleet_health_battery',
  firmware_version: 'fleet_health_firmware',
  target_firmware: 'fleet_field_target_firmware',
  last_maintenance: 'fleet_col_last_maintenance',
  last_failure: 'fleet_col_last_failure',
  created_at: 'fleet_csv_created_at',
  updated_at: 'fleet_csv_updated_at',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function SortIcon({ active, dir }: { active: boolean; dir: FleetSortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" aria-hidden />;
  return dir === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />
  );
}

export function FleetView({
  contacts,
  ownerKeys,
  onOpenAsset,
  onOpenTemplates,
  onOpenContactInfo,
}: {
  contacts: Contact[];
  /** This radio's public key and the earlier radios whose nodes it inherits. */
  ownerKeys: string[];
  /** Opens the page of one asset, or the empty form with `'new'`. */
  onOpenAsset: (assetId: number | 'new') => void;
  /** Opens the config templates page. */
  onOpenTemplates: () => void;
  onOpenContactInfo: (publicKey: string) => void;
}) {
  const t = useT();
  const [assets, setAssets] = useState<FleetAsset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FleetAssetStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<FleetSortKey>('status');
  const [sortDir, setSortDir] = useState<FleetSortDir>('asc');
  const [addingOwned, setAddingOwned] = useState(false);
  const [settings, setSettings] = useState<FleetSettings | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [silentHours, setSilentHours] = useState('');
  const [lowBattery, setLowBattery] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await api.fleetAssets(signal);
      setAssets(rows);
      setLoadError(null);
    } catch (err) {
      if (isAbortError(err)) return;
      setLoadError(errorMessage(err));
    }
  }, []);

  const applySettings = useCallback((next: FleetSettings) => {
    setSettings(next);
    setSilentHours(String(next.silent_hours));
    setLowBattery(String(next.low_battery_volts));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetSettings(controller.signal)
      .then(applySettings)
      .catch(() => {
        // Without the thresholds the list still works; it only marks nothing.
      });
    return () => controller.abort();
  }, [applySettings]);

  const saveSettings = async () => {
    setActionError(null);
    try {
      applySettings(
        await api.saveFleetSettings({
          silent_hours: Number(silentHours),
          low_battery_volts: Number(lowBattery),
        })
      );
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Why each asset needs a person, by asset id. Empty until the thresholds are loaded.
  const attention = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return new Map(
      (assets ?? []).map((asset) => [
        asset.id,
        settings ? fleetAttention(asset, settings, now) : [],
      ])
    );
  }, [assets, settings]);
  const attentionCount = useMemo(
    () => [...attention.values()].filter((reasons) => reasons.length > 0).length,
    [attention]
  );

  const shown = useMemo(() => {
    const matching = filterFleetAssets(assets ?? [], query, statusFilter).filter(
      (asset) => !attentionOnly || (attention.get(asset.id)?.length ?? 0) > 0
    );
    return sortFleetAssets(matching, sortKey, sortDir);
  }, [assets, query, statusFilter, attentionOnly, attention, sortKey, sortDir]);
  const ownedToAdd = useMemo(
    () => (assets ? ownedKeysWithoutAsset(contacts, ownerKeys, assets) : []),
    [contacts, ownerKeys, assets]
  );

  const handleSort = (key: FleetSortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const addOwned = async () => {
    setAddingOwned(true);
    setActionError(null);
    try {
      await api.addFleetAssetsFromContacts(ownedToAdd);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAddingOwned(false);
    }
  };

  // Exports what is on screen: the search and the status filter apply.
  const exportCsv = () => {
    const headers = Object.fromEntries(
      FLEET_CSV_COLUMNS.map((column) => [column, t(CSV_HEADER_KEYS[column])])
    ) as Record<FleetCsvColumn, string>;
    downloadFleetFile(fleetExportFilename('csv', new Date()), 'text/csv;charset=utf-8;', [
      '﻿',
      buildFleetCsv(shown, headers),
    ]);
  };
  const exportJson = () => {
    downloadFleetFile(fleetExportFilename('json', new Date()), 'application/json', [
      JSON.stringify(shown, null, 2),
    ]);
  };

  const total = assets?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="mr-auto min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t('nav_fleet')}</h2>
          <p className="text-xs text-muted-foreground">{t('fleet_intro')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('fleet_refresh')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={shown.length === 0}
          onClick={exportCsv}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('fleet_export_csv')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={shown.length === 0}
          onClick={exportJson}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('fleet_export_json')}
        </Button>
        {ownedToAdd.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="fleet-add-owned"
            title={t('fleet_add_owned_title')}
            disabled={addingOwned}
            onClick={() => void addOwned()}
          >
            {t('fleet_add_owned', { count: ownedToAdd.length })}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-open-templates"
          onClick={onOpenTemplates}
        >
          {t('fleet_templates_title')}
        </Button>
        <Button type="button" size="sm" data-testid="fleet-add" onClick={() => onOpenAsset('new')}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('fleet_add')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {t('fleet_load_failed', { error: loadError })}
          </p>
        )}
        {actionError && (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}

        {assets === null && !loadError && (
          <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
        )}

        {assets !== null && total === 0 && (
          <div
            className="space-y-2 rounded-lg border border-border bg-card px-4 py-6 text-sm"
            data-testid="fleet-empty"
          >
            <p className="font-medium text-foreground">{t('fleet_empty_title')}</p>
            <p className="text-muted-foreground">
              {t('fleet_empty_body', { add: t('fleet_add'), contact: t('fleet_contact_add') })}
            </p>
          </div>
        )}

        {total > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                data-testid="fleet-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('fleet_search_placeholder')}
                aria-label={t('fleet_search_placeholder')}
                className="h-9 max-w-xs text-xs"
              />
              <select
                data-testid="fleet-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FleetAssetStatus | 'all')}
                aria-label={t('fleet_field_status')}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="all">{t('fleet_filter_all')}</option>
                {FLEET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(fleetStatusLabelKey(status))}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  data-testid="fleet-attention-only"
                  checked={attentionOnly}
                  onChange={(e) => setAttentionOnly(e.target.checked)}
                />
                {t('fleet_attention_only', { count: attentionCount })}
              </label>
              <span className="text-xs text-muted-foreground">
                {t('fleet_count', { shown: shown.length, total })}
              </span>
            </div>

            <details className="text-xs" data-testid="fleet-attention-rules">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {t('fleet_attention_rules')}
              </summary>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="block text-muted-foreground">
                    {t('fleet_rule_silent_hours')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={8760}
                    data-testid="fleet-rule-silent"
                    value={silentHours}
                    onChange={(e) => setSilentHours(e.target.value)}
                    className="h-9 w-28 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-muted-foreground">{t('fleet_rule_low_battery')}</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.05}
                    data-testid="fleet-rule-battery"
                    value={lowBattery}
                    onChange={(e) => setLowBattery(e.target.value)}
                    className="h-9 w-28 text-xs"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="fleet-rule-save"
                  onClick={() => void saveSettings()}
                >
                  {t('fleet_save')}
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">{t('fleet_attention_rules_hint')}</p>
            </details>

            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="fleet-no-match">
                {t('fleet_no_match')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                      {COLUMNS.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={
                            sortKey === column.key
                              ? sortDir === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                          className="px-2 py-1.5 align-bottom font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(column.key)}
                            className="inline-flex items-end uppercase leading-tight tracking-wide hover:text-foreground"
                          >
                            {t(column.labelKey)}
                            <SortIcon active={sortKey === column.key} dir={sortDir} />
                          </button>
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="px-2 py-1.5 align-bottom font-medium uppercase tracking-wide"
                      >
                        {t('fleet_field_public_key')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((asset) => {
                      const name = fleetAssetName(asset);
                      const reasons = attention.get(asset.id) ?? [];
                      const alarm = asset.status === 'lost' || asset.status === 'stolen';
                      const firmware = asset.health?.firmware_version ?? null;
                      const firmwareOff =
                        !!firmware &&
                        !!asset.target_firmware &&
                        !firmwareMatches(asset.target_firmware, firmware);
                      return (
                        // A click anywhere on the row opens the asset; the node
                        // name stops the click so it can open the contact.
                        <tr
                          key={asset.id}
                          data-testid={`fleet-asset-${asset.id}`}
                          onClick={() => onOpenAsset(asset.id)}
                          className={cn(
                            'cursor-pointer border-b border-border transition-colors last:border-0',
                            alarm ? 'bg-destructive/10' : 'hover:bg-background'
                          )}
                        >
                          <td className="whitespace-nowrap px-2 py-1.5">
                            <FleetStatusBadge status={asset.status} />
                            {reasons.length > 0 && (
                              <span
                                data-testid={`fleet-attention-${asset.id}`}
                                data-reasons={reasons.join(' ')}
                                title={reasons
                                  .map((reason) => t(`fleet_attention_${reason}`))
                                  .join('\n')}
                                className="ml-1.5 inline-flex align-middle text-warning"
                              >
                                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">
                                  {reasons
                                    .map((reason) => t(`fleet_attention_${reason}`))
                                    .join(', ')}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              title={t('fleet_open_asset', { name })}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenAsset(asset.id);
                              }}
                              className="text-left font-medium text-foreground hover:underline"
                            >
                              {name}
                            </button>
                            {asset.contact && asset.public_key && (
                              <button
                                type="button"
                                data-testid={`fleet-contact-${asset.id}`}
                                title={t('fleet_open_contact')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenContactInfo(asset.public_key as string);
                                }}
                                className="ml-1.5 text-primary hover:underline"
                              >
                                {asset.label && asset.contact.name
                                  ? asset.contact.name
                                  : asset.contact.type !== null
                                    ? contactTypeLabel(asset.contact.type, t)
                                    : t('fleet_open_contact')}
                              </button>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                            {asset.org_serial ?? NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {asset.model ?? NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {asset.assigned_to ?? NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {asset.site_name ?? NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {asset.contact
                              ? relTime(asset.contact.last_seen, t)
                              : asset.public_key
                                ? t('fleet_not_heard')
                                : NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                            {asset.health && asset.health.battery_volts !== null
                              ? t('fleet_health_volts', {
                                  volts: asset.health.battery_volts.toFixed(2),
                                })
                              : NO_VALUE}
                          </td>
                          <td
                            className={cn(
                              'whitespace-nowrap px-2 py-1.5',
                              firmwareOff && 'text-warning'
                            )}
                          >
                            {firmware ?? NO_VALUE}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {asset.last_maintenance
                              ? formatDateTime(asset.last_maintenance * 1000, {
                                  dateStyle: 'medium',
                                })
                              : NO_VALUE}
                          </td>
                          <td
                            className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground"
                            title={asset.public_key ?? undefined}
                          >
                            {asset.public_key ? asset.public_key.slice(0, 12) : NO_VALUE}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <FleetVaultPanel onOpenAsset={onOpenAsset} />
      </div>
    </div>
  );
}
