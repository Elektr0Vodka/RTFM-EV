/**
 * Format/parse helpers for the setting-aware date/time input (`DateTimeField`).
 *
 * Native `<input type="date"/datetime-local">` widgets always display in the
 * browser locale (mm/dd/yyyy on a US browser) and cannot be reformatted by the
 * app. `DateTimeField` shows its own text field instead, formatted and parsed
 * per the app's date/time setting; these helpers do that conversion to and from
 * the native value strings (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`).
 */
import { getActiveDateTimeFormat } from './dateTimeFormat';

export type DateFieldMode = 'date' | 'datetime';

interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Day/month/year order for a locale, e.g. ['month','day','year'] for en-US. */
function partsOrder(locale: string): ('day' | 'month' | 'year')[] {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.UTC(2001, 1, 3)));
  return parts
    .filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')
    .map((p) => p.type as 'day' | 'month' | 'year');
}

/** Parse a native value (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`) into parts. */
export function parseNativeValue(value: string): DateParts | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { y, mo, d, h, mi };
}

function toNativeValue(c: DateParts, mode: DateFieldMode): string {
  const date = `${pad(c.y, 4)}-${pad(c.mo)}-${pad(c.d)}`;
  return mode === 'datetime' ? `${date}T${pad(c.h)}:${pad(c.mi)}` : date;
}

function formatTimePart(h: number, mi: number, hour12: boolean): string {
  if (!hour12) return `${pad(h)}:${pad(mi)}`;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(h12)}:${pad(mi)} ${ampm}`;
}

/** Format a native value for display in the field, per the active setting. */
export function formatFieldDisplay(value: string, mode: DateFieldMode): string {
  const c = parseNativeValue(value);
  if (!c) return '';
  const fmt = getActiveDateTimeFormat();
  const map: Record<'day' | 'month' | 'year', string> = {
    day: pad(c.d),
    month: pad(c.mo),
    year: pad(c.y, 4),
  };
  const datePart = partsOrder(fmt.locale)
    .map((k) => map[k])
    .join('/');
  if (mode === 'date') return datePart;
  return `${datePart} ${formatTimePart(c.h, c.mi, fmt.hour12)}`;
}

/** Placeholder text showing the expected format, per the active setting. */
export function fieldPlaceholder(mode: DateFieldMode): string {
  const fmt = getActiveDateTimeFormat();
  const label: Record<'day' | 'month' | 'year', string> = {
    day: 'dd',
    month: 'mm',
    year: 'yyyy',
  };
  const datePart = partsOrder(fmt.locale)
    .map((k) => label[k])
    .join('/');
  if (mode === 'date') return datePart;
  return fmt.hour12 ? `${datePart} hh:mm AM` : `${datePart} HH:mm`;
}

/**
 * Parse user-typed text (in the active display format) back to a native value.
 * Returns the native string, `''` when the text is blank (clears the value), or
 * `null` when the text cannot be parsed.
 */
export function parseFieldDisplay(text: string, mode: DateFieldMode): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const fmt = getActiveDateTimeFormat();
  const m = trimmed.match(
    /^(\d{1,4})[/\-. ](\d{1,2})[/\-. ](\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/
  );
  if (!m) return null;
  const nums = [+m[1], +m[2], +m[3]];
  const order = partsOrder(fmt.locale);
  const comp: Record<'day' | 'month' | 'year', number> = { day: 1, month: 1, year: 2000 };
  order.forEach((k, i) => {
    comp[k] = nums[i];
  });
  let { year } = comp;
  const { day, month } = comp;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return null;

  let h = 0;
  let mi = 0;
  if (mode === 'datetime' && m[4] !== undefined) {
    h = +m[4];
    mi = +m[5];
    const ap = m[6]?.toUpperCase();
    if (ap === 'AM' && h === 12) h = 0;
    else if (ap === 'PM' && h !== 12) h += 12;
    if (h > 23 || mi > 59) return null;
  }
  return toNativeValue({ y: year, mo: month, d: day, h, mi }, mode);
}
