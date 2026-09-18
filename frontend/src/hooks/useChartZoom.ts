import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampWindow,
  panByFraction,
  zoomAtFraction,
  WHEEL_IN,
  WHEEL_OUT,
  type ChartWindow,
} from '../lib/chartZoom';

// useChartZoom drives the reference-style wheel-zoom / drag-pan / dblclick-reset
// interaction for a Recharts chart with a numeric X axis. The chart binds
// `domain` onto its `<XAxis domain={domain} allowDataOverflow type="number" />`
// and spreads `containerProps` onto a <div> wrapping the ResponsiveContainer.
//
// The zoom math lives in ../lib/chartZoom (shared, unit-tested); this hook only
// wires DOM events and maps a cursor clientX to a fraction of the plot width.
//
// `inset` is the plot's horizontal padding inside the wrapper (left = YAxis
// width + left margin, right = right margin). It sharpens cursor anchoring; when
// omitted the whole wrapper width is used (a small anchor drift near the axes).

export interface PlotInset {
  left: number;
  right: number;
}

export interface UseChartZoomResult {
  domain: ChartWindow;
  isZoomed: boolean;
  isPanning: boolean;
  reset: () => void;
  containerProps: {
    ref: React.RefObject<HTMLDivElement>;
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    style: React.CSSProperties;
  };
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function useChartZoom(
  full: ChartWindow,
  opts: { minSpan: number; inset?: PlotInset; disabled?: boolean }
): UseChartZoomResult {
  const { minSpan, inset, disabled } = opts;
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ChartWindow>(full);
  const [isPanning, setIsPanning] = useState(false);

  const fullRef = useRef<ChartWindow>(full);
  const viewRef = useRef<ChartWindow>(view);
  viewRef.current = view;
  const insetRef = useRef<PlotInset | undefined>(inset);
  insetRef.current = inset;

  const fMin = full[0];
  const fMax = full[1];

  // Follow the data extent when it changes: if the user was at full range, track
  // the new range; otherwise clamp the existing (zoomed) window into it.
  useEffect(() => {
    const next: ChartWindow = [fMin, fMax];
    const prev = fullRef.current;
    const wasFull = viewRef.current[0] <= prev[0] && viewRef.current[1] >= prev[1];
    fullRef.current = next;
    setView(wasFull ? next : clampWindow(viewRef.current, next, minSpan));
  }, [fMin, fMax, minSpan]);

  const plotMetrics = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const left = insetRef.current?.left ?? 0;
    const right = insetRef.current?.right ?? 0;
    const innerW = Math.max(1, rect.width - left - right);
    return { originX: rect.left + left, innerW };
  }, []);

  const fracForClientX = useCallback(
    (clientX: number) => {
      const m = plotMetrics();
      if (!m) return 0.5;
      return clampNum((clientX - m.originX) / m.innerW, 0, 1);
    },
    [plotMetrics]
  );

  // Wheel is bound natively so it can preventDefault (React onWheel is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const frac = fracForClientX(e.clientX);
      const factor = e.deltaY < 0 ? WHEEL_IN : WHEEL_OUT;
      setView((v) => zoomAtFraction(v, fullRef.current, frac, factor, minSpan));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [disabled, minSpan, fracForClientX]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      const m = plotMetrics();
      if (!m) return;
      const startX = e.clientX;
      const startView = viewRef.current.slice() as ChartWindow;
      setIsPanning(true);
      const move = (ev: MouseEvent) => {
        const deltaFrac = -((ev.clientX - startX) / m.innerW);
        setView(panByFraction(startView, fullRef.current, deltaFrac, minSpan));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setIsPanning(false);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [disabled, minSpan, plotMetrics]
  );

  const reset = useCallback(() => setView(fullRef.current), []);

  const isZoomed = view[0] > fMin || view[1] < fMax;

  return {
    domain: disabled ? [fMin, fMax] : view,
    isZoomed,
    isPanning,
    reset,
    containerProps: {
      ref: containerRef,
      onMouseDown,
      onDoubleClick: reset,
      style: {
        cursor: disabled ? undefined : isPanning ? 'grabbing' : 'grab',
        touchAction: 'pan-y',
      },
    },
  };
}
