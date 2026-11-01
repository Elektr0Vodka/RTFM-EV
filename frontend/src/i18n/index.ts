export {
  LOCALES,
  DEFAULT_LOCALE,
  STORAGE_KEY,
  isLocale,
  resolveLocale,
  interpolate,
  translate,
  type Locale,
  type Catalog,
  type Entry,
  type Params,
  type PluralForms,
} from './i18n';
export { useT, useLocale, type TFn } from './context';
export { I18nProvider } from './I18nProvider';
