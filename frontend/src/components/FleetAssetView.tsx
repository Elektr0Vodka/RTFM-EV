/**
 * Tools > Fleet > one asset: the form for a new asset or an existing one.
 *
 * Saving an existing asset sends only the fields that changed; an emptied
 * field is sent as null and cleared. The "On the mesh" box shows the contact
 * with the same public key and is read-only here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type {
  ContactLocationHistoryEntry,
  FleetAsset,
  FleetAssetFields,
  FleetAssetStatus,
  FleetSettings,
} from '../types';
import { formatCoordinates, useCoordinateFormat } from '../utils/coordinateFormat';
import { isValidLocation } from '../utils/pathUtils';
import { contactTypeLabel } from './ContactInfoBody';
import { relTime } from './meshHealthShared';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FleetAssetSecrets } from './fleet/FleetAssetSecrets';
import { FleetAssetTimeline } from './fleet/FleetAssetTimeline';
import {
  FLEET_STATUSES,
  FleetStatusBadge,
  fleetAttention,
  fleetAssetName,
  fleetStatusLabelKey,
} from './fleet/fleetShared';

type TextField = Exclude<keyof FleetAssetFields, 'status'>;
type FormState = Record<TextField, string> & { status: FleetAssetStatus };

const TEXT_FIELDS: TextField[] = [
  'label',
  'public_key',
  'org_serial',
  'hw_serial',
  'model',
  'role',
  'wifi_mac',
  'ble_mac',
  'assigned_to',
  'site_name',
  'target_firmware',
  'notes',
];

const SECTIONS: { titleKey: string; fields: TextField[] }[] = [
  { titleKey: 'fleet_section_identity', fields: ['label', 'public_key', 'org_serial'] },
  {
    titleKey: 'fleet_section_hardware',
    fields: ['model', 'role', 'hw_serial', 'wifi_mac', 'ble_mac', 'target_firmware'],
  },
  { titleKey: 'fleet_section_placement', fields: ['assigned_to', 'site_name'] },
];

const MONO_FIELDS = new Set<TextField>([
  'public_key',
  'org_serial',
  'hw_serial',
  'wifi_mac',
  'ble_mac',
]);
const MAX_LENGTH: Partial<Record<TextField, number>> = { public_key: 64, notes: 4000 };
const MAC_PLACEHOLDER = 'AA:BB:CC:DD:EE:FF';

const EMPTY_FORM: FormState = {
  label: '',
  public_key: '',
  org_serial: '',
  hw_serial: '',
  model: '',
  role: '',
  wifi_mac: '',
  ble_mac: '',
  assigned_to: '',
  site_name: '',
  target_firmware: '',
  notes: '',
  status: 'in_stock',
};

function formOf(asset: FleetAsset): FormState {
  const form = { ...EMPTY_FORM, status: asset.status };
  for (const field of TEXT_FIELDS) form[field] = asset[field] ?? '';
  return form;
}

/** The fields that differ from `base`, trimmed; an emptied field becomes null. */
function changesOf(form: FormState, base: FormState): Partial<FleetAssetFields> {
  const changes: Partial<FleetAssetFields> = {};
  for (const field of TEXT_FIELDS) {
    const value = form[field].trim();
    if (value !== base[field].trim()) changes[field] = value === '' ? null : value;
  }
  if (form.status !== base.status) changes.status = form.status;
  return changes;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** For a lost or stolen device: where the node was last, from stored positions. */
function LastPositions({ publicKey }: { publicKey: string }) {
  const t = useT();
  const coordinateFormat = useCoordinateFormat();
  const [positions, setPositions] = useState<ContactLocationHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .contactLocationHistory(publicKey)
      .then((rows) => {
        if (!cancelled) setPositions([...rows].sort((a, b) => b.last_seen - a.last_seen));
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  return (
    <div
      className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-xs"
      data-testid="fleet-last-positions"
    >
      <p className="font-medium uppercase tracking-wide text-destructive">
        {t('fleet_positions_title')}
      </p>
      {positions !== null && positions.length === 0 && (
        <p className="text-muted-foreground">{t('fleet_positions_none')}</p>
      )}
      {positions !== null && positions.length > 0 && (
        <ul className="space-y-1">
          {positions.slice(0, 10).map((position) => (
            <li key={`${position.first_seen}-${position.lat}-${position.lon}`}>
              <span className="font-mono">
                {formatCoordinates(position.lat, position.lon, coordinateFormat)}
              </span>
              <span className="ml-2 text-muted-foreground">
                {t('fleet_positions_seen', { when: relTime(position.last_seen, t) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FleetAssetView({
  assetId,
  onBack,
  onOpenAsset,
  onOpenContactInfo,
}: {
  assetId: number | 'new';
  /** Back to the list. */
  onBack: () => void;
  /** Opens the page of an asset; used after a new one was created. */
  onOpenAsset: (assetId: number) => void;
  onOpenContactInfo: (publicKey: string) => void;
}) {
  const t = useT();
  const coordinateFormat = useCoordinateFormat();
  const isNew = assetId === 'new';
  const [asset, setAsset] = useState<FleetAsset | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [settings, setSettings] = useState<FleetSettings | null>(null);
  // Bumped after a save or a log change, so the log and the asset re-read.
  const [logVersion, setLogVersion] = useState(0);
  const formFilled = useRef(false);

  useEffect(() => {
    if (assetId === 'new') return;
    const controller = new AbortController();
    api
      .fleetAsset(assetId, controller.signal)
      .then((loaded) => {
        setAsset(loaded);
        // Only the first read fills the form: a later re-read must not undo typing.
        if (!formFilled.current) setForm(formOf(loaded));
        formFilled.current = true;
      })
      .catch((err) => {
        if (!isAbortError(err)) setLoadError(errorMessage(err));
      });
    return () => controller.abort();
    // logVersion: a log entry can move the asset's last-maintenance date and a
    // save can change what needs attention, so the asset is read again.
  }, [assetId, logVersion]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetSettings(controller.signal)
      .then(setSettings)
      .catch(() => {
        // Without the thresholds the page still works; it only shows no warnings.
      });
    return () => controller.abort();
  }, []);

  const base = useMemo(() => (asset ? formOf(asset) : EMPTY_FORM), [asset]);
  const changes = useMemo(() => changesOf(form, base), [form, base]);
  const dirty = Object.keys(changes).length > 0;

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
    setDeleteArmed(false);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (assetId === 'new') {
        const created = await api.createFleetAsset({ ...changes, status: form.status });
        onOpenAsset(created.id);
        return;
      }
      const updated = await api.updateFleetAsset(assetId, changes);
      setAsset(updated);
      setForm(formOf(updated));
      setSaved(true);
      setLogVersion((version) => version + 1);
    } catch (err) {
      setSaveError(t('fleet_save_failed', { error: errorMessage(err) }));
    } finally {
      setSaving(false);
    }
  };

  // Two clicks: a deleted asset does not come back.
  const remove = async () => {
    if (assetId === 'new') return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    try {
      await api.deleteFleetAsset(assetId);
      onBack();
    } catch (err) {
      setSaveError(t('fleet_delete_failed', { error: errorMessage(err) }));
    }
  };

  const title = isNew ? t('fleet_asset_new_title') : asset ? fleetAssetName(asset) : t('nav_fleet');
  const ready = isNew || asset !== null;
  const contact = asset?.contact ?? null;
  const health = asset?.health ?? null;
  const attention =
    asset && settings ? fleetAttention(asset, settings, Math.floor(Date.now() / 1000)) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('fleet_asset_back')}
          title={t('fleet_asset_back')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="min-w-0 truncate text-base font-semibold text-foreground">{title}</h2>
        {asset && <FleetStatusBadge status={asset.status} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {t('fleet_asset_load_failed', { error: loadError })}
          </p>
        )}
        {!ready && !loadError && (
          <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
        )}

        {ready && (
          <div className="mx-auto max-w-3xl space-y-5">
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {SECTIONS.map((section) => (
                <fieldset
                  key={section.titleKey}
                  className="space-y-3 rounded-lg border border-border bg-card p-4"
                >
                  <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(section.titleKey)}
                  </legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {section.fields.map((field) => (
                      <label
                        key={field}
                        className={
                          field === 'public_key'
                            ? 'block space-y-1 sm:col-span-2'
                            : 'block space-y-1'
                        }
                      >
                        <span className="text-xs font-medium text-foreground">
                          {t(`fleet_field_${field}`)}
                        </span>
                        <Input
                          data-testid={`fleet-field-${field}`}
                          value={form[field]}
                          onChange={(e) => setField(field, e.target.value)}
                          maxLength={MAX_LENGTH[field] ?? 200}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder={field.endsWith('_mac') ? MAC_PLACEHOLDER : undefined}
                          className={
                            MONO_FIELDS.has(field) ? 'h-9 font-mono text-xs' : 'h-9 text-sm'
                          }
                        />
                        {field === 'public_key' && (
                          <span className="block text-xs text-muted-foreground">
                            {t('fleet_field_public_key_hint')}
                          </span>
                        )}
                      </label>
                    ))}
                    {section.titleKey === 'fleet_section_placement' && (
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-foreground">
                          {t('fleet_field_status')}
                        </span>
                        <select
                          data-testid="fleet-field-status"
                          value={form.status}
                          onChange={(e) => setField('status', e.target.value as FleetAssetStatus)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        >
                          {FLEET_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {t(fleetStatusLabelKey(status))}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </fieldset>
              ))}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">
                  {t('fleet_field_notes')}
                </span>
                <textarea
                  data-testid="fleet-field-notes"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  maxLength={MAX_LENGTH.notes}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>

              {!isNew && (
                <div
                  className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm"
                  data-testid="fleet-mesh"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('fleet_mesh_title')}
                  </p>
                  {contact && asset?.public_key ? (
                    <>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">{t('fleet_col_name')}</dt>
                        <dd>{contact.name ?? asset.public_key.slice(0, 12)}</dd>
                        {contact.type !== null && (
                          <>
                            <dt className="text-muted-foreground">{t('fleet_mesh_type')}</dt>
                            <dd>{contactTypeLabel(contact.type, t)}</dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">{t('fleet_col_last_seen')}</dt>
                        <dd>{relTime(contact.last_seen, t)}</dd>
                        {contact.lat !== null &&
                          contact.lon !== null &&
                          isValidLocation(contact.lat, contact.lon) && (
                            <>
                              <dt className="text-muted-foreground">{t('fleet_mesh_position')}</dt>
                              <dd className="font-mono">
                                {formatCoordinates(contact.lat, contact.lon, coordinateFormat)}
                              </dd>
                            </>
                          )}
                        <dt className="text-muted-foreground">{t('fleet_health_battery')}</dt>
                        <dd data-testid="fleet-health-battery">
                          {health && health.battery_volts !== null
                            ? t('fleet_health_volts_at', {
                                volts: health.battery_volts.toFixed(2),
                                when: relTime(health.telemetry_at, t),
                              })
                            : t('fleet_health_no_telemetry')}
                        </dd>
                        {health && health.temperature !== null && (
                          <>
                            <dt className="text-muted-foreground">
                              {t('fleet_health_temperature')}
                            </dt>
                            <dd>
                              {t('fleet_health_celsius', { value: health.temperature.toFixed(1) })}
                            </dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">{t('fleet_health_firmware')}</dt>
                        <dd data-testid="fleet-health-firmware">
                          {health?.firmware_version
                            ? t('fleet_health_firmware_from', {
                                version: health.firmware_version,
                                source: t(`fleet_health_source_${health.firmware_source}`),
                              })
                            : t('fleet_health_no_firmware')}
                        </dd>
                      </dl>
                      {attention.length > 0 && (
                        <ul
                          className="space-y-0.5 text-xs text-warning"
                          data-testid="fleet-attention"
                        >
                          {attention.map((reason) => (
                            <li key={reason}>{t(`fleet_attention_${reason}`)}</li>
                          ))}
                        </ul>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="fleet-open-contact"
                        onClick={() => onOpenContactInfo(asset.public_key as string)}
                      >
                        {t('fleet_open_contact')}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {asset?.public_key ? t('fleet_mesh_none') : t('fleet_mesh_no_key')}
                    </p>
                  )}
                </div>
              )}

              {saveError && (
                <p className="text-sm text-destructive" role="alert">
                  {saveError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  data-testid="fleet-save"
                  disabled={saving || !dirty}
                >
                  {saving ? t('fleet_saving') : isNew ? t('fleet_add') : t('fleet_save')}
                </Button>
                {saved && (
                  <span className="text-xs text-success" data-testid="fleet-saved">
                    {t('fleet_saved')}
                  </span>
                )}
                {!isNew && (
                  <Button
                    type="button"
                    variant={deleteArmed ? 'destructive' : 'outline'}
                    size="sm"
                    data-testid="fleet-delete"
                    title={t('fleet_delete_hint')}
                    className="ml-auto"
                    onClick={() => void remove()}
                  >
                    {deleteArmed ? t('fleet_delete_confirm') : t('fleet_delete')}
                  </Button>
                )}
              </div>
            </form>

            {asset &&
              (asset.status === 'lost' || asset.status === 'stolen') &&
              asset.public_key && <LastPositions publicKey={asset.public_key} />}
            {asset && (
              <FleetAssetTimeline
                assetId={asset.id}
                version={logVersion}
                onChanged={() => setLogVersion((version) => version + 1)}
              />
            )}
            {asset && (
              <FleetAssetSecrets
                asset={asset}
                onAssetChanged={(next) => {
                  setAsset(next);
                  setForm(formOf(next));
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
