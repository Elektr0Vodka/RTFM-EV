import type { ReactNode } from 'react';
import { Separator } from '../ui/separator';
import { RepeaterPane, NotFetched, KvRow, formatDuration } from './repeaterPaneShared';
import { useT } from '../../i18n';
import type { RepeaterStatusResponse, PaneState } from '../../types';

function Secondary({ children }: { children: ReactNode }) {
  return <span className="ml-1.5 font-normal text-muted-foreground">{children}</span>;
}

function formatAirtimePercent(airtimeSec: number, uptimeSec: number): string | null {
  if (uptimeSec <= 0) return null;
  return `${((airtimeSec / uptimeSec) * 100).toFixed(2)}%`;
}

function formatPerMinute(count: number, uptimeSec: number): string | null {
  if (uptimeSec <= 0) return null;
  const rate = (count * 60) / uptimeSec;
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}

export function TelemetryPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterStatusResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const txPct = data ? formatAirtimePercent(data.airtime_seconds, data.uptime_seconds) : null;
  const rxPct = data ? formatAirtimePercent(data.rx_airtime_seconds, data.uptime_seconds) : null;
  const rxPerMin = data ? formatPerMinute(data.packets_received, data.uptime_seconds) : null;
  const txPerMin = data ? formatPerMinute(data.packets_sent, data.uptime_seconds) : null;

  return (
    <RepeaterPane
      title={t('repeater_telemetry_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
    >
      {!data ? (
        <NotFetched />
      ) : (
        <div className="space-y-2">
          <KvRow label={t('repeater_battery_label')} value={`${data.battery_volts.toFixed(3)}V`} />
          <KvRow label={t('repeater_uptime_label')} value={formatDuration(data.uptime_seconds)} />
          <KvRow
            label={t('repeater_tx_airtime_label')}
            value={
              <>
                {formatDuration(data.airtime_seconds)}
                {txPct && <Secondary>({txPct})</Secondary>}
              </>
            }
          />
          <KvRow
            label={t('repeater_rx_airtime_label')}
            value={
              <>
                {formatDuration(data.rx_airtime_seconds)}
                {rxPct && <Secondary>({rxPct})</Secondary>}
              </>
            }
          />
          <Separator className="my-1" />
          <KvRow label={t('repeater_noise_floor_label')} value={`${data.noise_floor_dbm} dBm`} />
          <KvRow label={t('repeater_last_rssi_label')} value={`${data.last_rssi_dbm} dBm`} />
          <KvRow label={t('repeater_last_snr_label')} value={`${data.last_snr_db.toFixed(1)} dB`} />
          <Separator className="my-1" />
          <KvRow
            label={t('repeater_packets_label')}
            value={
              <>
                {t('repeater_rx_tx_counts', {
                  rx: data.packets_received.toLocaleString(),
                  tx: data.packets_sent.toLocaleString(),
                })}
                {rxPerMin && txPerMin && (
                  <Secondary>{t('repeater_packets_avg_rx_tx', { rxPerMin, txPerMin })}</Secondary>
                )}
              </>
            }
          />
          <KvRow
            label={t('repeater_flood_label')}
            value={t('repeater_rx_tx_counts', {
              rx: data.recv_flood.toLocaleString(),
              tx: data.sent_flood.toLocaleString(),
            })}
          />
          <KvRow
            label={t('repeater_direct_label')}
            value={t('repeater_rx_tx_counts', {
              rx: data.recv_direct.toLocaleString(),
              tx: data.sent_direct.toLocaleString(),
            })}
          />
          <KvRow
            label={t('repeater_duplicates_label')}
            value={t('repeater_flood_direct_dups', {
              flood: data.flood_dups.toLocaleString(),
              direct: data.direct_dups.toLocaleString(),
            })}
          />
          {data.recv_errors != null && (
            <KvRow
              label={t('repeater_rx_errors_label')}
              value={
                <>
                  {data.recv_errors.toLocaleString()}
                  {data.packets_received > 0 && (
                    <Secondary>
                      (
                      {(
                        (data.recv_errors / (data.packets_received + data.recv_errors)) *
                        100
                      ).toFixed(2)}
                      %)
                    </Secondary>
                  )}
                </>
              }
            />
          )}
          <Separator className="my-1" />
          <KvRow label={t('repeater_tx_queue_label')} value={data.tx_queue_len} />
          <KvRow label={t('repeater_debug_flags_label')} value={data.full_events} />
        </div>
      )}
    </RepeaterPane>
  );
}
