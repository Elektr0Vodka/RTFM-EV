import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useT } from '../../i18n';
import { mergeSignalSeries, type SnrPoint } from './neighborSignalUtils';

interface Props {
  name: string;
  repeaterSamples: SnrPoint[];
  selfSamples: SnrPoint[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NeighborSignalDetailChart({ name, repeaterSamples, selfSamples }: Props) {
  const t = useT();
  const data = useMemo(
    () => mergeSignalSeries(repeaterSamples, selfSamples),
    [repeaterSamples, selfSamples]
  );

  const total = repeaterSamples.length + selfSamples.length;

  return (
    <div className="rounded border border-border/70 bg-muted/10 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium">{t('neighbor_signal_history_title', { name })}</span>
        <span className="text-[0.625rem] text-muted-foreground">
          {t('neighbor_signal_samples_count', { count: total })}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('neighbor_signal_no_history')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="observed_at"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTime}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={34}
              tickFormatter={(v: number) => `${v}`}
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'hsl(var(--popover-foreground))',
              }}
              labelFormatter={(l) => formatTime(Number(l))}
            />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Line
              type="monotone"
              dataKey="repeater_snr"
              name={t('neighbor_signal_series_repeater')}
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="self_snr"
              name={t('neighbor_signal_series_self')}
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
