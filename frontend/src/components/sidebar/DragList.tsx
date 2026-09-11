import { useRef, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DragListProps<T extends string> {
  items: T[];
  labels: Record<string, string>;
  onReorder: (next: T[]) => void;
  moveUpLabel: string;
  moveDownLabel: string;
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

// A reorderable list: native HTML5 drag for pointer devices, plus always-visible
// up/down move buttons so touch and keyboard users reorder identically. Drag does
// not fire on touch and competes with the mobile drawer swipe gestures, so the
// move buttons are the platform-agnostic path.
export function DragList<T extends string>({
  items,
  labels,
  onReorder,
  moveUpLabel,
  moveDownLabel,
}: DragListProps<T>) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === i) return;
    onReorder(move(items, from, i));
  };

  return (
    <ul className="space-y-1" role="list">
      {items.map((item, i) => (
        <li
          key={item}
          role="listitem"
          draggable
          onDragStart={() => (dragIndex.current = i)}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={() => {
            dragIndex.current = null;
            setOverIndex(null);
          }}
          className={cn(
            'flex items-center gap-2 rounded px-2 py-1.5 bg-background border border-border select-none transition-all',
            overIndex === i && dragIndex.current !== i && 'border-primary bg-accent'
          )}
        >
          <GripVertical
            className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 cursor-grab active:cursor-grabbing"
            aria-hidden="true"
          />
          <span className="text-[13px] text-foreground flex-1 truncate">{labels[item] ?? item}</span>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onReorder(move(items, i, i - 1))}
            disabled={i === 0}
            aria-label={moveUpLabel}
            title={moveUpLabel}
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onReorder(move(items, i, i + 1))}
            disabled={i === items.length - 1}
            aria-label={moveDownLabel}
            title={moveDownLabel}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
