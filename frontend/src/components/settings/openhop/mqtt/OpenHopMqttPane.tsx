import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopMqttConfigBody } from '../../../../types';
import { useT } from '../../../../i18n';

/**
 * OpenHop MQTT config pane. Shows MQTT runtime status (read-only), edits the
 * whitelisted MQTT observer fields behind a confirm (node config write), and
 * can trigger a neighbours publish cycle (outward RF) behind an explicit
 * confirm.
 */
export function OpenHopMqttPane() {
  const t = useT();
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [owner, setOwner] = useState('');
  const [email, setEmail] = useState('');
  const [iata, setIata] = useState('');
  const [interval, setIntervalVal] = useState<number | ''>('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await api.getOpenHopMqttStatus();
      setStatus(s.data ?? null);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    setConfirmSave(false);
    setError(null);
    setNotice(null);
    const body: OpenHopMqttConfigBody = {};
    if (owner.trim()) body.owner = owner.trim();
    if (email.trim()) body.email = email.trim();
    if (iata.trim()) body.iata_code = iata.trim();
    if (interval !== '') body.status_interval = Number(interval);
    try {
      await api.openHopUpdateMqttConfig(body);
      setNotice(t('openhop_mqtt_saved'));
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const publish = async () => {
    setConfirmPublish(false);
    setError(null);
    setNotice(null);
    try {
      await api.openHopPublishNeighbors();
      setNotice(t('openhop_mqtt_publish_note'));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border border-border p-3">
        <div className="text-xs font-medium">{t('openhop_mqtt_status')}</div>
        <div className="mt-1 space-y-0.5">
          {status ? (
            Object.entries(status).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">—</div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs font-medium">{t('openhop_mqtt_config')}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_mqtt_owner')}
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-0.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_mqtt_email')}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-0.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_mqtt_iata')}
            <input
              value={iata}
              onChange={(e) => setIata(e.target.value)}
              className="mt-0.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_mqtt_interval')}
            <input
              type="number"
              min={60}
              value={interval}
              onChange={(e) => setIntervalVal(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-0.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
        </div>
        {confirmSave ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2">
            <div className="mb-2 text-xs">{t('openhop_mqtt_save_confirm')}</div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground"
                onClick={() => void save()}
              >
                {t('openhop_mqtt_save')}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-xs"
                onClick={() => setConfirmSave(false)}
              >
                {t('common_cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
            onClick={() => setConfirmSave(true)}
          >
            {t('openhop_mqtt_save')}
          </button>
        )}
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs text-muted-foreground">{t('openhop_mqtt_publish_note')}</div>
        {confirmPublish ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground"
              onClick={() => void publish()}
            >
              {t('openhop_mqtt_publish')}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-xs"
              onClick={() => setConfirmPublish(false)}
            >
              {t('common_cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs"
            onClick={() => setConfirmPublish(true)}
          >
            {t('openhop_mqtt_publish')}
          </button>
        )}
      </div>

      {notice && <div className="text-xs text-muted-foreground">{notice}</div>}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
