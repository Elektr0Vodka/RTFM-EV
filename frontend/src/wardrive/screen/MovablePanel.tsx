// A block over the map the driver can drag by its handle (the live log): it
// keeps its spot in this browser, stays on screen, and goes back home on a
// double tap of the handle. Only the handle starts a drag, so the content
// scrolls and taps as usual.
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
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

export function MovablePanel({
  storageKey,
  handleLabel,
  children,
}: {
  storageKey: string;
  handleLabel: string;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState<Offset>(() => readOffset(storageKey));
  const drag = useRef<{ id: number; x: number; y: number; from: Offset } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const width = () => panelRef.current?.offsetWidth ?? 0;

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset(clamp({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }, width()));
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const next = clamp({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }, width());
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
