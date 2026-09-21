/**
 * Central date/time formatting driven by a user preference.
 *
 * The app used to format dates/times ad-hoc across ~20 files: some hardcoded
 * 24-hour, others used the browser locale, and date order (mm/dd vs dd/mm)
 * varied. This module funnels all of it through one resolved format so a single
 * setting controls the whole UI:
 *
 *   - `auto`     follow the UI language (EN -> 12h + mm/dd/yyyy,
 *                NL/DE -> 24h + dd/mm/yyyy)
 *   - `12h_mdy`  force 12-hour clock + mm/dd/yyyy
 *   - `24h_dmy`  force 24-hour clock + dd/mm/yyyy
 *
 * Rather than thread the preference through every component and util, App keeps
 * a module-level "active format" in sync on each render (a pure derivation from
 * the setting + UI locale), and the formatting helpers read it. App re-renders
 * on a settings change, so the tree re-renders with the new format.
 */

export type DateTimeFormatPref = 'auto' | '12h_mdy' | '24h_dmy';

export const DATE_TIME_FORMAT_PREFS: readonly DateTimeFormatPref[] = ['auto', '12h_mdy', '24h_dmy'];

export interface ResolvedDateTimeFormat {
  /** true = 12-hour clock (AM/PM); false = 24-hour clock. */
  hour12: boolean;
  /** BCP-47 locale that drives date order (mm/dd vs dd/mm) and month/day names. */
  locale: string;
}

/**
 * Resolve a preference + UI language into a concrete {hour12, locale}. Locale is
 * chosen purely for its date ordering and names; `hour12` is always applied
 * explicitly so the clock style never depends on the locale's own default.
 */
export function resolveDateTimeFormat(
  pref: DateTimeFormatPref,
  uiLocale: string
): ResolvedDateTimeFormat {
  switch (pref) {
    case '12h_mdy':
      return { hour12: true, locale: 'en-US' };
    case '24h_dmy':
      return { hour12: false, locale: 'en-GB' };
    case 'auto':
    default: {
      const lang = (uiLocale || 'en').toLowerCase();
      if (lang.startsWith('nl')) return { hour12: false, locale: 'nl-NL' };
      if (lang.startsWith('de')) return { hour12: false, locale: 'de-DE' };
      // English (and any unknown language) default to US 12-hour + mm/dd/yyyy.
      return { hour12: true, locale: 'en-US' };
    }
  }
}

// The active format, kept in sync by App on each render. Defaults to the `auto`
// English resolution so isolated renders (e.g. tests) are deterministic.
let activeFormat: ResolvedDateTimeFormat = resolveDateTimeFormat('auto', 'en');

const listeners = new Set<() => void>();

/**
 * Subscribe to active-format changes. Used with `useSyncExternalStore` so a
 * component (e.g. the date picker) re-renders when the setting changes without a
 * page reload. Returns an unsubscribe function.
 */
export function subscribeActiveDateTimeFormat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set the active format. Called by App as the setting / UI locale changes. */
export function setActiveDateTimeFormat(fmt: ResolvedDateTimeFormat): void {
  // No-op when unchanged so the snapshot reference stays stable (avoids
  // `useSyncExternalStore` loops) and subscribers only fire on real changes.
  if (activeFormat.hour12 === fmt.hour12 && activeFormat.locale === fmt.locale) return;
  activeFormat = fmt;
  for (const listener of listeners) listener();
}

/** The current active format (for callers that need the raw {hour12, locale}). */
export function getActiveDateTimeFormat(): ResolvedDateTimeFormat {
  return activeFormat;
}

/**
 * Format a date/time value using the active format. Pass the same
 * `Intl.DateTimeFormatOptions` you would give `toLocale*String`; the active
 * locale is used, and `hour12` is injected whenever the options include a time
 * field (hour/minute/second) so the clock style follows the setting.
 */
export function formatDateTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const opts: Intl.DateTimeFormatOptions = { ...options };
  if (opts.hour !== undefined || opts.minute !== undefined || opts.second !== undefined) {
    opts.hour12 = activeFormat.hour12;
  }
  return new Intl.DateTimeFormat(activeFormat.locale, opts).format(value);
}
