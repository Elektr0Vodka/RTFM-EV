import { cn } from '@/lib/utils';

/** A pulsing grey block standing in for content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-muted', className)} />;
}

/**
 * Placeholder for a list of chat messages: bubbles of varying width, some on
 * the right (sent). ``label`` is read out by screen readers and kept in the
 * DOM, so it can still be found as text.
 */
export function MessageListSkeleton({ label }: { label: string }) {
  const rows = [
    { mine: false, width: 'w-2/3' },
    { mine: false, width: 'w-1/2' },
    { mine: true, width: 'w-2/5' },
    { mine: false, width: 'w-3/5' },
    { mine: true, width: 'w-1/2' },
    { mine: false, width: 'w-1/3' },
  ];
  return (
    <div className="flex-1 overflow-hidden p-4 space-y-4" role="status">
      <span className="sr-only">{label}</span>
      {rows.map((row, i) => (
        <div key={i} className={cn('flex flex-col gap-1.5', row.mine && 'items-end')}>
          {!row.mine && <Skeleton className="h-3 w-24" />}
          <Skeleton className={cn('h-9 rounded-lg', row.width)} />
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for a page or pane: a title bar and a few blocks of text. Used
 * while a lazily loaded view or a detail pane fetches its data.
 */
export function PaneSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex-1 flex flex-col gap-4 overflow-hidden p-5', className)} role="status">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
