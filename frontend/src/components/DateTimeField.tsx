import { useRef, useState, useSyncExternalStore } from 'react';
import { Calendar } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useT } from '../i18n';
import { getActiveDateTimeFormat, subscribeActiveDateTimeFormat } from '../utils/dateTimeFormat';
import {
  fieldPlaceholder,
  formatFieldDisplay,
  parseFieldDisplay,
  type DateFieldMode,
} from '../utils/dateFieldFormat';

/**
 * Theme-aware base styling for the visible text field. Kept here (not left to
 * each caller) so the field is always readable in every theme: without an
 * explicit `text-foreground`, the input inherits its parent's color, which is
 * `text-muted-foreground` in some contexts (e.g. the map filter label) and made
 * the field look washed-out / "very white". Callers add layout (width, height,
 * padding, font-size) via `className`, which wins over these defaults through
 * tailwind-merge.
 */
const BASE_FIELD_CLASS =
  'rounded-md border border-input bg-background text-foreground ' +
  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

interface DateTimeFieldProps {
  /** 'date' -> value `YYYY-MM-DD`; 'datetime' -> value `YYYY-MM-DDTHH:mm`. */
  mode?: DateFieldMode;
  /** Native value string (same as the replaced `<input type="date"/datetime-local">`). */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}

/**
 * A date / datetime input whose text field is formatted and parsed per the app's
 * date/time setting (unlike a native `<input type="date">`, which always shows
 * the browser locale). The calendar button opens the native picker for
 * selection; the visible field displays and accepts the app's format.
 */
export function DateTimeField({
  mode = 'date',
  value,
  onChange,
  className,
  id,
  'aria-label': ariaLabel,
  min,
  max,
  disabled,
}: DateTimeFieldProps) {
  const t = useT();
  const nativeRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');

  // Re-render when the active date/time format changes so the display and
  // placeholder follow the setting without a reload.
  useSyncExternalStore(subscribeActiveDateTimeFormat, getActiveDateTimeFormat);

  const display = formatFieldDisplay(value, mode);
  const placeholder = fieldPlaceholder(mode);

  const commit = () => {
    const parsed = parseFieldDisplay(text, mode);
    if (parsed !== null && parsed !== value) onChange(parsed);
    setFocused(false);
  };

  const openPicker = () => {
    const el = nativeRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // Fallback for browsers without showPicker(): focusing exposes the picker.
      el.focus();
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <input
        type="text"
        inputMode="numeric"
        id={id}
        className={cn(BASE_FIELD_CLASS, className)}
        value={focused ? text : display}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          setText(display);
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={t('date_field_open_calendar')}
        title={t('date_field_open_calendar')}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <Calendar className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* Hidden native input: holds the canonical value and provides the OS
          calendar via showPicker(). Kept rendered (opacity-0) so showPicker
          anchors to the field; pointer-events-none so it never blocks typing. */}
      <input
        ref={nativeRef}
        type={mode === 'datetime' ? 'datetime-local' : 'date'}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </span>
  );
}
