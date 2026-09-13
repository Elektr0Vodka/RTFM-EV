import { useState } from 'react';
import { useT } from '../../i18n';
import { applyTheme, getSavedTheme } from '../../utils/theme';
import {
  CRT_EFFECTS,
  CRT_PHOSPHORS,
  type CrtEffect,
  type CrtPhosphor,
  getCrtEffect,
  getCrtMapTint,
  getCrtPhosphor,
  setCrtEffect,
  setCrtMapTint,
  setCrtPhosphor,
} from '../../utils/crt';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

const CRT_THEME_ID = 'crt';

/** Preview swatch colour per phosphor (approximate; for the picker only). */
const PHOSPHOR_SWATCH: Record<CrtPhosphor, string> = {
  green: '#2bff5a',
  amber: '#ffb028',
  white: '#e0e0e0',
  blue: '#7b7bff',
};

export function CrtSettings() {
  const t = useT();
  const [active, setActive] = useState(() => getSavedTheme() === CRT_THEME_ID);
  const [phosphor, setPhosphor] = useState<CrtPhosphor>(getCrtPhosphor);
  const [effects, setEffects] = useState<Record<CrtEffect, boolean>>(() => {
    const initial = {} as Record<CrtEffect, boolean>;
    for (const e of CRT_EFFECTS) initial[e] = getCrtEffect(e);
    return initial;
  });
  const [mapTint, setMapTint] = useState<boolean>(getCrtMapTint);

  const phosphorLabel: Record<CrtPhosphor, string> = {
    green: t('settings_crt_phosphor_green'),
    amber: t('settings_crt_phosphor_amber'),
    white: t('settings_crt_phosphor_white'),
    blue: t('settings_crt_phosphor_blue'),
  };
  const effectLabel: Record<CrtEffect, string> = {
    scanlines: t('settings_crt_effect_scanlines'),
    glow: t('settings_crt_effect_glow'),
    curvature: t('settings_crt_effect_curvature'),
    flicker: t('settings_crt_effect_flicker'),
  };

  const handleToggleActive = (enabled: boolean) => {
    setActive(enabled);
    // Enabling selects the CRT theme; disabling reverts to the default theme.
    applyTheme(enabled ? CRT_THEME_ID : 'original');
  };

  const handlePhosphor = (next: CrtPhosphor) => {
    setPhosphor(next);
    setCrtPhosphor(next);
  };

  const handleEffect = (effect: CrtEffect, enabled: boolean) => {
    setEffects((prev) => ({ ...prev, [effect]: enabled }));
    setCrtEffect(effect, enabled);
  };

  const handleMapTint = (enabled: boolean) => {
    setMapTint(enabled);
    setCrtMapTint(enabled);
  };

  return (
    // Grouped as one self-contained section so the CRT controls (enable, phosphor,
    // effects) read as a single unit rather than loose settings interleaved with the
    // rest of the panel.
    <section className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_crt_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_crt_description')}</p>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="crt-enable"
          checked={active}
          onCheckedChange={(c) => handleToggleActive(c === true)}
          className="mt-0.5"
        />
        <Label htmlFor="crt-enable">{t('settings_crt_enable')}</Label>
      </div>

      {active && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">
              {t('settings_crt_phosphor_legend')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {CRT_PHOSPHORS.map((p) => (
                <label
                  key={p}
                  className={
                    'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border transition-colors ' +
                    (phosphor === p
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-accent/50')
                  }
                >
                  <input
                    type="radio"
                    name="crt-phosphor"
                    value={p}
                    checked={phosphor === p}
                    onChange={() => handlePhosphor(p)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="w-3 h-3 rounded-full ring-1 ring-border/40"
                    style={{ backgroundColor: PHOSPHOR_SWATCH[p] }}
                  />
                  <span className="text-xs whitespace-nowrap">{phosphorLabel[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">
              {t('settings_crt_effects_legend')}
            </legend>
            <div className="space-y-2">
              {CRT_EFFECTS.map((e) => (
                <div
                  key={e}
                  className="flex items-center gap-3 rounded-md border border-border/60 p-3"
                >
                  <Checkbox
                    id={`crt-effect-${e}`}
                    checked={effects[e]}
                    onCheckedChange={(c) => handleEffect(e, c === true)}
                  />
                  <Label htmlFor={`crt-effect-${e}`}>{effectLabel[e]}</Label>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">{t('settings_crt_map_legend')}</legend>
            <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
              <Checkbox
                id="crt-map-tint"
                checked={mapTint}
                onCheckedChange={(c) => handleMapTint(c === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="crt-map-tint">{t('settings_crt_map_tint')}</Label>
                <p className="text-[0.75rem] text-muted-foreground">
                  {t('settings_crt_map_tint_hint')}
                </p>
              </div>
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}
