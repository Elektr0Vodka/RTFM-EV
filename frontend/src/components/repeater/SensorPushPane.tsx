import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { SensorPushState, SensorPushThreshold } from '../../types';
import { thresholdBytes } from '../../utils/sensorPush';
import { Button } from '../ui/button';
import { toast } from '../ui/sonner';
import { formatLppLabel } from './repeaterPaneShared';

const POLL_MS = 30_000;

type Channel = { channel: number; type_name: string };

function channelKey(c: Channel): string {
  return `${c.channel}:${c.type_name}`;
}

/**
 * MeshCore 1.18 sensor telemetry push: pick watched channels and a minimum
 * change for each, then subscribe. Subscribing and the backend's renewals
 * transmit; nothing goes out until the switch is turned on.
 */
export function SensorPushPane({
  publicKey,
  channels,
}: {
  publicKey: string;
  channels: Channel[];
}) {
  const t = useT();
  const [pushState, setPushState] = useState<SensorPushState | null>(null);
  // Ticked channels, keyed "channel:type", holding the typed minimum change.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let seeded = false;
    const load = () =>
      api
        .getSensorPush(publicKey)
        .then((next) => {
          if (cancelled) return;
          setPushState(next);
          if (!seeded) {
            seeded = true;
            setPicked(
              Object.fromEntries(
                next.thresholds.map((th) => [channelKey(th), String(th.min_delta)])
              )
            );
          }
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [publicKey]);

  const uniqueChannels = useMemo(() => {
    const seen = new Set<string>();
    return channels.filter((c) => {
      const key = channelKey(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [channels]);

  const supported = pushState?.supported_types ?? {};
  const max = pushState?.max_threshold_bytes ?? 14;
  const selected: SensorPushThreshold[] = Object.entries(picked).map(([key, text]) => {
    const [channel, ...rest] = key.split(':');
    return { channel: Number(channel), type_name: rest.join(':'), min_delta: Number(text) };
  });
  const used = thresholdBytes(selected, supported);
  const valid =
    selected.length > 0 &&
    used <= max &&
    selected.every((s) => Number.isFinite(s.min_delta) && s.min_delta > 0);

  const toggleChannel = (c: Channel) =>
    setPicked((prev) => {
      const key = channelKey(c);
      if (key in prev) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: '' };
    });

  const run = useCallback(async (action: () => Promise<SensorPushState>) => {
    setBusy(true);
    try {
      setPushState(await action());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // While push is on the sensor keeps its old thresholds until it is
  // subscribed again, so saving also re-subscribes (one transmission).
  const save = () =>
    run(async () => {
      const saved = await api.saveSensorPush(publicKey, selected);
      return pushState?.enabled ? api.subscribeSensorPush(publicKey) : saved;
    });

  const toggleSwitch = () => {
    if (pushState?.enabled) {
      void run(() => api.unsubscribeSensorPush(publicKey));
      return;
    }
    void run(async () => {
      await api.saveSensorPush(publicKey, selected);
      return api.subscribeSensorPush(publicKey);
    });
  };

  const errorText =
    pushState?.last_error === 'refused'
      ? t('sensor_push_error_refused')
      : pushState?.last_error === 'no_reply'
        ? t('sensor_push_error_no_reply')
        : pushState?.last_error;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <h3 className="text-sm font-medium">{t('sensor_push_title')}</h3>
        <button
          type="button"
          role="switch"
          aria-checked={!!pushState?.enabled}
          aria-label={t('sensor_push_switch')}
          disabled={busy || !pushState || (!pushState.enabled && !valid)}
          onClick={toggleSwitch}
          className={`rounded-md border px-2 py-0.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
            pushState?.enabled
              ? 'border-success text-success'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('sensor_push_switch')}
        </button>
      </div>
      <div className="space-y-2 p-3 text-sm">
        <p className="text-xs text-muted-foreground">{t('sensor_push_hint')}</p>
        {uniqueChannels.length === 0 ? (
          <p className="text-muted-foreground">{t('sensor_push_no_channels')}</p>
        ) : (
          <ul className="space-y-1">
            {uniqueChannels.map((c) => {
              const key = channelKey(c);
              const label = `${formatLppLabel(c.type_name)} Ch${c.channel}`;
              const isSupported = c.type_name in supported;
              const ticked = key in picked;
              return (
                <li key={key} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ticked}
                      disabled={!isSupported || busy}
                      onChange={() => toggleChannel(c)}
                      aria-label={label}
                    />
                    <span>{label}</span>
                  </label>
                  {!isSupported && (
                    <span className="text-xs text-muted-foreground">
                      {t('sensor_push_unsupported')}
                    </span>
                  )}
                  {ticked && (
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={picked[key]}
                      onChange={(e) => setPicked((prev) => ({ ...prev, [key]: e.target.value }))}
                      aria-label={`${t('sensor_push_min_change')} ${label}`}
                      placeholder={t('sensor_push_min_change')}
                      className="w-24 rounded border border-input bg-background px-2 py-0.5 text-sm"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className={used > max ? 'text-destructive' : 'text-muted-foreground'}>
            {t('sensor_push_bytes', { used, max })}
          </span>
          <Button size="sm" variant="outline" disabled={!valid || busy} onClick={() => void save()}>
            {t('sensor_push_save')}
          </Button>
        </div>
        {pushState?.granted_until ? (
          <p className="text-xs text-muted-foreground">
            {t('sensor_push_until', {
              time: new Date(pushState.granted_until * 1000).toLocaleString(),
            })}
          </p>
        ) : null}
        {pushState?.scope_name ? (
          <p className="text-xs text-muted-foreground">
            {t('sensor_push_scope', { scope: pushState.scope_name })}
          </p>
        ) : null}
        {pushState?.last_push_at ? (
          <p className="text-xs text-muted-foreground">
            {t('sensor_push_last', {
              time: new Date(pushState.last_push_at * 1000).toLocaleString(),
            })}
          </p>
        ) : null}
        {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
      </div>
    </div>
  );
}
