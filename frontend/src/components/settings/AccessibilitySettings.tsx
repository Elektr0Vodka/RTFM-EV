import { useEffect, useState } from 'react';

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

/** Settings > Local > Accessibility: colourblind mode and reading font (per browser). */
export function AccessibilitySettings() {
  const t = useT();
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
    <div className="space-y-4">
      <h3 className="text-base font-semibold tracking-tight">
        {t('settings_accessibility_heading')}
      </h3>

      <div className="space-y-2">
        <Label htmlFor="cvd-mode">{t('settings_cvd_mode_label')}</Label>
        <select
          id="cvd-mode"
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
        <Label htmlFor="reading-font">{t('settings_reading_font_label')}</Label>
        <select
          id="reading-font"
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
    </div>
  );
}
