import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import {
  clampZoom,
  defaultView,
  panBy,
  renderRadar,
  zoomAt,
  RADAR_MAX_ZOOM,
  type RadarData,
  type RadarView,
} from './radar';

interface Props {
  data: RadarData;
}

// DirectRadar owns the <canvas>, the range-zoom + viewport-view state, and the
// pointer/resize/theme wiring. The draw itself lives in renderRadar.
export function DirectRadar({ data }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<RadarView>(defaultView());
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderRadar(canvas, data, {
      zoom,
      view,
      text: {
        noLocation: t('node_radar_no_location'),
        noContacts: t('node_radar_no_contacts'),
        snrLabel: t('node_radar_snr_label'),
        ringsLabel: t('node_radar_rings_label'),
        noSnrLabel: t('node_radar_no_snr_label'),
        sizeLabel: t('node_radar_size_label'),
      },
    });
  }, [data, zoom, view, t]);

  // Repaint on data/zoom/view/text change.
  useEffect(() => {
    paint();
  }, [paint]);

  // Repaint on card resize (canvas has no CSS reflow).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paint]);

  // Repaint on theme change: the app themes via the data-theme attribute (and
  // class) on the document element, which canvas does not inherit like CSS vars.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => paint());
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => mo.disconnect();
  }, [paint]);

  // Wheel-zoom is bound as a native, non-passive listener: React attaches onWheel
  // as passive, so e.preventDefault() there is ignored and the page scrolls in
  // addition to zooming. Binding directly lets us cancel the page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      // Shift+wheel drives the data-scale range-zoom; plain wheel magnifies the
      // viewport about the cursor.
      if (e.shiftKey) {
        setZoom((z) => clampZoom(z * factor));
      } else {
        setView((v) => zoomAt(v, mx, my, factor, rect.width / 2, rect.height / 2));
      }
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => panBy(v, dx, dy));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onDoubleClick = useCallback(() => {
    setZoom(1);
    setView(defaultView());
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-end gap-1 px-1">
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-xs text-foreground"
          onClick={() => setZoom((z) => clampZoom(z * 1.5))}
          aria-label={t('node_radar_zoom_in')}
        >
          +
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-xs text-foreground"
          onClick={() => setZoom((z) => clampZoom(z / 1.5))}
          aria-label={t('node_radar_zoom_out')}
        >
          -
        </button>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {t('node_radar_zoom_level', { current: zoom.toFixed(1), max: RADAR_MAX_ZOOM })}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-72 w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
