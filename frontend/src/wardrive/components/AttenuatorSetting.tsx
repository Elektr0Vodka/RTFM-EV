// The Settings tab's attenuator (rx's display offset): with an attenuator
// between radio and antenna, its loss is added back for colours, hexes and
// sound; the numbers shown stay as measured.
import { useT } from '../../i18n';
import { ATTENUATOR_STEPS } from '../signal';

export function AttenuatorSetting({
  value,
  onChange,
}: {
  value: number;
  onChange(db: number): void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">
        {t('wardrive_page_attenuator_heading')}
      </legend>
      <p className="text-xs text-muted-foreground">{t('wardrive_page_attenuator_hint')}</p>
      <div className="flex flex-wrap gap-3">
        {ATTENUATOR_STEPS.map((db) => (
          <label key={db} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name="wardrive-attenuator"
              value={db}
              checked={value === db}
              onChange={() => onChange(db)}
            />
            {db === 0
              ? t('wardrive_page_attenuator_none')
              : t('wardrive_page_attenuator_step', { db })}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
