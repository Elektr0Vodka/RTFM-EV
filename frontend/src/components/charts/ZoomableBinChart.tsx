import { useEffect, useMemo, useState } from 'react';
import { SvgZoomFrame } from './SvgZoomFrame';
import { clampWindow, type ChartWindow } from '../../lib/chartZoom';

// ZoomableBinChart gives one custom (non-Recharts) SVG chart its OWN wheel-zoom /
// drag-pan / dblclick-reset window, independent of every other chart. It holds
// the index window itself and hands the child the visible slice of `items`, so
// callers stay declarative:
//
//   <ZoomableBinChart items={bins} plotLeftFrac={PAD_L / CW}>
//     {(visible) => <BarChart bins={visible} ... />}
//   </ZoomableBinChart>
//
// The zoom is reset when the item count changes (e.g. the time-window selector),
// since old indices no longer map to the same data.

interface ZoomableBinChartProps<T> {
  items: T[];
  minSpan?: number;
  plotLeftFrac?: number;
  children: (visible: T[]) => React.ReactNode;
}

export function ZoomableBinChart<T>({
  items,
  minSpan = 2,
  plotLeftFrac = 0,
  children,
}: ZoomableBinChartProps<T>) {
  const [view, setView] = useState<ChartWindow | null>(null);
  const len = items.length;
  useEffect(() => {
    setView(null);
  }, [len]);

  const full: ChartWindow = [0, len];
  const win = view ? clampWindow(view, full, minSpan) : full;
  const lo = Math.max(0, Math.floor(win[0]));
  const hi = Math.max(lo + 1, Math.min(len, Math.ceil(win[1])));
  const visible = useMemo(() => items.slice(lo, hi), [items, lo, hi]);

  return (
    <SvgZoomFrame
      full={full}
      view={win}
      onChange={setView}
      minSpan={minSpan}
      plotLeftFrac={plotLeftFrac}
      disabled={len < minSpan}
    >
      {children(visible)}
    </SvgZoomFrame>
  );
}
