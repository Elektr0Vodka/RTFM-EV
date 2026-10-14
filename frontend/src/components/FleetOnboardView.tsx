/**
 * Tools > Fleet > Onboard a device (#fleet/onboard): one guided flow for a
 * repeater or room server on a USB cable in this browser (plan 32, Phase 6).
 *
 * Connect and read > find the asset by public key, or create one (keeping the
 * device's key, or with a new key made in the vault) > store the "before"
 * snapshot > make the wanted config from a template > preview and apply >
 * read back and compare > set the status and write the log entry.
 *
 * Every step is one the asset page can do by hand; this only strings them
 * together. It applies through FleetApplyPlanView, so the rules are the same:
 * everything shown first, a confirm, one command at a time with a read-back,
 * the private key and the radio each behind their own tick (off every time).
 * Nothing here goes over the radio of this app, and the device is never
 * restarted from here.
 */
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import type {
  FleetApplyPlan,
  FleetAsset,
  FleetConfigTemplate,
  FleetDeviceReadPreview,
  FleetDeviceReplies,
} from '../types';
import { useFleetVaultUnlocked } from '../utils/fleetVault';
import { readDevice, type ApplyOutcome } from '../utils/fleetUsb';
import { SerialCli, webSerial, webSerialStatus } from '../utils/serialCli';
import { FleetApplyPlanView } from './fleet/FleetApplyPlanView';
import { FleetVaultGate, useFleetVaultStatus } from './fleet/FleetVault';
import { Button } from './ui/button';
import { Input } from './ui/input';

type Busy = 'connect' | 'read' | 'asset' | 'store' | 'config' | 'plan' | 'apply' | 'finish' | null;
type KeyMode = 'device' | 'new';
type CompareResult = 'same' | 'restart' | 'differs';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground';
const TOOLBOX_PROFILES = ['stock', 'dmc_repeater', 'dmc_observer'];
// A generated key avoids the first byte of every node this app knows.
const NEW_KEY_FREE_BYTES = 1;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Section({
  number,
  title,
  testId,
  children,
}: {
  number: number;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-card p-4 text-xs"
      data-testid={testId}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {number}. {title}
      </p>
      {children}
    </section>
  );
}

export function FleetOnboardView({
  onBack,
  onOpenAsset,
}: {
  onBack: () => void;
  onOpenAsset: (assetId: number) => void;
}) {
  const t = useT();
  const support = useMemo(() => webSerialStatus(), []);
  const { status: vaultStatus, reload: reloadVault } = useFleetVaultStatus();
  const tokenHeld = useFleetVaultUnlocked();
  const vaultOpen = Boolean(vaultStatus?.enabled && vaultStatus.unlocked && tokenHeld);

  const cli = useRef<SerialCli | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<{
    replies: FleetDeviceReplies;
    read: FleetDeviceReadPreview;
  } | null>(null);

  // Step 2: the asset.
  const [match, setMatch] = useState<FleetAsset | null | undefined>(undefined);
  const [asset, setAsset] = useState<FleetAsset | null>(null);
  const [keyMode, setKeyMode] = useState<KeyMode>('device');
  const [newLabel, setNewLabel] = useState('');
  // Step 3: the snapshot before.
  const [beforeDone, setBeforeDone] = useState(false);
  // Step 4: the wanted config.
  const [templates, setTemplates] = useState<FleetConfigTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [configId, setConfigId] = useState<number | null>(null);
  const [nothingToApply, setNothingToApply] = useState(false);
  // Step 5: apply and compare.
  const [allowKey, setAllowKey] = useState(false);
  const [allowRadio, setAllowRadio] = useState(false);
  const [plan, setPlan] = useState<FleetApplyPlan | null>(null);
  const [planVersion, setPlanVersion] = useState(0);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const [compare, setCompare] = useState<{ result: CompareResult; count: number } | null>(null);
  const [afterStored, setAfterStored] = useState(false);
  // Step 6: finish.
  const [status, setStatus] = useState<'deployed' | 'in_stock'>('deployed');
  const [done, setDone] = useState(false);

  const usable = useMemo(
    () => templates.filter((template) => TOOLBOX_PROFILES.includes(template.profile)),
    [templates]
  );
  const template = usable.find((item) => item.id === templateId) ?? null;
  const identity = read?.read.identity ?? null;

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetConfigTemplates(controller.signal)
      .then(setTemplates)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Close the port when the page goes away.
  useEffect(
    () => () => {
      void cli.current?.close().catch(() => undefined);
      cli.current = null;
    },
    []
  );

  const run = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const freshRead = async () => {
    if (!cli.current) throw new Error(t('fleet_usb_not_connected'));
    setProgress(0);
    const result = await readDevice(cli.current, setProgress);
    setRead(result);
    return result;
  };

  const connect = () =>
    run('connect', async () => {
      const serial = webSerial();
      if (!serial) return;
      let port;
      try {
        port = await serial.requestPort();
      } catch {
        // No port chosen in the browser's dialog.
        return;
      }
      const next = new SerialCli(port);
      await next.open();
      cli.current = next;
      setConnected(true);
    });

  const readFirst = () =>
    run('read', async () => {
      const result = await freshRead();
      const key = result.read.identity.public_key;
      setNewLabel(result.read.identity.name ?? '');
      setMatch(key ? await api.fleetAssetForKey(key) : null);
    });

  const createAsset = () =>
    run('asset', async () => {
      if (!identity) return;
      const fields = {
        label: newLabel.trim() || identity.name || null,
        ...(keyMode === 'device' ? { public_key: identity.public_key } : {}),
        role: identity.role,
        model: identity.board,
        status: 'in_stock' as const,
      };
      let created = await api.createFleetAsset(fields);
      if (keyMode === 'new') {
        created = (await api.generateFleetKey(created.id, '', NEW_KEY_FREE_BYTES)).asset;
      }
      setAsset(created);
    });

  // The device is this asset (same key): its settings can be stored on it.
  const deviceIsAsset = Boolean(asset && identity && asset.public_key === identity.public_key);

  const storeBefore = () =>
    run('store', async () => {
      if (!asset || !read) return;
      await api.storeFleetDeviceRead(
        asset.id,
        read.replies,
        t('fleet_onboard_before_label'),
        false
      );
      setBeforeDone(true);
    });

  const makeConfig = () =>
    run('config', async () => {
      if (!asset) return;
      const withKey = keyMode === 'new';
      if (template === null && !withKey) {
        setNothingToApply(true);
        return;
      }
      const filled: Record<string, string> = {};
      for (const variable of template?.variables ?? []) {
        filled[variable.name] = values[variable.name] ?? variable.default;
      }
      const config = await api.createFleetConfigFromTemplate(
        asset.id,
        template?.id ?? null,
        filled,
        t('fleet_onboard_config_label'),
        withKey
      );
      setConfigId(config.id);
    });

  const forgetPlan = () => {
    setPlan(null);
    setOutcome(null);
    setCompare(null);
  };

  const prepare = () =>
    run('plan', async () => {
      if (configId === null) return;
      forgetPlan();
      const current = await freshRead();
      setPlan(await api.fleetConfigApplyPlan(configId, current.replies, allowKey, allowRadio));
      setPlanVersion((version) => version + 1);
    });

  const compareNow = () =>
    run('plan', async () => {
      if (configId === null) return;
      setAfterStored(false);
      const current = await freshRead();
      const check = await api.fleetConfigApplyPlan(configId, current.replies, allowKey, allowRadio);
      const onlyKey =
        check.steps.length > 0 && check.steps.every((step) => step.path[1] === 'prv.key');
      setCompare({
        result: check.steps.length === 0 ? 'same' : check.rekey && onlyKey ? 'restart' : 'differs',
        count: check.steps.length,
      });
    });

  const storeAfter = () =>
    run('store', async () => {
      if (!asset || !read) return;
      await api.storeFleetDeviceRead(asset.id, read.replies, t('fleet_onboard_after_label'), false);
      setAfterStored(true);
    });

  const finish = () =>
    run('finish', async () => {
      if (!asset) return;
      if (asset.status !== status) {
        setAsset(await api.updateFleetAsset(asset.id, { status }));
      }
      await api.addFleetAssetEvent(asset.id, {
        kind: 'note',
        summary: t('fleet_onboard_log_summary', {
          name: identity?.name ?? asset.label ?? '',
          firmware: identity?.firmware_version ?? '',
          board: identity?.board ?? '',
        }),
        detail: null,
        actor: null,
      });
      setDone(true);
    });

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {t('nav_fleet')}
      </Button>
      <h2 className="text-sm font-semibold text-foreground">{t('fleet_onboard_title')}</h2>
    </div>
  );

  if (support !== 'ok') {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground" data-testid="fleet-onboard-unsupported">
            {t(`fleet_usb_unsupported_${support}`)}
          </p>
        </div>
      </div>
    );
  }

  const reachedConfig = beforeDone;
  const reachedApply = configId !== null;
  const reachedFinish = nothingToApply || outcome !== null;

  return (
    <div className="flex h-full flex-col" data-testid="fleet-onboard">
      {header}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground">{t('fleet_onboard_intro')}</p>

        <Section
          number={1}
          title={t('fleet_onboard_step_connect')}
          testId="fleet-onboard-connect-step"
        >
          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <Button
                size="sm"
                data-testid="fleet-onboard-connect"
                disabled={busy !== null}
                onClick={() => void connect()}
              >
                {t('fleet_usb_connect')}
              </Button>
            ) : (
              !read && (
                <Button
                  size="sm"
                  data-testid="fleet-onboard-read"
                  disabled={busy !== null}
                  onClick={() => void readFirst()}
                >
                  {t('fleet_usb_read')}
                </Button>
              )
            )}
            {(busy === 'read' || busy === 'plan') && (
              <span className="text-muted-foreground">
                {t('fleet_usb_reading', { count: progress })}
              </span>
            )}
          </div>
          {identity && (
            <dl
              className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-0.5"
              data-testid="fleet-onboard-identity"
            >
              <dt className="text-muted-foreground">{t('fleet_usb_name')}</dt>
              <dd>{identity.name ?? ''}</dd>
              <dt className="text-muted-foreground">{t('fleet_usb_role')}</dt>
              <dd>{identity.role ?? ''}</dd>
              <dt className="text-muted-foreground">{t('fleet_usb_firmware')}</dt>
              <dd>{identity.firmware_version ?? ''}</dd>
              <dt className="text-muted-foreground">{t('fleet_usb_board')}</dt>
              <dd>{identity.board ?? ''}</dd>
              <dt className="text-muted-foreground">{t('fleet_usb_public_key')}</dt>
              <dd className="break-all font-mono">{identity.public_key ?? ''}</dd>
            </dl>
          )}
        </Section>

        {read && match !== undefined && (
          <Section
            number={2}
            title={t('fleet_onboard_step_asset')}
            testId="fleet-onboard-asset-step"
          >
            {asset ? (
              <p className="text-foreground" data-testid="fleet-onboard-asset-chosen">
                {t('fleet_onboard_asset_chosen', { label: asset.label ?? `#${asset.id}` })}
              </p>
            ) : match ? (
              <div className="space-y-2">
                <p data-testid="fleet-onboard-match">
                  {t('fleet_onboard_match', { label: match.label ?? `#${match.id}` })}
                </p>
                <Button
                  size="sm"
                  data-testid="fleet-onboard-use-asset"
                  disabled={busy !== null}
                  onClick={() => setAsset(match)}
                >
                  {t('fleet_onboard_use_asset')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p>{t('fleet_onboard_no_match')}</p>
                <Input
                  data-testid="fleet-onboard-new-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  aria-label={t('fleet_field_label')}
                  placeholder={t('fleet_field_label')}
                  className="h-9 max-w-xs text-xs"
                />
                <fieldset className="space-y-1">
                  <legend className="text-muted-foreground">{t('fleet_onboard_key_title')}</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="fleet-onboard-key"
                      data-testid="fleet-onboard-key-device"
                      checked={keyMode === 'device'}
                      onChange={() => setKeyMode('device')}
                    />
                    {t('fleet_onboard_key_device')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="fleet-onboard-key"
                      data-testid="fleet-onboard-key-new"
                      checked={keyMode === 'new'}
                      disabled={!vaultOpen}
                      onChange={() => setKeyMode('new')}
                    />
                    {t('fleet_onboard_key_new')}
                  </label>
                  {!vaultOpen && (
                    <p className="text-muted-foreground">
                      {t('fleet_onboard_key_new_needs_vault')}
                    </p>
                  )}
                </fieldset>
                {vaultStatus?.enabled && !vaultOpen && (
                  <FleetVaultGate status={vaultStatus} onChanged={reloadVault}>
                    <span />
                  </FleetVaultGate>
                )}
                <Button
                  size="sm"
                  data-testid="fleet-onboard-create"
                  disabled={busy !== null || (keyMode === 'new' && !vaultOpen)}
                  onClick={() => void createAsset()}
                >
                  {t('fleet_onboard_create')}
                </Button>
              </div>
            )}
          </Section>
        )}

        {asset && (
          <Section
            number={3}
            title={t('fleet_onboard_step_before')}
            testId="fleet-onboard-before-step"
          >
            {beforeDone ? (
              <p className="text-muted-foreground">{t('fleet_onboard_before_done')}</p>
            ) : deviceIsAsset ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="w-full">{t('fleet_onboard_before_hint')}</p>
                <Button
                  size="sm"
                  data-testid="fleet-onboard-store-before"
                  disabled={busy !== null}
                  onClick={() => void storeBefore()}
                >
                  {t('fleet_onboard_store_before')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="fleet-onboard-skip-before"
                  disabled={busy !== null}
                  onClick={() => setBeforeDone(true)}
                >
                  {t('fleet_onboard_skip')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-warning" data-testid="fleet-onboard-before-skipped">
                  {t('fleet_onboard_before_new_key')}
                </p>
                <Button
                  size="sm"
                  data-testid="fleet-onboard-continue-before"
                  onClick={() => setBeforeDone(true)}
                >
                  {t('fleet_onboard_continue')}
                </Button>
              </div>
            )}
          </Section>
        )}

        {asset && reachedConfig && (
          <Section
            number={4}
            title={t('fleet_onboard_step_config')}
            testId="fleet-onboard-config-step"
          >
            {configId !== null ? (
              <p className="text-muted-foreground">{t('fleet_onboard_config_done')}</p>
            ) : nothingToApply ? (
              <p className="text-muted-foreground" data-testid="fleet-onboard-nothing-to-apply">
                {t('fleet_onboard_nothing_to_apply')}
              </p>
            ) : (
              <div className="space-y-2">
                <select
                  data-testid="fleet-onboard-template-select"
                  value={templateId ?? ''}
                  onChange={(e) => {
                    setTemplateId(e.target.value ? Number(e.target.value) : null);
                    setValues({});
                  }}
                  aria-label={t('fleet_onboard_template')}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('fleet_onboard_no_template')}</option>
                  {usable.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {template?.variables.map((variable) => (
                  <label key={variable.name} className="flex flex-wrap items-center gap-2">
                    <span className="w-40 font-mono text-muted-foreground">{variable.name}</span>
                    <Input
                      data-testid={`fleet-onboard-var-${variable.name}`}
                      value={values[variable.name] ?? variable.default}
                      onChange={(e) =>
                        setValues((current) => ({ ...current, [variable.name]: e.target.value }))
                      }
                      placeholder={variable.description}
                      className="h-9 max-w-xs text-xs"
                    />
                  </label>
                ))}
                {keyMode === 'new' && (
                  <p className="text-muted-foreground">{t('fleet_onboard_config_with_key')}</p>
                )}
                <Button
                  size="sm"
                  data-testid="fleet-onboard-make-config"
                  disabled={busy !== null}
                  onClick={() => void makeConfig()}
                >
                  {t('fleet_onboard_make_config')}
                </Button>
              </div>
            )}
          </Section>
        )}

        {asset && reachedApply && configId !== null && (
          <Section
            number={5}
            title={t('fleet_onboard_step_apply')}
            testId="fleet-onboard-apply-step"
          >
            {keyMode === 'new' && (
              <p className="font-medium text-warning" data-testid="fleet-onboard-key-hint">
                {t('fleet_onboard_key_hint')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="fleet-onboard-allow-key"
                  checked={allowKey}
                  onChange={(e) => {
                    setAllowKey(e.target.checked);
                    forgetPlan();
                  }}
                />
                {t('fleet_usb_allow_key')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="fleet-onboard-allow-radio"
                  checked={allowRadio}
                  onChange={(e) => {
                    setAllowRadio(e.target.checked);
                    forgetPlan();
                  }}
                />
                {t('fleet_usb_allow_radio')}
              </label>
              <Button
                size="sm"
                variant="outline"
                data-testid="fleet-onboard-prepare"
                disabled={busy !== null}
                onClick={() => void prepare()}
              >
                {t('fleet_usb_prepare')}
              </Button>
            </div>
            <p className="text-muted-foreground">{t('fleet_usb_apply_hint')}</p>
            {plan && (
              <FleetApplyPlanView
                key={planVersion}
                plan={plan}
                configId={configId}
                cli={cli.current}
                disabled={busy !== null}
                onRunning={(running) => setBusy(running ? 'apply' : null)}
                onFinished={setOutcome}
                onError={setError}
              />
            )}
            {outcome && (
              <div className="space-y-2 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="fleet-onboard-compare"
                  disabled={busy !== null}
                  onClick={() => void compareNow()}
                >
                  {t('fleet_onboard_compare')}
                </Button>
                {compare && (
                  <p
                    data-testid="fleet-onboard-compare-result"
                    data-result={compare.result}
                    className={compare.result === 'same' ? 'text-success' : 'text-warning'}
                  >
                    {t(`fleet_onboard_compare_${compare.result}`, { count: compare.count })}
                  </p>
                )}
                {compare?.result === 'same' && deviceIsAsset && !afterStored && (
                  <Button
                    size="sm"
                    data-testid="fleet-onboard-store-after"
                    disabled={busy !== null}
                    onClick={() => void storeAfter()}
                  >
                    {t('fleet_onboard_store_after')}
                  </Button>
                )}
                {afterStored && (
                  <p className="text-muted-foreground">{t('fleet_onboard_after_done')}</p>
                )}
              </div>
            )}
          </Section>
        )}

        {asset && reachedFinish && (
          <Section
            number={6}
            title={t('fleet_onboard_step_finish')}
            testId="fleet-onboard-finish-step"
          >
            {done ? (
              <div className="space-y-2" data-testid="fleet-onboard-done">
                <p className="text-success">{t('fleet_onboard_done')}</p>
                <Button
                  size="sm"
                  data-testid="fleet-onboard-open-asset"
                  onClick={() => onOpenAsset(asset.id)}
                >
                  {t('fleet_onboard_open_asset')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  data-testid="fleet-onboard-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'deployed' | 'in_stock')}
                  aria-label={t('fleet_field_status')}
                  className={SELECT_CLASS}
                >
                  <option value="deployed">{t('fleet_status_deployed')}</option>
                  <option value="in_stock">{t('fleet_status_in_stock')}</option>
                </select>
                <Button
                  size="sm"
                  data-testid="fleet-onboard-finish"
                  disabled={busy !== null}
                  onClick={() => void finish()}
                >
                  {t('fleet_onboard_finish')}
                </Button>
              </div>
            )}
          </Section>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
