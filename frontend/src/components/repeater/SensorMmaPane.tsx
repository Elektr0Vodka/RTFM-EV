import { RepeaterPane, NotFetched, formatLppLabel } from './repeaterPaneShared';
import { useT } from '../../i18n';
import type { PaneState, SensorMmaResponse } from '../../types';

function formatValue(value: number | number[]): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Min/max/average per sensor channel (SensorMesh REQ_TYPE_GET_AVG_MIN_MAX). */
export function SensorMmaPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: SensorMmaResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <RepeaterPane
      title={t('sensor_mma_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
    >
      {!data ? (
        <NotFetched />
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sensor_mma_empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="font-normal" />
              <th className="font-normal">{t('sensor_mma_min')}</th>
              <th className="font-normal">{t('sensor_mma_max')}</th>
              <th className="font-normal">{t('sensor_mma_avg')}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => (
              <tr key={`${entry.channel}-${entry.type_name}-${i}`}>
                <td className="pr-2">{`${formatLppLabel(entry.type_name)} Ch${entry.channel}`}</td>
                <td className="font-mono">{formatValue(entry.min)}</td>
                <td className="font-mono">{formatValue(entry.max)}</td>
                <td className="font-mono">{formatValue(entry.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </RepeaterPane>
  );
}
