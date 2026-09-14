import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopUpdateStatus, OpenHopUpdateChannels } from '../../../../types';
import { useT } from '../../../../i18n';
import { UpdateProgressLog } from './UpdateProgressLog';

/**
 * OpenHop OTA update pane: shows installed/latest version + channel, lets the
 * user check for updates and switch channel, and installs behind an explicit
 * confirm (install triggers a real pip upgrade + service restart on the node).
 */
export function OpenHopUpdatePane() {
  const t = useT();
  const [status, setStatus] = useState<OpenHopUpdateStatus | null>(null);
  const [channels, setChannels] = useState<OpenHopUpdateChannels | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatus(await api.getOpenHopUpdateStatus());
      setChannels(await api.getOpenHopUpdateChannels());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const doCheck = async () => {
    setError(null);
    try {
      await api.openHopUpdateCheck(true);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const doInstall = async () => {
    setConfirming(false);
    setError(null);
    try {
      await api.openHopUpdateInstall(false);
      setInstalling(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const changeChannel = async (ch: string) => {
    setError(null);
    try {
      await api.openHopUpdateSetChannel(ch);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">{t('openhop_update_installed')}:</span>
          <span className="font-mono">{status?.current_version ?? '-'}</span>
          <span className="text-muted-foreground">{t('openhop_update_latest')}:</span>
          <span className="font-mono">{status?.latest_version ?? '-'}</span>
          {status?.has_update && (
            <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
              {t('openhop_update_available')}
            </span>
          )}
        </div>
        {status?.error && <div className="mt-1 text-xs text-destructive">{status.error}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground" htmlFor="openhop-update-channel">
          {t('openhop_update_channel')}:
        </label>
        <select
          id="openhop-update-channel"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={channels?.current_channel ?? ''}
          onChange={(e) => void changeChannel(e.target.value)}
        >
          {(channels?.channels ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-xs"
          onClick={() => void doCheck()}
        >
          {t('openhop_update_check')}
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
          onClick={() => setConfirming(true)}
        >
          {t('openhop_update_install')}
        </button>
      </div>

      {confirming && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <div className="mb-2 text-xs">{t('openhop_update_confirm_prompt')}</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground"
              onClick={() => void doInstall()}
            >
              {t('openhop_update_confirm')}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-xs"
              onClick={() => setConfirming(false)}
            >
              {t('common_cancel')}
            </button>
          </div>
        </div>
      )}

      {installing && <UpdateProgressLog onDone={() => void refresh()} />}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
