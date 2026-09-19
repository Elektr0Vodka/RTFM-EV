import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { WHEEL_IN, WHEEL_OUT } from '../../lib/chartZoom';
import { panBox, zoomBoxAtPoint, type ChartBox } from '../../lib/chartZoom2d';

// SvgZoomBox is the 2-D analogue of SvgZoomFrame: it wraps a custom SVG chart
// whose data has no natural index/time order (a point cloud, e.g. SNR vs RSSI)
// with wheel-zoom-at-cursor / drag-pan / dblclick-reset over both axes at once.
// The parent owns the `view` box (in data units) and maps data->pixels through it.
// `plotFrac` is the plot rectangle within the element as fractions of its size, so
// the cursor anchors to the plot, not the axis gutters. The y axis is screen-
// inverted (domain increases upward), so its fraction/delta are mirrored. The zoom
// math is shared with chartZoom.ts via chartZoom2d.ts.

interface PlotFrac {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SvgZoomBoxProps {
  full: ChartBox;
  view: ChartBox;
  onChange: (b: ChartBox) => void;
  /** Per-axis minimum span as a fraction of the full span (default 0.02 => ~50x max zoom). */
  minSpanFrac?: number;
  /** Plot rectangle within the element, as fractions (0..1) of element width/height. */
  plotFrac?: PlotFrac;
  disabled?: boolean;
  children: React.ReactNode;
}

const FULL_PLOT: PlotFrac = { left: 0, top: 0, width: 1, height: 1 };

export function SvgZoomBox({
  full,
  view,
  onChange,
  minSpanFrac = 0.02,
  plotFrac = FULL_PLOT,
  disabled,
  children,
}: SvgZoomBoxProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ChartBox>(view);
  viewRef.current = view;
  const fullRef = useRef<ChartBox>(full);
  fullRef.current = full;
  const plotRef = useRef<PlotFrac>(plotFrac);
  plotRef.current = plotFrac;

  const spanX = full.x[1] - full.x[0];
  const spanY = full.y[1] - full.y[0];
  const off = disabled || spanX <= 0 || spanY <= 0;

  const msFor = () => ({
    x: (fullRef.current.x[1] - fullRef.current.x[0]) * minSpanFrac,
    y: (fullRef.current.y[1] - fullRef.current.y[0]) * minSpanFrac,
  });

  // Cursor position as domain fractions of the plot rect. y is inverted so the top
  // of the plot (max domain y) maps to fraction 1.
  const fracFor = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return { fracX: 0.5, fracY: 0.5 };
    const rect = el.getBoundingClientRect();
    const p = plotRef.current;
    const px = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const py = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    const fx = Math.max(0, Math.min(1, (px - p.left) / p.width));
    const fyTop = Math.max(0, Math.min(1, (py - p.top) / p.height));
    return { fracX: fx, fracY: 1 - fyTop };
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || off) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_IN : WHEEL_OUT;
      const { fracX, fracY } = fracFor(e.clientX, e.clientY);
      const ms = msFor();
      onChange(zoomBoxAtPoint(viewRef.current, fullRef.current, fracX, fracY, factor, ms.x, ms.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, minSpanFrac, onChange]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (off) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = plotRef.current;
    const plotWpx = Math.max(1, rect.width * p.width);
    const plotHpx = Math.max(1, rect.height * p.height);
    const startX = e.clientX;
    const startY = e.clientY;
    const startView: ChartBox = {
      x: viewRef.current.x.slice() as [number, number],
      y: viewRef.current.y.slice() as [number, number],
    };
    const move = (ev: MouseEvent) => {
      // Grab-pan: data follows the cursor. x mirrors SvgZoomFrame; y is screen-
      // inverted so dragging down shifts the window toward higher domain y.
      const deltaFracX = -((ev.clientX - startX) / plotWpx);
      const deltaFracY = (ev.clientY - startY) / plotHpx;
      const ms = msFor();
      onChange(panBox(startView, fullRef.current, deltaFracX, deltaFracY, ms.x, ms.y));
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
      style={{ cursor: off ? undefined : 'grab', touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
