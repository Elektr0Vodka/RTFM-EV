import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { RepeaterPane, NotFetched, KvRow, formatClockDrift } from './repeaterPaneShared';
import { useT } from '../../i18n';
import {
  formatCoordinates,
  useCoordinateFormat,
  type CoordinateFormat,
} from '../../utils/coordinateFormat';
import type { RepeaterNodeInfoResponse, PaneState } from '../../types';

// The repeater CLI returns lat/lon as strings. Decimal keeps the raw text;
// DMS/MGRS need both values to parse as numbers, otherwise fall back to raw.
function formatRepeaterLatLon(
  lat: string | null,
  lon: string | null,
  format: CoordinateFormat
): string {
  if (lat == null && lon == null) return '-';
  const latN = lat != null ? Number(lat) : NaN;
  const lonN = lon != null ? Number(lon) : NaN;
  if (format !== 'decimal' && Number.isFinite(latN) && Number.isFinite(lonN)) {
    return formatCoordinates(latN, lonN, format);
  }
  return `${lat ?? '-'}, ${lon ?? '-'}`;
}

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
  const coordinateFormat = useCoordinateFormat();
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
          <KvRow label={t('common_name')} value={data.name ?? '-'} />
          <KvRow
            label={t('repeater_lat_lon_label')}
            value={formatRepeaterLatLon(data.lat, data.lon, coordinateFormat)}
          />
          <div className="flex justify-between text-sm py-0.5">
            <span className="text-muted-foreground">{t('repeater_clock_utc_label')}</span>
            <span>
              {data.clock_utc ?? '-'}
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
