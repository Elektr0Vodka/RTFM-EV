import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import {
  DEFAULT_LOCALE,
  STORAGE_KEY,
  resolveLocale,
  translate,
  type Catalog,
  type Locale,
} from './i18n';
import { I18nContext, type TFn } from './context';

const CATALOGS: Record<Locale, Catalog> = {
  en: en as Catalog,
  nl: nl as Catalog,
  de: de as Catalog,
};

export { useT, useLocale, type TFn } from './context';

function readSaved(): Locale {
  try {
    return resolveLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readSaved);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  const t = useCallback<TFn>((key, params) => translate(CATALOGS, locale, key, params), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
