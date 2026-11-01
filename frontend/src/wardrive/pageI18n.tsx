// The wardrive page's translations: English is always there (the fallback in
// ../i18n/context), the saved language is loaded on its own when it is not
// English, so the page does not carry all three catalogs. The language is the
// one the main app saved (same origin, same storage key).
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import en from '../i18n/locales/en.json';
import { I18nContext, type TFn } from '../i18n/context';
import {
  DEFAULT_LOCALE,
  STORAGE_KEY,
  resolveLocale,
  translate,
  type Catalog,
  type Locale,
} from '../i18n/i18n';

const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<{ default: unknown }>> = {
  nl: () => import('../i18n/locales/nl.json'),
  de: () => import('../i18n/locales/de.json'),
};

function savedLocale(): Locale {
  try {
    return resolveLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function WardrivePageI18n({ children }: { children: ReactNode }) {
  const [locale] = useState<Locale>(savedLocale);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    if (locale === 'en') return;
    let cancelled = false;
    void LOADERS[locale]().then((m) => {
      if (!cancelled) setCatalog(m.default as Catalog);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const shown: Locale = catalog ? locale : 'en';
  // In the same commit as the text, so lang never lags behind the language.
  useLayoutEffect(() => {
    document.documentElement.lang = shown;
  }, [shown]);

  const value = useMemo(() => {
    const catalogs = { en: en as Catalog, ...(catalog ? { [locale]: catalog } : {}) } as Record<
      Locale,
      Catalog
    >;
    const t: TFn = (key, params) => translate(catalogs, shown, key, params);
    return { locale: shown, setLocale: () => {}, t };
  }, [catalog, locale, shown]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
