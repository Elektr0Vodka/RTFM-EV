import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { SvgZoomFrame } from './SvgZoomFrame';
import {
  ChartExpandButton,
  ChartPanelDialog,
  useChartExpanded,
  useChartPanelReport,
} from './ChartExpand';
import { clampWindow, type ChartWindow } from '../../lib/chartZoom';
import type { ChartLegendItem } from '../../share/cards/chartCapture';

// ZoomableBinChart gives one custom (non-Recharts) SVG chart its OWN wheel-zoom /
// drag-pan / dblclick-reset window, independent of every other chart. It holds
// the index window itself and hands the child the visible slice of `items`, so
// callers stay declarative:
//
//   <ZoomableBinChart items={bins} plotLeftFrac={PAD_L / CW} title={t('...')}>
//     {(visible) => <BarChart bins={visible} ... />}
//   </ZoomableBinChart>
//
// The zoom is reset when the item count changes (e.g. the time-window selector),
// since old indices no longer map to the same data.
//
// The "+" opens the chart in a large panel (ChartExpand) as a second instance
// that starts at the current zoom. `timeOf` gives an item's unix seconds, so the
// shared image can run a clock over the visible slice.

interface ZoomableBinChartProps<T> {
  items: T[];
  minSpan?: number;
  plotLeftFrac?: number;
  title?: string;
  timeOf?: (item: T) => number;
  /** Legend drawn outside the chart; repeated in the panel and on the image. */
  legend?: ChartLegendItem[];
  initialView?: ChartWindow | null;
  children: (visible: T[]) => React.ReactNode;
}

export function ZoomableBinChart<T>({
  items,
  minSpan = 2,
  plotLeftFrac = 0,
  title,
  timeOf,
  legend,
  initialView = null,
  children,
}: ZoomableBinChartProps<T>) {
  const t = useT();
  const expanded = useChartExpanded();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ChartWindow | null>(initialView);
  const len = items.length;
  const lenRef = useRef(len);
  useEffect(() => {
    if (lenRef.current === len) return;
    lenRef.current = len;
    setView(null);
  }, [len]);

  const full: ChartWindow = [0, len];
  const win = view ? clampWindow(view, full, minSpan) : full;
  const lo = Math.max(0, Math.floor(win[0]));
  const hi = Math.max(lo + 1, Math.min(len, Math.ceil(win[1])));
  const visible = useMemo(() => items.slice(lo, hi), [items, lo, hi]);
  const off = len < minSpan;

  const first = visible[0];
  const last = visible[visible.length - 1];
  useChartPanelReport(
    expanded
      ? {
          timeRange: timeOf && first != null && last != null ? [timeOf(first), timeOf(last)] : null,
          plot: { left: plotLeftFrac, top: 0, width: 1 - plotLeftFrac, height: 1 },
        }
      : null
  );

  return (
    <>
      <div className="relative">
        <SvgZoomFrame
          full={full}
          view={win}
          onChange={setView}
          minSpan={minSpan}
          plotLeftFrac={plotLeftFrac}
          disabled={off}
        >
          {children(visible)}
        </SvgZoomFrame>
        {!expanded && <ChartExpandButton onOpen={() => setOpen(true)} />}
      </div>
      {open && (
        <ChartPanelDialog
          open
          onClose={() => setOpen(false)}
          title={title ?? t('chart_panel_untitled')}
          zoomable={!off}
          legend={legend}
        >
          <ZoomableBinChart
            items={items}
            minSpan={minSpan}
            plotLeftFrac={plotLeftFrac}
            timeOf={timeOf}
            initialView={view}
          >
            {children}
          </ZoomableBinChart>
        </ChartPanelDialog>
      )}
    </>
  );
}
