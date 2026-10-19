import { useState } from 'react';
import { useT } from '../../i18n';
import { useChartZoom, type PlotInset } from '../../hooks/useChartZoom';
import type { ChartWindow } from '../../lib/chartZoom';
import {
  ChartExpandButton,
  ChartPanelDialog,
  useChartExpanded,
  useChartPanelReport,
} from './ChartExpand';

// ZoomableChart wraps a Recharts chart with the reference wheel-zoom / drag-pan /
// double-click-reset interaction. It owns the interaction; the child renders the
// ResponsiveContainer + chart and binds `domain` onto its numeric X axis:
//
//   <ZoomableChart full={[minTs, maxTs]} minSpan={30} title={t('...')}>
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
//
// The "+" in the corner opens the chart in a large panel (ChartExpand) as a
// second ZoomableChart that starts at the current zoom and then zooms on its own.
// `title` names the panel and the shared image. `timeRange` gives the share
// clock for an index chart; a time chart's domain is used as is.

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
  title?: string;
  /** Unix seconds covered by the visible domain, for an index (non-time) X axis. */
  timeRange?: (domain: ChartWindow) => [number, number] | null;
  /** Start zoomed here (the large panel opens at the inline chart's zoom). */
  initialView?: ChartWindow;
  children: (props: ZoomableChartRenderProps) => React.ReactNode;
}

/** A domain in unix seconds (or ms) as a time range; null for an index axis. */
export function timeRangeOfDomain(d: ChartWindow): [number, number] | null {
  if (d[0] >= 1e12 && d[1] < 1e14) return [d[0] / 1000, d[1] / 1000];
  if (d[0] >= 1e9 && d[1] < 1e11) return [d[0], d[1]];
  return null;
}

export function ZoomableChart({
  full,
  minSpan,
  inset,
  disabled,
  className,
  title,
  timeRange,
  initialView,
  children,
}: ZoomableChartProps) {
  const t = useT();
  const expanded = useChartExpanded();
  const [open, setOpen] = useState(false);
  const off = disabled || full[1] <= full[0];
  const { domain, isPanning, isZoomed, reset, containerProps } = useChartZoom(full, {
    minSpan,
    inset,
    disabled: off,
    initial: initialView,
  });
  useChartPanelReport(
    expanded ? { timeRange: timeRange ? timeRange(domain) : timeRangeOfDomain(domain) } : null
  );

  return (
    <>
      <div
        {...containerProps}
        style={{ ...containerProps.style, position: 'relative' }}
        className={className}
        title={off ? undefined : t('chart_zoom_hint')}
      >
        {children({ domain, isPanning, isZoomed, reset })}
        {!expanded && <ChartExpandButton onOpen={() => setOpen(true)} />}
      </div>
      {open && (
        <ChartPanelDialog
          open
          onClose={() => setOpen(false)}
          title={title ?? t('chart_panel_untitled')}
          zoomable={!off}
        >
          <ZoomableChart
            full={full}
            minSpan={minSpan}
            inset={inset}
            disabled={disabled}
            timeRange={timeRange}
            initialView={domain}
          >
            {children}
          </ZoomableChart>
        </ChartPanelDialog>
      )}
    </>
  );
}
