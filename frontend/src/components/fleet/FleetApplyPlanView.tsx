/**
 * One apply plan over a USB cable: the differences, every command in order,
 * what is left out and why, then the confirm and the run (plan 32).
 *
 * Used by the Configs block (FleetUsbDevice) and by the onboarding wizard, so
 * both show and send the same way. Nothing is sent before the confirm box is
 * ticked; then runApply sends one command at a time, reads each back and stops
 * at the first that is not as expected. A step's `command` can hold a secret:
 * only its `display` is rendered.
 *
 * A new plan needs a new instance (the parent keys it), so no tick or result
 * of an earlier plan carries over.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import type { FleetApplyPlan } from '../../types';
import {
  runApply,
  type ApplyOutcome,
  type ApplyStepResult,
  type CommandSender,
} from '../../utils/fleetUsb';
import { Button } from '../ui/button';

function pathText(path: (string | number)[]): string {
  return path.join('/');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FleetApplyPlanView({
  plan,
  configId,
  cli,
  disabled,
  onRunning,
  onFinished,
  onError,
}: {
  plan: FleetApplyPlan;
  configId: number;
  cli: CommandSender | null;
  /** Something else is busy with the port. */
  disabled: boolean;
  onRunning: (running: boolean) => void;
  onFinished: (outcome: ApplyOutcome) => void;
  onError: (error: string) => void;
}) {
  const t = useT();
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState<ApplyStepResult[]>([]);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const [running, setRunning] = useState(false);

  const changes = plan.rows.filter((row) => row.status === 'change');
  const skips = plan.rows.filter((row) => row.status === 'skip');
  const same = plan.rows.length - changes.length - skips.length;

  const send = async () => {
    if (!cli || !confirmed || running) return;
    setRunning(true);
    onRunning(true);
    setResults([]);
    try {
      const done = await runApply(cli, configId, plan, (result) =>
        setResults((current) => [...current, result])
      );
      setOutcome(done);
      onFinished(done);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setRunning(false);
      onRunning(false);
    }
  };

  return (
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
                  <tr key={pathText(row.path)} className="border-b border-border last:border-0">
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
                    <span className="ml-2 text-warning">{t('fleet_usb_needs_restart')}</span>
                  )}
                  {result && (
                    <span className={result.ok ? 'ml-2 text-success' : 'ml-2 text-destructive'}>
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
              disabled={running}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('fleet_usb_confirm', { count: plan.steps.length })}
          </label>
          <Button
            size="sm"
            data-testid="fleet-usb-send"
            disabled={!confirmed || disabled || running || !cli}
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
            ? t('fleet_usb_done', { sent: outcome.results.length, total: plan.steps.length })
            : t('fleet_usb_stopped', {
                number: (outcome.stopped?.index ?? 0) + 1,
                reason: t(`fleet_usb_check_${outcome.stopped?.reason ?? 'unexpected_reply'}`),
              })}{' '}
          {outcome.logged ? t('fleet_usb_logged') : t('fleet_usb_not_logged')}
        </p>
      )}
    </div>
  );
}
