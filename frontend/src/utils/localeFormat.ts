import type { Locale } from '../i18n';

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDateTime(
  locale: Locale,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}
