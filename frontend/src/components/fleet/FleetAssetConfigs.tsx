/**
 * Fleet asset page > Configs: the stored config files of one device.
 *
 * A config is the device's own file (the toolbox's USB config export, or the
 * Settings > Radio file of a companion). The server keeps it as it is, except
 * for its secrets: those go to the key vault when it is unlocked, and are left
 * out otherwise. This block never shows a secret value; it shows that there is
 * one and whether the vault has it.
 *
 * The stored files are read and written here. Reading a device and applying a
 * config to it over a USB cable is FleetUsbDevice, at the end of this block.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type {
  FleetConfig,
  FleetConfigImportInput,
  FleetConfigKind,
  FleetConfigProfile,
  FleetConfigReported,
  FleetConfigSummary,
  FleetConfigTemplate,
} from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { useFleetVaultUnlocked } from '../../utils/fleetVault';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useFleetVaultStatus, vaultCall } from './FleetVault';
import {
  configFilename,
  configSections,
  diffConfigs,
  fittingProfiles,
  roleFromFilename,
  type ConfigDocument,
  type ConfigLeaf,
} from './fleetConfigShared';
import { downloadFleetFile } from './fleetShared';
import { FleetUsbDevice } from './FleetUsbDevice';

type VaultState = 'off' | 'locked' | 'open';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function LeafText({ leaf, testId }: { leaf: ConfigLeaf | null; testId?: string }) {
  const t = useT();
  if (leaf === null) {
    return <span className="text-muted-foreground">{t('fleet_config_diff_absent')}</span>;
  }
  if (leaf.secret) {
    const stored = leaf.id !== null;
    return (
      <span
        data-testid={testId}
        data-secret={stored ? 'stored' : 'missing'}
        className={stored ? 'text-success' : 'text-warning'}
      >
        {stored ? t('fleet_config_secret_stored') : t('fleet_config_secret_missing')}
      </span>
    );
  }
  if (leaf.text === '') {
    return <span className="text-muted-foreground">{t('fleet_config_value_empty')}</span>;
  }
  return <span className="whitespace-pre-wrap break-all font-mono">{leaf.text}</span>;
}

function ConfigDocumentView({ document }: { document: ConfigDocument }) {
  const t = useT();
  const sections = useMemo(() => configSections(document), [document]);
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.key} data-testid={`fleet-config-section-${section.key || 'general'}`}>
          <p className="mb-1 font-mono text-[11px] font-medium text-foreground">
            {section.key || t('fleet_config_section_general')}
          </p>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-0.5 text-[11px]">
            {section.rows.map((row) => (
              <div key={row.path} className="contents">
                <dt className="break-all font-mono text-muted-foreground">{row.path}</dt>
                <dd>
                  <LeafText leaf={row.leaf} testId={`fleet-config-secret-${row.path}`} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function ConfigDiffView({ left, right }: { left: ConfigDocument; right: ConfigDocument }) {
  const t = useT();
  const diff = useMemo(() => diffConfigs(left, right), [left, right]);
  return (
    <div className="space-y-2">
      {diff.changed.length === 0 ? (
        <p className="text-muted-foreground" data-testid="fleet-config-diff-none">
          {t('fleet_config_diff_none')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[11px]" data-testid="fleet-config-diff">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-1 font-medium">{t('fleet_config_diff_key')}</th>
                <th className="px-2 py-1 font-medium">{t('fleet_config_diff_this')}</th>
                <th className="px-2 py-1 font-medium">{t('fleet_config_diff_other')}</th>
              </tr>
            </thead>
            <tbody>
              {diff.changed.map((row) => (
                <tr key={row.path} className="border-b border-border last:border-0">
                  <td className="break-all px-2 py-1 font-mono text-muted-foreground">
                    {row.path}
                  </td>
                  <td className="px-2 py-1">
                    <LeafText leaf={row.left} />
                  </td>
                  <td className="px-2 py-1">
                    <LeafText leaf={row.right} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground">{t('fleet_config_diff_same', { count: diff.same })}</p>
      {diff.uncompared.length > 0 && (
        <p className="text-muted-foreground" data-testid="fleet-config-uncompared">
          {t('fleet_config_uncompared', { paths: diff.uncompared.join(', ') })}
        </p>
      )}
    </div>
  );
}

/**
 * A config against what its node last reported. The server compares with
 * stored pane snapshots and SNMP polls only; no node is asked anything here.
 */
function ConfigReportedView({
  configId,
  onError,
}: {
  configId: number;
  onError: (error: string) => void;
}) {
  const t = useT();
  const [reported, setReported] = useState<FleetConfigReported | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetConfigReported(configId, controller.signal)
      .then(setReported)
      .catch((err) => {
        if (!isAbortError(err)) onError(errorMessage(err));
      });
    return () => controller.abort();
  }, [configId, onError]);

  if (reported === null) return null;
  const different = reported.rows.filter((row) => !row.same);
  const same = reported.rows.length - different.length;

  return (
    <div className="space-y-2" data-testid="fleet-config-reported">
      <p className="font-medium text-foreground">{t('fleet_config_reported_title')}</p>
      {reported.status !== 'ok' ? (
        <p className="text-muted-foreground" data-testid="fleet-config-reported-status">
          {t(`fleet_config_reported_${reported.status}`)}
        </p>
      ) : (
        <>
          {different.length === 0 ? (
            <p className="text-success" data-testid="fleet-config-reported-none">
              {t('fleet_config_reported_none')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[11px]" data-testid="fleet-config-reported-diff">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-1 font-medium">{t('fleet_config_diff_key')}</th>
                    <th className="px-2 py-1 font-medium">{t('fleet_config_diff_this')}</th>
                    <th className="px-2 py-1 font-medium">{t('fleet_config_reported_value')}</th>
                    <th className="px-2 py-1 font-medium">{t('fleet_config_reported_from')}</th>
                  </tr>
                </thead>
                <tbody>
                  {different.map((row) => (
                    <tr key={row.path} className="border-b border-border last:border-0">
                      <td className="break-all px-2 py-1 font-mono text-muted-foreground">
                        {row.path}
                      </td>
                      <td className="px-2 py-1">
                        <LeafText leaf={{ secret: false, text: row.configured }} />
                      </td>
                      <td className="px-2 py-1">
                        <LeafText leaf={{ secret: false, text: row.reported }} />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {t('fleet_config_reported_stored', {
                          // A pane is named the way the repeater page names it.
                          source:
                            row.source === 'snmp'
                              ? t('fleet_config_reported_source_snmp')
                              : t(`repeater_${row.source}_title`),
                          when: formatDateTime(row.reported_at * 1000, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {same > 0 && (
            <p className="text-muted-foreground" data-testid="fleet-config-reported-same">
              {t('fleet_config_reported_same', { count: same })}
            </p>
          )}
          {reported.not_reported.length > 0 && (
            <p className="text-muted-foreground" data-testid="fleet-config-reported-missing">
              {t('fleet_config_reported_missing', { paths: reported.not_reported.join(', ') })}
            </p>
          )}
        </>
      )}
      <p className="text-muted-foreground">{t('fleet_config_reported_hint')}</p>
    </div>
  );
}

/** One opened config: its details, a comparison, "save as template" and the document. */
function ConfigDetail({
  summary,
  others,
  onChanged,
  onNote,
  onError,
}: {
  summary: FleetConfigSummary;
  others: FleetConfigSummary[];
  /** The details were saved or a template was made: lists must be read again. */
  onChanged: () => void;
  onNote: (note: string) => void;
  onError: (error: string) => void;
}) {
  const t = useT();
  const [config, setConfig] = useState<FleetConfig | null>(null);
  const [profile, setProfile] = useState<FleetConfigProfile>(summary.profile);
  const [role, setRole] = useState(summary.role ?? '');
  const [firmware, setFirmware] = useState(summary.firmware_version ?? '');
  const [label, setLabel] = useState(summary.label ?? '');
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compareWith, setCompareWith] = useState<FleetConfig | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetConfig(summary.id, controller.signal)
      .then(setConfig)
      .catch((err) => {
        if (!isAbortError(err)) onError(errorMessage(err));
      });
    return () => controller.abort();
  }, [summary.id, onError]);

  useEffect(() => {
    setCompareWith(null);
    if (compareId === null) return;
    const controller = new AbortController();
    api
      .fleetConfig(compareId, controller.signal)
      .then(setCompareWith)
      .catch((err) => {
        if (!isAbortError(err)) onError(errorMessage(err));
      });
    return () => controller.abort();
  }, [compareId, onError]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = () =>
    run(async () => {
      setConfig(
        await api.updateFleetConfig(summary.id, {
          profile,
          role: role.trim() || null,
          firmware_version: firmware.trim() || null,
          label: label.trim() || null,
        })
      );
      onNote(t('fleet_saved'));
      onChanged();
    });

  const saveTemplate = () =>
    run(async () => {
      const template = await api.saveFleetConfigAsTemplate(summary.id, templateName.trim(), null);
      setTemplateName('');
      onNote(t('fleet_config_template_saved', { name: template.name }));
      onChanged();
    });

  if (config === null) {
    return <p className="text-muted-foreground">{t('common_loading')}</p>;
  }

  return (
    <div className="space-y-3 rounded border border-border bg-background p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto]">
        <select
          data-testid="fleet-config-detail-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value as FleetConfigProfile)}
          aria-label={t('fleet_config_profile')}
          className={SELECT_CLASS}
        >
          {fittingProfiles(config.document).map((option) => (
            <option key={option} value={option}>
              {t(`fleet_config_profile_${option}`)}
            </option>
          ))}
        </select>
        <Input
          data-testid="fleet-config-detail-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_field_role')}
          aria-label={t('fleet_field_role')}
          className="h-9 text-xs"
        />
        <Input
          data-testid="fleet-config-detail-firmware"
          value={firmware}
          onChange={(e) => setFirmware(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_config_firmware')}
          aria-label={t('fleet_config_firmware')}
          className="h-9 text-xs"
        />
        <Input
          data-testid="fleet-config-detail-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_field_label')}
          aria-label={t('fleet_field_label')}
          className="h-9 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-config-detail-save"
          disabled={busy}
          onClick={() => void saveDetails()}
        >
          {t('fleet_save')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {others.length > 0 && (
          <select
            data-testid="fleet-config-compare"
            value={compareId ?? ''}
            onChange={(e) => setCompareId(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={t('fleet_config_compare')}
            className={SELECT_CLASS}
          >
            <option value="">{t('fleet_config_compare_none')}</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {t('fleet_config_compare_with', {
                  name:
                    other.label ??
                    formatDateTime(other.created_at * 1000, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                })}
              </option>
            ))}
          </select>
        )}
        <Input
          data-testid="fleet-config-template-name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_config_template_name')}
          aria-label={t('fleet_config_template_name')}
          className="h-9 max-w-xs text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-config-save-template"
          title={t('fleet_config_save_template_hint')}
          disabled={busy || templateName.trim() === ''}
          onClick={() => void saveTemplate()}
        >
          {t('fleet_config_save_template')}
        </Button>
      </div>

      {compareWith && <ConfigDiffView left={config.document} right={compareWith.document} />}
      <ConfigReportedView configId={summary.id} onError={onError} />
      <ConfigDocumentView document={config.document} />
    </div>
  );
}

function ConfigImportForm({
  assetId,
  vault,
  onImported,
  onError,
}: {
  assetId: number;
  vault: VaultState;
  onImported: (stored: number, leftOut: number) => void;
  onError: (error: string | null) => void;
}) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ConfigDocument | null>(null);
  const [kind, setKind] = useState<FleetConfigKind>('snapshot');
  const [profile, setProfile] = useState<FleetConfigProfile | 'auto'>('auto');
  const [role, setRole] = useState('');
  const [firmware, setFirmware] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const chooseFile = async (file: File | undefined) => {
    setParsed(null);
    setProfile('auto');
    onError(null);
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('not an object');
      }
      setParsed(data as ConfigDocument);
      setRole((current) => current || roleFromFilename(file.name));
    } catch {
      onError(t('fleet_config_not_json'));
    }
  };

  const submit = async () => {
    if (parsed === null) return;
    setBusy(true);
    onError(null);
    try {
      const input: FleetConfigImportInput = {
        document: parsed,
        kind,
        role: role.trim() || null,
        firmware_version: firmware.trim() || null,
        label: label.trim() || null,
      };
      if (profile !== 'auto') input.profile = profile;
      const result = await api.importFleetConfig(assetId, input);
      setParsed(null);
      setProfile('auto');
      setRole('');
      setFirmware('');
      setLabel('');
      if (fileInput.current) fileInput.current.value = '';
      onImported(result.secrets_stored, result.secrets_left_out);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">{t('fleet_config_import_title')}</p>
      <p className="text-xs text-muted-foreground">{t('fleet_config_import_hint')}</p>
      <p
        data-testid="fleet-config-vault-hint"
        className={vault === 'open' ? 'text-xs text-muted-foreground' : 'text-xs text-warning'}
      >
        {t(`fleet_config_vault_hint_${vault}`)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          data-testid="fleet-config-file"
          aria-label={t('fleet_config_file')}
          onChange={(e) => void chooseFile(e.target.files?.[0])}
          className="max-w-xs text-xs text-muted-foreground"
        />
        <select
          data-testid="fleet-config-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as FleetConfigKind)}
          aria-label={t('fleet_config_kind')}
          className={SELECT_CLASS}
        >
          <option value="snapshot">{t('fleet_config_kind_snapshot')}</option>
          <option value="desired">{t('fleet_config_kind_desired')}</option>
        </select>
        <select
          data-testid="fleet-config-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value as FleetConfigProfile | 'auto')}
          aria-label={t('fleet_config_profile')}
          className={SELECT_CLASS}
        >
          <option value="auto">{t('fleet_config_profile_auto')}</option>
          {(parsed ? fittingProfiles(parsed) : []).map((option) => (
            <option key={option} value={option}>
              {t(`fleet_config_profile_${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Input
          data-testid="fleet-config-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_field_role')}
          aria-label={t('fleet_field_role')}
          className="h-9 text-xs"
        />
        <Input
          data-testid="fleet-config-firmware"
          value={firmware}
          onChange={(e) => setFirmware(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_config_firmware')}
          aria-label={t('fleet_config_firmware')}
          className="h-9 text-xs"
        />
        <Input
          data-testid="fleet-config-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_field_label')}
          aria-label={t('fleet_field_label')}
          className="h-9 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-config-import"
          disabled={busy || parsed === null}
          onClick={() => void submit()}
        >
          {busy ? t('fleet_vault_working') : t('fleet_config_import')}
        </Button>
      </div>
    </div>
  );
}

function ConfigFromTemplateForm({
  assetId,
  templates,
  onCreated,
  onOpenTemplates,
  onError,
}: {
  assetId: number;
  templates: FleetConfigTemplate[];
  onCreated: () => void;
  onOpenTemplates: () => void;
  onError: (error: string | null) => void;
}) {
  const t = useT();
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const template = templates.find((candidate) => candidate.id === templateId) ?? null;

  const choose = (id: number | null) => {
    setTemplateId(id);
    const chosen = templates.find((candidate) => candidate.id === id);
    setValues(
      Object.fromEntries((chosen?.variables ?? []).map((item) => [item.name, item.default]))
    );
  };

  const submit = async () => {
    if (template === null) return;
    setBusy(true);
    onError(null);
    try {
      await api.createFleetConfigFromTemplate(assetId, template.id, values, label.trim() || null);
      setLabel('');
      onCreated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-foreground">
          {t('fleet_config_from_template_title')}
        </p>
        <button
          type="button"
          data-testid="fleet-config-open-templates"
          onClick={onOpenTemplates}
          className="text-xs text-primary hover:underline"
        >
          {t('fleet_config_open_templates')}
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('fleet_config_no_templates')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              data-testid="fleet-config-template"
              value={templateId ?? ''}
              onChange={(e) => choose(e.target.value === '' ? null : Number(e.target.value))}
              aria-label={t('fleet_config_template_pick')}
              className={SELECT_CLASS}
            >
              <option value="">{t('fleet_config_template_pick')}</option>
              {templates.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            {template && (
              <span className="text-xs text-muted-foreground">
                {t(`fleet_config_profile_${template.profile}`)}
              </span>
            )}
          </div>
          {template && (
            <>
              {template.description && (
                <p className="text-xs text-muted-foreground">{template.description}</p>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {template.variables.map((variable) => (
                  <label key={variable.name} className="block space-y-1 text-xs">
                    <span className="font-mono text-foreground">{variable.name}</span>
                    {variable.description && (
                      <span className="ml-2 text-muted-foreground">{variable.description}</span>
                    )}
                    {variable.type === 'boolean' ? (
                      <select
                        data-testid={`fleet-config-var-${variable.name}`}
                        value={values[variable.name] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [variable.name]: e.target.value }))
                        }
                        className={`${SELECT_CLASS} block w-full`}
                      >
                        <option value="">{t('fleet_config_bool_unset')}</option>
                        <option value="true">{t('fleet_config_bool_true')}</option>
                        <option value="false">{t('fleet_config_bool_false')}</option>
                      </select>
                    ) : (
                      <Input
                        data-testid={`fleet-config-var-${variable.name}`}
                        value={values[variable.name] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [variable.name]: e.target.value }))
                        }
                        maxLength={200}
                        inputMode={variable.type === 'number' ? 'decimal' : undefined}
                        className="h-9 text-xs"
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  data-testid="fleet-config-create-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={200}
                  placeholder={t('fleet_field_label')}
                  aria-label={t('fleet_field_label')}
                  className="h-9 max-w-xs text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="fleet-config-create"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {t('fleet_config_create')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FleetAssetConfigs({
  assetId,
  assetPublicKey = null,
  onOpenTemplates,
  onAssetChanged,
  onLogChanged,
}: {
  assetId: number;
  /** The asset's public key: a device on the USB cable is matched by it. */
  assetPublicKey?: string | null;
  /** Opens Tools > Fleet > Config templates. */
  onOpenTemplates: () => void;
  /** The asset itself changed (it took a device's public key). */
  onAssetChanged?: () => void;
  /** An apply wrote to the asset's log. */
  onLogChanged?: () => void;
}) {
  const t = useT();
  const { status } = useFleetVaultStatus();
  const tokenHeld = useFleetVaultUnlocked();
  const vault: VaultState = !status?.enabled
    ? 'off'
    : status.unlocked && tokenHeld
      ? 'open'
      : 'locked';
  const [configs, setConfigs] = useState<FleetConfigSummary[] | null>(null);
  const [templates, setTemplates] = useState<FleetConfigTemplate[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [rows, templateRows] = await Promise.all([
          api.fleetConfigs(assetId, signal),
          api.fleetConfigTemplates(signal),
        ]);
        setConfigs(rows);
        setTemplates(templateRows);
      } catch (err) {
        if (!isAbortError(err))
          setError(t('fleet_config_load_failed', { error: errorMessage(err) }));
      }
    },
    [assetId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const say = useCallback((next: string | null) => {
    setNote(next);
    setError(null);
    setLeftOut(0);
  }, []);
  const fail = useCallback((next: string | null) => {
    setError(next);
    setNote(null);
    setLeftOut(0);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setArmed(null);
    try {
      await action();
    } catch (err) {
      fail(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const exportConfig = (config: FleetConfigSummary, includeSecrets: boolean) =>
    run(async () => {
      const result = includeSecrets
        ? await vaultCall(() => api.exportFleetConfig(config.id, true))
        : await api.exportFleetConfig(config.id, false);
      const filename = configFilename(config.profile, config.role, result.document);
      downloadFleetFile(filename, 'application/json', [JSON.stringify(result.document, null, 2)]);
      const parts = [t('fleet_config_exported', { filename })];
      if (result.secrets_included > 0) {
        parts.push(t('fleet_config_exported_included', { count: result.secrets_included }));
      }
      if (result.secrets_left_out > 0) {
        parts.push(t('fleet_config_exported_left_out', { count: result.secrets_left_out }));
        if ('mqtt' in result.document) parts.push(t('fleet_config_exported_toolbox_note'));
      }
      say(parts.join(' '));
    });

  // Two clicks: the file that comes out holds private keys and passwords.
  const exportWithSecrets = (config: FleetConfigSummary) => {
    const key = `secrets-${config.id}`;
    if (armed !== key) {
      setArmed(key);
      return;
    }
    void exportConfig(config, true);
  };

  // Two clicks: a deleted config does not come back.
  const remove = (config: FleetConfigSummary) => {
    const key = `delete-${config.id}`;
    if (armed !== key) {
      setArmed(key);
      return;
    }
    void run(async () => {
      await api.deleteFleetConfig(config.id);
      if (openId === config.id) setOpenId(null);
      await load();
    });
  };

  const imported = (stored: number, notKept: number) => {
    const parts = [t('fleet_config_imported')];
    if (stored > 0) parts.push(t('fleet_config_imported_secrets', { count: stored }));
    say(parts.join(' '));
    setLeftOut(notKept);
    void load();
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid="fleet-configs"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('fleet_config_title')}
      </p>
      <p className="text-xs text-muted-foreground">{t('fleet_config_intro')}</p>

      {configs !== null && configs.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="fleet-configs-empty">
          {t('fleet_config_empty')}
        </p>
      )}
      {configs !== null && configs.length > 0 && (
        <ul className="divide-y divide-border text-xs">
          {configs.map((config) => (
            <li
              key={config.id}
              data-testid={`fleet-config-${config.id}`}
              className="space-y-2 py-2"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted-foreground">
                  {formatDateTime(config.created_at * 1000, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <span className="font-medium text-foreground">
                  {t(`fleet_config_kind_${config.kind}`)}
                </span>
                <span>{t(`fleet_config_profile_${config.profile}`)}</span>
                {config.label && <span className="text-foreground">{config.label}</span>}
                {config.role && <span className="text-muted-foreground">{config.role}</span>}
                {config.firmware_version && (
                  <span className="text-muted-foreground">{config.firmware_version}</span>
                )}
                <span className="text-muted-foreground">
                  {t(`fleet_config_source_${config.source}`)}
                </span>
                {config.secrets_stored > 0 && (
                  <span className="text-success">
                    {t('fleet_config_secrets_stored', { count: config.secrets_stored })}
                  </span>
                )}
                {config.secrets_missing > 0 && (
                  <span className="text-warning">
                    {t('fleet_config_secrets_missing', { count: config.secrets_missing })}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid={`fleet-config-open-${config.id}`}
                  onClick={() => setOpenId(openId === config.id ? null : config.id)}
                  className="text-primary hover:underline"
                >
                  {openId === config.id ? t('common_close') : t('fleet_config_open')}
                </button>
                <button
                  type="button"
                  data-testid={`fleet-config-export-${config.id}`}
                  disabled={busy}
                  title={t('fleet_config_export_hint')}
                  onClick={() => void exportConfig(config, false)}
                  className="text-primary hover:underline"
                >
                  {t('fleet_config_export')}
                </button>
                {vault === 'open' && config.secrets_stored > 0 && (
                  <button
                    type="button"
                    data-testid={`fleet-config-export-secrets-${config.id}`}
                    disabled={busy}
                    title={t('fleet_config_export_secrets_hint')}
                    onClick={() => exportWithSecrets(config)}
                    className="text-primary hover:underline"
                  >
                    {armed === `secrets-${config.id}`
                      ? t('fleet_config_export_secrets_confirm')
                      : t('fleet_config_export_secrets')}
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`fleet-config-delete-${config.id}`}
                  disabled={busy}
                  title={t('fleet_config_delete_hint')}
                  onClick={() => remove(config)}
                  className="ml-auto text-muted-foreground hover:text-destructive"
                >
                  {armed === `delete-${config.id}` ? t('fleet_delete_confirm') : t('common_delete')}
                </button>
              </div>
              {openId === config.id && (
                <ConfigDetail
                  summary={config}
                  others={configs.filter((other) => other.id !== config.id)}
                  onChanged={() => void load()}
                  onNote={say}
                  onError={fail}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="text-xs text-success" data-testid="fleet-config-note">
          {note}
        </p>
      )}
      {leftOut > 0 && (
        <p className="text-xs font-medium text-warning" data-testid="fleet-config-left-out">
          {t('fleet_config_left_out', { count: leftOut })}{' '}
          {t(vault === 'off' ? 'fleet_config_left_out_off' : 'fleet_config_left_out_locked')}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <ConfigImportForm assetId={assetId} vault={vault} onImported={imported} onError={fail} />
      <ConfigFromTemplateForm
        assetId={assetId}
        templates={templates}
        onCreated={() => {
          say(t('fleet_config_created'));
          void load();
        }}
        onOpenTemplates={onOpenTemplates}
        onError={fail}
      />
      <FleetUsbDevice
        assetId={assetId}
        assetPublicKey={assetPublicKey}
        configs={configs ?? []}
        vault={vault}
        onStored={() => void load()}
        onAssetChanged={() => onAssetChanged?.()}
        onLogChanged={() => onLogChanged?.()}
      />
    </div>
  );
}
