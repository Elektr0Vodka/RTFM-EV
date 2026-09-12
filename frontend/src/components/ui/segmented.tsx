import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedUnread = 'none' | 'unread' | 'mention';

export interface SegmentedOption {
  value: string;
  label: string;
  count: number;
  unread: SegmentedUnread;
}

interface SegmentedPillsProps {
  ariaLabel: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

// A wrapping radio group of filter pills. The active pill is the only tab stop;
// arrow keys move the selection (roving). Wraps to multiple rows so every pill
// stays visible inside the 280px mobile drawer.
export function SegmentedPills({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: SegmentedPillsProps) {
  const move = (delta: number) => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const next = options[(idx + delta + options.length) % options.length];
    onChange(next.value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-1 px-2.5 pb-2 pt-0.5', className)}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary/10 text-primary font-medium'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{opt.label}</span>
            <span className="tabular-nums opacity-70">{opt.count}</span>
            {opt.unread !== 'none' && (
              <span
                data-testid="pill-unread-dot"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  opt.unread === 'mention' ? 'bg-badge-mention' : 'bg-badge-unread'
                )}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
