import { LOCALES, useLocale, useT, type Locale } from '../../i18n';

const LANG_LABELS: Record<Locale, { flag: string; name: string }> = {
  en: { flag: '🇬🇧', name: 'English' },
  nl: { flag: '🇳🇱', name: 'Nederlands' },
  de: { flag: '🇩🇪', name: 'Deutsch' },
};

export function LanguageSelector() {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <fieldset className="flex flex-wrap gap-2 md:grid md:grid-cols-3">
      <legend className="sr-only">{t('settings_language')}</legend>
      {LOCALES.map((l) => (
        <label
          key={l}
          className={
            'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border transition-colors focus-within:ring-2 focus-within:ring-ring md:w-full ' +
            (locale === l
              ? 'border-primary bg-primary/5'
              : 'border-transparent hover:bg-accent/50')
          }
        >
          <input
            type="radio"
            name="language"
            value={l}
            checked={locale === l}
            onChange={() => setLocale(l)}
            className="sr-only"
          />
          <span aria-hidden="true">{LANG_LABELS[l].flag}</span>
          <span className="text-xs whitespace-nowrap">{LANG_LABELS[l].name}</span>
        </label>
      ))}
    </fieldset>
  );
}
