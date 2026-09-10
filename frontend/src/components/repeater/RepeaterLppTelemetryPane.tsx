import { useMemo } from 'react';
import { RepeaterPane, NotFetched, LppSensorRow, formatLppLabel } from './repeaterPaneShared';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { useT } from '../../i18n';
import type { RepeaterLppTelemetryResponse, PaneState } from '../../types';

export function LppTelemetryPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterLppTelemetryResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();

  // Build disambiguated labels matching the telemetry history chart names
  const labels = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    return data.sensors.map((s) => {
      const base = `${s.type_name}_${s.channel}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return formatLppLabel(s.type_name) + ` Ch${s.channel}` + (n > 1 ? ` (${n})` : '');
    });
  }, [data]);

  return (
    <RepeaterPane
      title={t('repeater_lpp_sensors_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
    >
      {!data ? (
        <NotFetched />
      ) : data.sensors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('repeater_lpp_no_sensor_data')}</p>
      ) : (
        <div className="space-y-0.5">
          {data.sensors.map((sensor, i) => (
            <LppSensorRow key={i} sensor={sensor} unitPref={distanceUnit} label={labels[i]} />
          ))}
        </div>
      )}
    </RepeaterPane>
  );
}
