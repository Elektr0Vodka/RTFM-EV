/**
 * Fleet asset page > Configs > USB cable: read a repeater or room server that
 * is plugged into this PC, and apply a stored config to it (plan 32, Phase 3).
 *
 * The browser talks to the device (Web Serial: Chrome or Edge, on localhost or
 * HTTPS); the server plans and checks. Applying always shows the differences
 * and every command first and needs a confirm; then it sends one command at a
 * time, reads the setting back, and stops at the first that is not as
 * expected. The private key and the radio settings each need their own tick.
 * Nothing here goes over the radio of this app, and the device is never
 * restarted from here (it sends an advert when it starts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import type {
  FleetApplyPlan,
  FleetConfigSummary,
  FleetDeviceReadPreview,
  FleetDeviceReadStoreResult,
  FleetDeviceReplies,
} from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import {
  readDevice,
  runApply,
  type ApplyOutcome,
  type ApplyStepResult,
} from '../../utils/fleetUsb';
import { SerialCli, webSerial, webSerialStatus } from '../../utils/serialCli';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type VaultState = 'off' | 'locked' | 'open';
type Busy = 'connect' | 'read' | 'store' | 'plan' | 'apply' | null;

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground';
const TOOLBOX_PROFILES = ['stock', 'dmc_repeater', 'dmc_observer'];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shortKey(key: string | null): string {
  return key ? `${key.slice(0, 12)}…` : '';
}

function pathText(path: (string | number)[]): string {
  return path.join('/');
}

export function FleetUsbDevice({
  assetId,
  assetPublicKey,
  configs,
  vault,
  onStored,
  onAssetChanged,
  onLogChanged,
}: {
  assetId: number;
  assetPublicKey: string | null;
  configs: FleetConfigSummary[];
  vault: VaultState;
  /** A read was stored as a config: the list must be read again. */
  onStored: (result: FleetDeviceReadStoreResult) => void;
  /** The asset took the device's public key. */
  onAssetChanged: () => void;
  /** An apply wrote to the asset's log. */
  onLogChanged: () => void;
}) {
  const t = useT();
  const support = useMemo(() => webSerialStatus(), []);
  const cli = useRef<SerialCli | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [read, setRead] = useState<{
    replies: FleetDeviceReplies;
    read: FleetDeviceReadPreview;
  } | null>(null);
  const [label, setLabel] = useState('');
  const [setKey, setSetKey] = useState(false);
  const applicable = useMemo(
    () => configs.filter((config) => TOOLBOX_PROFILES.includes(config.profile)),
    [configs]
  );
  const [configId, setConfigId] = useState<number | null>(null);
  const [allowKey, setAllowKey] = useState(false);
  const [allowRadio, setAllowRadio] = useState(false);
  const [plan, setPlan] = useState<FleetApplyPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState<ApplyStepResult[]>([]);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);

  const chosen = configId ?? applicable[0]?.id ?? null;

  // Close the port when the page goes away.
  useEffect(
    () => () => {
      void cli.current?.close().catch(() => undefined);
      cli.current = null;
    },
    []
  );

  const forgetPlan = useCallback(() => {
    setPlan(null);
    setConfirmed(false);
    setResults([]);
    setOutcome(null);
  }, []);

  const run = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
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

  const disconnect = () =>
    run(null, async () => {
      const current = cli.current;
      cli.current = null;
      setConnected(false);
      setRead(null);
      forgetPlan();
      await current?.close();
    });

  const freshRead = async () => {
    if (!cli.current) throw new Error(t('fleet_usb_not_connected'));
    setProgress(0);
    const result = await readDevice(cli.current, setProgress);
    setRead(result);
    return result;
  };

  const readNow = () =>
    run('read', async () => {
      forgetPlan();
      await freshRead();
    });

  const match: 'same' | 'no_key' | 'other' | null = read
    ? assetPublicKey === null
      ? 'no_key'
      : read.read.identity.public_key === assetPublicKey
        ? 'same'
        : 'other'
    : null;
  const canStore = match === 'same' || (match === 'no_key' && setKey);

  const store = () =>
    run('store', async () => {
      if (!read) return;
      const result = await api.storeFleetDeviceRead(
        assetId,
        read.replies,
        label.trim() || null,
        match === 'no_key' && setKey
      );
      setLabel('');
      setSetKey(false);
      const parts = [t('fleet_usb_stored')];
      if (result.secrets_stored > 0) {
        parts.push(t('fleet_config_imported_secrets', { count: result.secrets_stored }));
      }
      if (result.secrets_left_out > 0) {
        parts.push(t('fleet_config_left_out', { count: result.secrets_left_out }));
      }
      setNote(parts.join(' '));
      onStored(result);
      if (result.public_key_set) onAssetChanged();
    });

  const prepare = () =>
    run('plan', async () => {
      if (chosen === null) return;
      forgetPlan();
      // Always against a fresh read: the device may have changed since.
      const current = await freshRead();
      setPlan(await api.fleetConfigApplyPlan(chosen, current.replies, allowKey, allowRadio));
    });

  const send = () =>
    run('apply', async () => {
      if (!plan || !cli.current || chosen === null || !confirmed) return;
      setResults([]);
      const done = await runApply(cli.current, chosen, plan, (result) =>
        setResults((current) => [...current, result])
      );
      setOutcome(done);
      if (done.logged) onLogChanged();
    });

  if (support !== 'ok') {
    return (
      <div className="space-y-1 border-t border-border pt-3" data-testid="fleet-usb">
        <p className="text-xs font-medium text-foreground">{t('fleet_usb_title')}</p>
        <p className="text-xs text-muted-foreground" data-testid="fleet-usb-unsupported">
          {t(`fleet_usb_unsupported_${support}`)}
        </p>
      </div>
    );
  }

  const changes = plan?.rows.filter((row) => row.status === 'change') ?? [];
  const skips = plan?.rows.filter((row) => row.status === 'skip') ?? [];
  const same = plan ? plan.rows.length - changes.length - skips.length : 0;

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="fleet-usb">
      <p className="text-xs font-medium text-foreground">{t('fleet_usb_title')}</p>
      <p className="text-xs text-muted-foreground">{t('fleet_usb_intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        {!connected ? (
          <Button
            size="sm"
            data-testid="fleet-usb-connect"
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            {t('fleet_usb_connect')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              data-testid="fleet-usb-read"
              disabled={busy !== null}
              onClick={() => void readNow()}
            >
              {t('fleet_usb_read')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="fleet-usb-disconnect"
              disabled={busy === 'apply'}
              onClick={() => void disconnect()}
            >
              {t('fleet_usb_disconnect')}
            </Button>
          </>
        )}
        {(busy === 'read' || busy === 'plan') && (
          <span className="text-xs text-muted-foreground" data-testid="fleet-usb-progress">
            {t('fleet_usb_reading', { count: progress })}
          </span>
        )}
      </div>

      {read && (
        <div className="space-y-2 rounded border border-border bg-background p-3 text-xs">
          <dl
            className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-0.5"
            data-testid="fleet-usb-identity"
          >
            <dt className="text-muted-foreground">{t('fleet_usb_name')}</dt>
            <dd>{read.read.identity.name ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_role')}</dt>
            <dd>{read.read.identity.role ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_firmware')}</dt>
            <dd>{read.read.identity.firmware_version ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_board')}</dt>
            <dd>{read.read.identity.board ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_public_key')}</dt>
            <dd className="break-all font-mono">{read.read.identity.public_key ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_config_profile')}</dt>
            <dd>{t(`fleet_config_profile_${read.read.profile}`)}</dd>
          </dl>
          <p
            data-testid="fleet-usb-match"
            data-match={match ?? ''}
            className={match === 'same' ? 'text-success' : 'font-medium text-warning'}
          >
            {t(`fleet_usb_match_${match}`, { key: shortKey(read.read.identity.public_key) })}
          </p>
          {read.read.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-warning" data-testid="fleet-usb-warnings">
              {read.read.warnings.map((warning) => (
                <li key={warning}>
                  {warning.startsWith('hidden:')
                    ? t('fleet_usb_warning_hidden', { key: warning.slice(7) })
                    : t(`fleet_usb_warning_${warning}`)}
                </li>
              ))}
            </ul>
          )}
          {read.read.secrets > 0 && (
            <p className={vault === 'open' ? 'text-muted-foreground' : 'text-warning'}>
              {t('fleet_usb_secrets', { count: read.read.secrets })}{' '}
              {t(`fleet_config_vault_hint_${vault}`)}
            </p>
          )}
          {match === 'no_key' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="fleet-usb-set-key"
                checked={setKey}
                onChange={(e) => setSetKey(e.target.checked)}
              />
              {t('fleet_usb_set_key')}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              data-testid="fleet-usb-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('fleet_config_label')}
              aria-label={t('fleet_config_label')}
              className="h-9 max-w-xs text-xs"
            />
            <Button
              size="sm"
              data-testid="fleet-usb-store"
              disabled={!canStore || busy !== null}
              onClick={() => void store()}
            >
              {t('fleet_usb_store')}
            </Button>
          </div>
        </div>
      )}

      {connected && (
        <div className="space-y-2 rounded border border-border bg-background p-3 text-xs">
          <p className="font-medium text-foreground">{t('fleet_usb_apply_title')}</p>
          {applicable.length === 0 ? (
            <p className="text-muted-foreground" data-testid="fleet-usb-no-configs">
              {t('fleet_usb_no_configs')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  data-testid="fleet-usb-apply-config"
                  value={chosen ?? ''}
                  onChange={(e) => {
                    setConfigId(Number(e.target.value));
                    forgetPlan();
                  }}
                  aria-label={t('fleet_usb_apply_config')}
                  className={SELECT_CLASS}
                >
                  {applicable.map((config) => (
                    <option key={config.id} value={config.id}>
                      {[
                        t(`fleet_config_kind_${config.kind}`),
                        config.label,
                        formatDateTime(config.created_at * 1000, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="fleet-usb-allow-key"
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
                    data-testid="fleet-usb-allow-radio"
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
                  data-testid="fleet-usb-prepare"
                  disabled={busy !== null}
                  onClick={() => void prepare()}
                >
                  {t('fleet_usb_prepare')}
                </Button>
              </div>
              <p className="text-muted-foreground">{t('fleet_usb_apply_hint')}</p>
            </>
          )}

          {plan && (
            <div className="space-y-2" data-testid="fleet-usb-plan">
              {plan.rekey && <p className="font-medium text-warning">{t('fleet_usb_rekey')}</p>}
              {plan.steps.length === 0 ? (
                <p className="text-muted-foreground" data-testid="fleet-usb-nothing">
                  {t('fleet_usb_nothing')}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded border border-border">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-2 py-1 font-medium">{t('fleet_config_diff_key')}</th>
                          <th className="px-2 py-1 font-medium">{t('fleet_usb_configured')}</th>
                          <th className="px-2 py-1 font-medium">{t('fleet_usb_on_device')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((row) => (
                          <tr
                            key={pathText(row.path)}
                            className="border-b border-border last:border-0"
                          >
                            <td className="break-all px-2 py-1 font-mono text-muted-foreground">
                              {pathText(row.path)}
                            </td>
                            <td className="whitespace-pre-wrap break-all px-2 py-1 font-mono">
                              {row.configured}
                            </td>
                            <td className="whitespace-pre-wrap break-all px-2 py-1 font-mono">
                              {row.device}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="font-medium text-foreground">
                    {t('fleet_usb_commands', { count: plan.steps.length })}
                  </p>
                  <ol className="list-decimal space-y-0.5 pl-6" data-testid="fleet-usb-commands">
                    {plan.steps.map((step) => {
                      const result = results.find((item) => item.step.index === step.index);
                      return (
                        <li key={step.index} data-testid={`fleet-usb-step-${step.index}`}>
                          <span className="font-mono">{step.display}</span>
                          {step.reboot && (
                            <span className="ml-2 text-warning">
                              {t('fleet_usb_needs_restart')}
                            </span>
                          )}
                          {result && (
                            <span
                              className={result.ok ? 'ml-2 text-success' : 'ml-2 text-destructive'}
                            >
                              {result.ok
                                ? t('fleet_usb_step_ok')
                                : t(`fleet_usb_check_${result.reason ?? 'unexpected_reply'}`)}
                              {result.reply && ` (${result.reply})`}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
              {skips.length > 0 && (
                <ul className="list-disc pl-4 text-muted-foreground" data-testid="fleet-usb-skips">
                  {skips.map((row) => (
                    <li key={pathText(row.path)}>
                      <span className="font-mono">{pathText(row.path)}</span>:{' '}
                      {t(`fleet_usb_skip_${row.reason ?? 'bad_value'}`)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground">{t('fleet_usb_same', { count: same })}</p>
              {plan.reboot && <p className="text-warning">{t('fleet_usb_restart_hint')}</p>}
              {plan.steps.length > 0 && !outcome && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      data-testid="fleet-usb-confirm"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    {t('fleet_usb_confirm', { count: plan.steps.length })}
                  </label>
                  <Button
                    size="sm"
                    data-testid="fleet-usb-send"
                    disabled={!confirmed || busy !== null}
                    onClick={() => void send()}
                  >
                    {t('fleet_usb_send', { count: plan.steps.length })}
                  </Button>
                </div>
              )}
              {outcome && (
                <p
                  data-testid="fleet-usb-outcome"
                  className={outcome.completed ? 'text-success' : 'font-medium text-destructive'}
                >
                  {outcome.completed
                    ? t('fleet_usb_done', {
                        sent: outcome.results.length,
                        total: plan.steps.length,
                      })
                    : t('fleet_usb_stopped', {
                        number: (outcome.stopped?.index ?? 0) + 1,
                        reason: t(
                          `fleet_usb_check_${outcome.stopped?.reason ?? 'unexpected_reply'}`
                        ),
                      })}{' '}
                  {outcome.logged ? t('fleet_usb_logged') : t('fleet_usb_not_logged')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {note && (
        <p className="text-xs text-success" data-testid="fleet-usb-note">
          {note}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
