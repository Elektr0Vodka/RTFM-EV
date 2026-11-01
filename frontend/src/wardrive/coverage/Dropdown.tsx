// A button with a panel under it, closed by Escape or a press outside. The
// coverage map's bar pickers use it; on a phone the panel takes the width.
import { useEffect, useRef, type ReactNode } from 'react';

export function Dropdown({
  open,
  onOpenChange,
  button,
  children,
  align = 'left',
  wide = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  button: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative">
      {button}
      {open && (
        <div
          className={`absolute top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${wide ? 'w-80' : 'w-72'} max-w-[calc(100vw-1rem)]`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const BAR_BUTTON =
  'inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-sm hover:bg-muted';
