/**
 * Fleet asset page > Configs > Web config (LAN): read a DMC observer through
 * its web config and apply a stored config to it (plan 32, Phase 4).
 *
 * The server talks to the node at the LAN address typed here, with the
 * node's admin password from the key vault; this page only gives the address
 * and runs the steps in turn. Applying uses FleetApplyPlanView, so the rules
 * are the cable's: everything shown first, a confirm, one command at a time
 * with a read-back, the radio behind its own tick. The private key is never
 * set over the LAN.
 *
 * Starting and stopping the web config sends one CLI command to the node over
 * the radio; each needs a second, confirming click.
 */
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import type { FleetApplyPlan, FleetConfigSummary, FleetLanReadResult } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FleetApplyPlanView } from './FleetApplyPlanView';

type VaultState = 'off' | 'locked' | 'open';
type Busy = 'toggle' | 'read' | 'store' | 'plan' | 'apply' | null;

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground';
// Only DMC observer firmware has the web config; the stock and repeater
// profiles are offered too, since their vars are what it sets.
const TOOLBOX_PROFILES = ['stock', 'dmc_repeater', 'dmc_observer'];

function hostKey(assetId: number): string {
  return `rtfm-fleet-lan-host-${assetId}`;
}

function loadHost(assetId: number): string {
  try {
    return window.localStorage.getItem(hostKey(assetId)) ?? '';
  } catch {
    return '';
  }
}

function saveHost(assetId: number, host: string): void {
  try {
    if (host) window.localStorage.setItem(hostKey(assetId), host);
    else window.localStorage.removeItem(hostKey(assetId));
  } catch {
    // A browser without storage just forgets the address.
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FleetLanDevice({
  assetId,
  configs,
  vault,
  onStored,
  onLogChanged,
}: {
  assetId: number;
  configs: FleetConfigSummary[];
  vault: VaultState;
  /** A read was stored as a config: the list must be read again. */
  onStored: () => void;
  /** An apply wrote to the asset's log. */
  onLogChanged: () => void;
}) {
  const t = useT();
  const [host, setHost] = useState(() => loadHost(assetId));
  const [busy, setBusy] = useState<Busy>(null);
  const [armed, setArmed] = useState<'start' | 'stop' | null>(null);
  const [toggleReply, setToggleReply] = useState<string | null>(null);
  const [read, setRead] = useState<FleetLanReadResult | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applicable = useMemo(
    () => configs.filter((config) => TOOLBOX_PROFILES.includes(config.profile)),
    [configs]
  );
  const [configId, setConfigId] = useState<number | null>(null);
  const [allowRadio, setAllowRadio] = useState(false);
  const [plan, setPlan] = useState<FleetApplyPlan | null>(null);
  const [planVersion, setPlanVersion] = useState(0);

  const chosen = configId ?? applicable[0]?.id ?? null;
  const ready = vault === 'open' && host.trim() !== '';

  const changeHost = (next: string) => {
    setHost(next);
    saveHost(assetId, next.trim());
    setPlan(null);
  };

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

  // Two clicks: this sends a command to the node over the radio.
  const toggle = (which: 'start' | 'stop') => {
    if (armed !== which) {
      setArmed(which);
      return;
    }
    setArmed(null);
    void run('toggle', async () => {
      const result =
        which === 'start'
          ? await api.startFleetWebconfig(assetId)
          : await api.stopFleetWebconfig(assetId);
      setToggleReply(result.reply);
      if (result.host) changeHost(result.host);
    });
  };

  const readNow = () =>
    run('read', async () => {
      setRead(await api.fleetWebconfigRead(assetId, host.trim(), false, null));
    });

  const store = () =>
    run('store', async () => {
      const result = await api.fleetWebconfigRead(assetId, host.trim(), true, label.trim() || null);
      setRead(result);
      setLabel('');
      const parts = [t('fleet_lan_stored')];
      if (result.stored && result.stored.secrets_stored > 0) {
        parts.push(t('fleet_config_imported_secrets', { count: result.stored.secrets_stored }));
      }
      setNote(parts.join(' '));
      onStored();
    });

  const prepare = () =>
    run('plan', async () => {
      if (chosen === null) return;
      setPlan(null);
      setPlan(await api.fleetWebconfigPlan(chosen, host.trim(), allowRadio));
      setPlanVersion((version) => version + 1);
    });

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="fleet-lan">
      <p className="text-xs font-medium text-foreground">{t('fleet_lan_title')}</p>
      <p className="text-xs text-muted-foreground">{t('fleet_lan_intro')}</p>
      {vault !== 'open' && (
        <p className="text-xs text-warning" data-testid="fleet-lan-vault-hint">
          {t(`fleet_lan_vault_${vault}`)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-testid="fleet-lan-host"
          value={host}
          onChange={(e) => changeHost(e.target.value)}
          placeholder={t('fleet_lan_host')}
          aria-label={t('fleet_lan_host')}
          className="h-9 max-w-xs text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          data-testid="fleet-lan-start"
          disabled={busy !== null}
          onClick={() => toggle('start')}
        >
          {armed === 'start' ? t('fleet_lan_start_confirm') : t('fleet_lan_start')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="fleet-lan-stop"
          disabled={busy !== null}
          onClick={() => toggle('stop')}
        >
          {armed === 'stop' ? t('fleet_lan_stop_confirm') : t('fleet_lan_stop')}
        </Button>
      </div>
      {armed === 'start' && (
        <p className="text-xs font-medium text-warning" data-testid="fleet-lan-start-warning">
          {t('fleet_lan_start_warning')}
        </p>
      )}
      {armed === 'stop' && (
        <p className="text-xs font-medium text-warning" data-testid="fleet-lan-stop-warning">
          {t('fleet_lan_stop_warning')}
        </p>
      )}
      {toggleReply && (
        <p
          className="break-all font-mono text-xs text-muted-foreground"
          data-testid="fleet-lan-toggle-reply"
        >
          {toggleReply}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          data-testid="fleet-lan-read"
          disabled={!ready || busy !== null}
          onClick={() => void readNow()}
        >
          {t('fleet_lan_read')}
        </Button>
      </div>

      {read && (
        <div className="space-y-2 rounded border border-border bg-background p-3 text-xs">
          <dl
            className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-0.5"
            data-testid="fleet-lan-status"
          >
            <dt className="text-muted-foreground">{t('fleet_usb_name')}</dt>
            <dd>{read.status.name ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_role')}</dt>
            <dd>{read.status.role ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_firmware')}</dt>
            <dd>{read.status.fw ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_usb_board')}</dt>
            <dd>{read.status.board ?? ''}</dd>
            <dt className="text-muted-foreground">{t('fleet_lan_node_id')}</dt>
            <dd className="break-all font-mono">{read.status.node_id ?? ''}</dd>
          </dl>
          <p className="text-success">{t('fleet_lan_match')}</p>
          <p className="text-muted-foreground" data-testid="fleet-lan-partial">
            {t('fleet_lan_partial')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              data-testid="fleet-lan-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('fleet_config_label')}
              aria-label={t('fleet_config_label')}
              className="h-9 max-w-xs text-xs"
            />
            <Button
              size="sm"
              data-testid="fleet-lan-store"
              disabled={!ready || busy !== null}
              onClick={() => void store()}
            >
              {t('fleet_usb_store')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded border border-border bg-background p-3 text-xs">
        <p className="font-medium text-foreground">{t('fleet_lan_apply_title')}</p>
        <p className="text-muted-foreground" data-testid="fleet-lan-no-key">
          {t('fleet_lan_no_key')}
        </p>
        {applicable.length === 0 ? (
          <p className="text-muted-foreground" data-testid="fleet-lan-no-configs">
            {t('fleet_usb_no_configs')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              data-testid="fleet-lan-apply-config"
              value={chosen ?? ''}
              onChange={(e) => {
                setConfigId(Number(e.target.value));
                setPlan(null);
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
                data-testid="fleet-lan-allow-radio"
                checked={allowRadio}
                onChange={(e) => {
                  setAllowRadio(e.target.checked);
                  setPlan(null);
                }}
              />
              {t('fleet_usb_allow_radio')}
            </label>
            <Button
              size="sm"
              variant="outline"
              data-testid="fleet-lan-prepare"
              disabled={!ready || busy !== null}
              onClick={() => void prepare()}
            >
              {t('fleet_lan_prepare')}
            </Button>
          </div>
        )}
        <p className="text-muted-foreground">{t('fleet_lan_apply_hint')}</p>
        {plan && chosen !== null && (
          <FleetApplyPlanView
            key={planVersion}
            plan={plan}
            configId={chosen}
            cli={null}
            disabled={busy !== null}
            onRunning={(running) => setBusy(running ? 'apply' : null)}
            onFinished={(done) => {
              if (done.logged) onLogChanged();
            }}
            onError={setError}
            transport={{
              runStep: (step) => api.fleetWebconfigStep(chosen, host.trim(), step),
              transport: 'webconfig',
            }}
          />
        )}
      </div>

      {note && (
        <p className="text-xs text-success" data-testid="fleet-lan-note">
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
