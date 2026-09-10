import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { LOCALES, useLocale, useT, type Locale } from '../i18n';
import { cn } from '@/lib/utils';

const LANG_LABELS: Record<Locale, { flag: string; name: string }> = {
  en: { flag: '🇬🇧', name: 'English' },
  nl: { flag: '🇳🇱', name: 'Nederlands' },
  de: { flag: '🇩🇪', name: 'Deutsch' },
};

/**
 * Compact language switcher for the header, modeled on the DutchMeshCore
 * toolbox: a flag + uppercase code trigger that opens a menu of flag + name
 * options with a check on the active one. Mirrors the full LanguageSelector in
 * Settings but sized for the status bar.
 */
export function HeaderLanguageMenu() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSelect = (l: Locale) => {
    setLocale(l);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('settings_language')}
        title={t('settings_language')}
        className="flex items-center gap-1 px-1.5 py-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">{LANG_LABELS[locale].flag}</span>
        <span className="text-[0.6875rem] font-medium">{locale.toUpperCase()}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[9rem] rounded-md border border-border bg-card p-1 shadow-lg z-50"
        >
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={locale === l}
              onClick={() => handleSelect(l)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                locale === l ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <span aria-hidden="true">{LANG_LABELS[l].flag}</span>
              <span className="flex-1 whitespace-nowrap">{LANG_LABELS[l].name}</span>
              {locale === l && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
