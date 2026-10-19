// The translation context and its hooks, without the catalogs of every
// language: a provider fills it. Kept apart from I18nProvider so a page that
// loads only one language (the wardrive page) does not bundle all three.
import { createContext, useContext } from 'react';
import en from './locales/en.json';
import { DEFAULT_LOCALE, translate, type Catalog, type Locale, type Params } from './i18n';

export type TFn = (key: string, params?: Params) => string;

export interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
}

const EN_ONLY = { en: en as Catalog } as Record<Locale, Catalog>;

export const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  // Outside a provider (e.g. in isolated component tests), still resolve to the
  // English catalog rather than echoing the raw key, so text stays readable.
  t: (key, params) => translate(EN_ONLY, DEFAULT_LOCALE, key, params),
});

export function useT(): TFn {
  return useContext(I18nContext).t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
