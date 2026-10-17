import { useEffect, useId, useState } from 'react';

import { useT } from '../../i18n';
import {
  CVD_MODES,
  getSavedCvdMode,
  getSavedReadingFont,
  READING_FONTS,
  setSavedCvdMode,
  setSavedReadingFont,
  watchAccessibility,
  type CvdMode,
  type ReadingFont,
} from '../../utils/accessibility';
import { Label } from '../ui/label';

const SELECT_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Colourblind mode and reading font (per browser). Full form in Settings >
 * Local; `compact` is the body of the quick theme dialog's Accessibility
 * section (no heading of its own). Both can be mounted at once, so ids are generated.
 */
export function AccessibilitySettings({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const id = useId();
  const cvdId = `${id}-cvd-mode`;
  const fontId = `${id}-reading-font`;
  const [cvdMode, setCvdMode] = useState<CvdMode>(getSavedCvdMode);
  const [readingFont, setReadingFont] = useState<ReadingFont>(getSavedReadingFont);

  // Follow a change made in another tab or the chat popup.
  useEffect(
    () =>
      watchAccessibility(() => {
        setCvdMode(getSavedCvdMode());
        setReadingFont(getSavedReadingFont());
      }),
    []
  );

  return (
    <section className={compact ? 'mt-4 space-y-3' : 'space-y-4'}>
      {/* Compact sits under the theme dialog's own collapsible "Accessibility" header. */}
      {!compact && (
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_accessibility_heading')}
        </h3>
      )}

      <div className="space-y-2">
        <Label htmlFor={cvdId}>{t('settings_cvd_mode_label')}</Label>
        <select
          id={cvdId}
          value={cvdMode}
          onChange={(event) => {
            const next = event.target.value as CvdMode;
            setSavedCvdMode(next);
            setCvdMode(next);
          }}
          className={SELECT_CLASS}
        >
          {CVD_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`settings_cvd_mode_${mode}`)}
            </option>
          ))}
        </select>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_cvd_mode_help')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fontId}>{t('settings_reading_font_label')}</Label>
        <select
          id={fontId}
          value={readingFont}
          onChange={(event) => {
            const next = event.target.value as ReadingFont;
            setSavedReadingFont(next);
            setReadingFont(next);
          }}
          className={SELECT_CLASS}
        >
          {READING_FONTS.map((font) => (
            <option key={font} value={font}>
              {t(`settings_reading_font_${font}`)}
            </option>
          ))}
        </select>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_reading_font_help')}</p>
      </div>
    </section>
  );
}
