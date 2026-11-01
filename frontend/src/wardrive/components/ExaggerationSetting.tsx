// The Settings tab's terrain exaggeration: rx's discrete steps, for a thumb.
import { useT } from '../../i18n';
import { EXAGGERATION_STEPS } from '../map/terrain';

export function ExaggerationSetting({
  value,
  onChange,
}: {
  value: number;
  onChange(x: number): void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{t('wardrive_page_terrain_heading')}</legend>
      <p className="text-xs text-muted-foreground">{t('wardrive_page_terrain_hint')}</p>
      <div className="flex flex-wrap gap-3">
        {EXAGGERATION_STEPS.map((x) => (
          <label key={x} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name="wardrive-exaggeration"
              value={x}
              checked={value === x}
              onChange={() => onChange(x)}
            />
            {t('wardrive_page_terrain_step', { x })}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
