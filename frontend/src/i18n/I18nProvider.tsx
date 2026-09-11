import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
  type Params,
} from './i18n';

const CATALOGS: Record<Locale, Catalog> = {
  en: en as Catalog,
  nl: nl as Catalog,
  de: de as Catalog,
};

export type TFn = (key: string, params?: Params) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
}

function readSaved(): Locale {
  try {
    return resolveLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  // Outside a provider (e.g. in isolated component tests), still resolve to the
  // English catalog rather than echoing the raw key, so text stays readable.
  t: (key, params) => translate(CATALOGS, DEFAULT_LOCALE, key, params),
});

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

export function useT(): TFn {
  return useContext(I18nContext).t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
