// A block over the map the driver can drag by its handle (the live log): it
// keeps its spot in this browser, stays on screen, and goes back home on a
// double tap of the handle. Only the handle starts a drag, so the content
// scrolls and taps as usual. Given an area (the coverage map's list), it
// stays inside that area instead, wherever its home spot is.
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';

interface Offset {
  x: number;
  y: number;
}

const HOME: Offset = { x: 0, y: 0 };

function readOffset(key: string): Offset {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : HOME;
  } catch {
    return HOME;
  }
}

function saveOffset(key: string, o: Offset | null): void {
  try {
    if (o) localStorage.setItem(key, JSON.stringify(o));
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the spot is kept for this page load only.
  }
}

/** Keeps the panel (centred at its home spot, `width` px wide) on screen. */
function clamp(o: Offset, width: number): Offset {
  const w = typeof window === 'undefined' ? 0 : window.innerWidth;
  const h = typeof window === 'undefined' ? 0 : window.innerHeight;
  const side = width > 0 ? Math.max(0, (w - width) / 2) : w / 2;
  return {
    x: Math.round(Math.max(-side, Math.min(side, o.x))),
    y: Math.round(Math.max(0, Math.min(Math.max(0, h - 96), o.y))),
  };
}

/**
 * Keeps the whole panel inside `area`. `rect` is where the panel sat at
 * offset `from`; a panel larger than the area sticks to its top-left.
 */
function clampInside(o: Offset, from: Offset, rect: DOMRect, area: DOMRect): Offset {
  const range = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  return {
    x: Math.round(from.x + range(area.left - rect.left, area.right - rect.right, o.x - from.x)),
    y: Math.round(from.y + range(area.top - rect.top, area.bottom - rect.bottom, o.y - from.y)),
  };
}

export function MovablePanel({
  storageKey,
  handleLabel,
  bounds,
  children,
}: {
  storageKey: string;
  handleLabel: string;
  /** The area to stay inside, found from the panel; without it the panel stays on screen. */
  bounds?: (panel: HTMLElement) => Element | null;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState<Offset>(() => readOffset(storageKey));
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    from: Offset;
    rect: DOMRect | null;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const width = () => panelRef.current?.offsetWidth ?? 0;
  const area = () => {
    const el = panelRef.current;
    return (el && bounds?.(el)?.getBoundingClientRect()) ?? null;
  };

  // The offset on screen now: what the panel's measured spot belongs to.
  const shown = useRef(offset);
  useLayoutEffect(() => {
    shown.current = offset;
  }, [offset]);

  // A spot kept from an earlier visit may lie outside the area, and the
  // panel or the area can change size (rows load, a fold, a window resize):
  // pull it back in whenever that happens.
  useLayoutEffect(() => {
    const el = panelRef.current;
    const target = el && bounds?.(el);
    if (!el || !target) return;
    const refit = () => {
      if (drag.current) return;
      const o = shown.current;
      const next = clampInside(o, o, el.getBoundingClientRect(), target.getBoundingClientRect());
      if (next.x !== o.x || next.y !== o.y) setOffset(next);
    };
    refit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    ro.observe(target);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fit = (d: NonNullable<typeof drag.current>, e: PointerEvent<HTMLButtonElement>) => {
    const want = { x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y };
    const a = area();
    return a && d.rect ? clampInside(want, d.from, d.rect, a) : clamp(want, width());
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    const rect = bounds ? (panelRef.current?.getBoundingClientRect() ?? null) : null;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset, rect };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset(fit(d, e));
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const next = fit(d, e);
    setOffset(next);
    saveOffset(storageKey, next);
  };

  return (
    <div
      ref={panelRef}
      data-testid="movable-panel"
      className="pointer-events-auto flex max-h-full w-full max-w-md flex-col items-center"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <button
        type="button"
        aria-label={handleLabel}
        title={handleLabel}
        className="flex h-5 w-16 touch-none items-center justify-center rounded-t-md bg-card/90 text-muted-foreground"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => {
          setOffset(HOME);
          saveOffset(storageKey, null);
        }}
      >
        <GripHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex min-h-0 w-full flex-col">{children}</div>
    </div>
  );
}
