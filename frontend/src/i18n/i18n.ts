export type Locale = 'en' | 'nl' | 'de';
export const LOCALES: readonly Locale[] = ['en', 'nl', 'de'] as const;
export const DEFAULT_LOCALE: Locale = 'en';
export const STORAGE_KEY = 'locale';

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Entry = string | PluralForms;
export type Catalog = Record<string, Entry>;
export type Params = Record<string, string | number>;

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export function resolveLocale(saved: string | null): Locale {
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

export function interpolate(tpl: string, params?: Params): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m,
  );
}

function pickForm(entry: Entry, locale: Locale, params?: Params): string | undefined {
  if (typeof entry === 'string') return entry;
  const count = params?.count;
  if (typeof count === 'number') {
    const category = new Intl.PluralRules(locale).select(count);
    return entry[category] ?? entry.other;
  }
  return entry.other ?? Object.values(entry)[0];
}

export function translate(
  catalogs: Record<Locale, Catalog>,
  locale: Locale,
  key: string,
  params?: Params,
): string {
  const hasLocal = catalogs[locale]?.[key] !== undefined;
  const chosenLocale: Locale = hasLocal ? locale : DEFAULT_LOCALE;
  const entry = catalogs[chosenLocale]?.[key];
  if (entry === undefined) return key;
  const form = pickForm(entry, chosenLocale, params);
  if (form === undefined) return key;
  return interpolate(form, params);
}
