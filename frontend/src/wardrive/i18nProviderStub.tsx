// Stands in for ../i18n/I18nProvider in the wardrive page build only
// (vite.wardrive.config.ts). The real provider imports every language, and
// as long as the page's module graph reaches it, Dutch and German land in the
// page bundle. The page uses WardrivePageI18n instead.
import type { ReactNode } from 'react';

export { useT, useLocale, type TFn } from '../i18n/context';

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  return children;
}
