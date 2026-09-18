import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import {
  panByFraction,
  zoomAtFraction,
  WHEEL_IN,
  WHEEL_OUT,
  type ChartWindow,
} from '../../lib/chartZoom';

// SvgZoomFrame wraps a custom (non-Recharts) SVG chart with the reference
// wheel-zoom / drag-pan / dblclick-reset interaction in index space. The parent
// owns the window `view` (so several charts can share one window) and slices its
// data to `view` before rendering. `plotLeftFrac` is the fraction of the element
// width taken by the chart's left gutter (Y axis), so the cursor anchors to the
// plot, not the whole element. The zoom math is shared with the Recharts charts
// via ../../lib/chartZoom.

interface SvgZoomFrameProps {
  full: ChartWindow;
  view: ChartWindow;
  onChange: (w: ChartWindow) => void;
  minSpan: number;
  plotLeftFrac?: number;
  disabled?: boolean;
  children: React.ReactNode;
}

export function SvgZoomFrame({
  full,
  view,
  onChange,
  minSpan,
  plotLeftFrac = 0,
  disabled,
  children,
}: SvgZoomFrameProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ChartWindow>(view);
  viewRef.current = view;
  const fullRef = useRef<ChartWindow>(full);
  fullRef.current = full;
  const off = disabled || full[1] - full[0] < minSpan;

  const plot = () => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left + rect.width * plotLeftFrac,
      innerW: Math.max(1, rect.width * (1 - plotLeftFrac)),
    };
  };
  const fracFor = (clientX: number) => {
    const p = plot();
    if (!p) return 0.5;
    return Math.max(0, Math.min(1, (clientX - p.left) / p.innerW));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || off) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_IN : WHEEL_OUT;
      onChange(
        zoomAtFraction(viewRef.current, fullRef.current, fracFor(e.clientX), factor, minSpan)
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, minSpan, plotLeftFrac, onChange]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (off) return;
    const p = plot();
    if (!p) return;
    const startX = e.clientX;
    const startView = viewRef.current.slice() as ChartWindow;
    const move = (ev: MouseEvent) => {
      const deltaFrac = -((ev.clientX - startX) / p.innerW);
      onChange(panByFraction(startView, fullRef.current, deltaFrac, minSpan));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={ref}
      onMouseDown={onMouseDown}
      onDoubleClick={() => onChange(fullRef.current)}
      title={off ? undefined : t('chart_zoom_hint')}
      style={{ cursor: off ? undefined : 'grab', touchAction: 'pan-y' }}
    >
      {children}
    </div>
  );
}
