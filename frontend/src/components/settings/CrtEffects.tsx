import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { THEME_CHANGE_EVENT } from '../../utils/theme';
import {
  CRT_CHANGE_EVENT,
  CRT_EFFECTS,
  type CrtEffect,
  getCrtEffect,
  getCrtMapTint,
  setCrtEffect,
  setCrtMapTint,
} from '../../utils/crt';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

function readEffects(): Record<CrtEffect, boolean> {
  const state = {} as Record<CrtEffect, boolean>;
  for (const e of CRT_EFFECTS) state[e] = getCrtEffect(e);
  return state;
}

/** CRT screen-effect toggles (scanlines, glow, curvature, flicker) plus the map
 *  tint. Rendered beneath the theme picker. The effects overlay any theme; they
 *  default on under a CRT theme and off otherwise, so this re-reads its state on
 *  theme changes to reflect the new defaults. */
export function CrtEffects() {
  const t = useT();
  const [effects, setEffects] = useState<Record<CrtEffect, boolean>>(readEffects);
  const [mapTint, setMapTint] = useState<boolean>(getCrtMapTint);

  useEffect(() => {
    const sync = () => {
      setEffects(readEffects());
      setMapTint(getCrtMapTint());
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener(CRT_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener(CRT_CHANGE_EVENT, sync);
    };
  }, []);

  const effectLabel: Record<CrtEffect, string> = {
    scanlines: t('settings_crt_effect_scanlines'),
    glow: t('settings_crt_effect_glow'),
    curvature: t('settings_crt_effect_curvature'),
    flicker: t('settings_crt_effect_flicker'),
  };

  const handleEffect = (effect: CrtEffect, enabled: boolean) => {
    setCrtEffect(effect, enabled);
    setEffects(readEffects());
  };

  const handleMapTint = (enabled: boolean) => {
    setCrtMapTint(enabled);
    setMapTint(enabled);
  };

  return (
    <section className="mt-4 space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-[0.8125rem] font-medium">{t('settings_crt_effects_legend')}</legend>
        <div className="space-y-2">
          {CRT_EFFECTS.map((e) => (
            <div key={e} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
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
    </section>
  );
}
