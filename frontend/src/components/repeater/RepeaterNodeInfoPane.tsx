import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { RepeaterPane, NotFetched, KvRow, formatClockDrift } from './repeaterPaneShared';
import { useT } from '../../i18n';
import type { RepeaterNodeInfoResponse, PaneState } from '../../types';

export function NodeInfoPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterNodeInfoResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const clockDrift = useMemo(() => {
    if (!data?.clock_utc) return null;
    return formatClockDrift(data.clock_utc, state.fetched_at ?? undefined);
  }, [data?.clock_utc, state.fetched_at]);

  return (
    <RepeaterPane
      title={t('repeater_node_info_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
    >
      {!data ? (
        <NotFetched />
      ) : (
        <div>
          <KvRow label={t('common_name')} value={data.name ?? '—'} />
          <KvRow
            label={t('repeater_lat_lon_label')}
            value={
              data.lat != null || data.lon != null ? `${data.lat ?? '—'}, ${data.lon ?? '—'}` : '—'
            }
          />
          <div className="flex justify-between text-sm py-0.5">
            <span className="text-muted-foreground">{t('repeater_clock_utc_label')}</span>
            <span>
              {data.clock_utc ?? '—'}
              {clockDrift && (
                <span
                  className={cn(
                    'ml-2 text-xs',
                    clockDrift.isLarge ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {t('repeater_clock_drift_label', { text: clockDrift.text })}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </RepeaterPane>
  );
}
