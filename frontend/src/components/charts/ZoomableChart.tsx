import { useT } from '../../i18n';
import { useChartZoom, type PlotInset } from '../../hooks/useChartZoom';
import type { ChartWindow } from '../../lib/chartZoom';

// ZoomableChart wraps a Recharts chart with the reference wheel-zoom / drag-pan /
// double-click-reset interaction. It owns the interaction; the child renders the
// ResponsiveContainer + chart and binds `domain` onto its numeric X axis:
//
//   <ZoomableChart full={[minTs, maxTs]} minSpan={30}>
//     {({ domain, isPanning }) => (
//       <ResponsiveContainer ...>
//         <LineChart ...>
//           <XAxis type="number" allowDataOverflow domain={domain} ... />
//           {!isPanning && <Tooltip ... />}
//         </LineChart>
//       </ResponsiveContainer>
//     )}
//   </ZoomableChart>
//
// `full` is the numeric X extent of the data (unix seconds for time charts, or
// [0, n-1] for index charts). `minSpan` is the smallest zoom window (30 seconds
// for time, 2 for index). Disabled when there is nothing to zoom.

export interface ZoomableChartRenderProps {
  domain: ChartWindow;
  isPanning: boolean;
  isZoomed: boolean;
  reset: () => void;
}

interface ZoomableChartProps {
  full: ChartWindow;
  minSpan: number;
  inset?: PlotInset;
  disabled?: boolean;
  className?: string;
  children: (props: ZoomableChartRenderProps) => React.ReactNode;
}

export function ZoomableChart({
  full,
  minSpan,
  inset,
  disabled,
  className,
  children,
}: ZoomableChartProps) {
  const t = useT();
  const off = disabled || full[1] <= full[0];
  const { domain, isPanning, isZoomed, reset, containerProps } = useChartZoom(full, {
    minSpan,
    inset,
    disabled: off,
  });

  return (
    <div {...containerProps} className={className} title={off ? undefined : t('chart_zoom_hint')}>
      {children({ domain, isPanning, isZoomed, reset })}
    </div>
  );
}
