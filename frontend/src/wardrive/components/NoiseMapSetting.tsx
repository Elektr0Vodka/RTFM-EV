// The Settings tab's switch for the noise floor rings on the live map. Off by
// default: most drives are about what was heard, not about the noise.
import { useT } from '../../i18n';

export function NoiseMapSetting({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        {t('wardrive_page_noise_map')}
      </label>
      <p className="text-xs text-muted-foreground">{t('wardrive_page_noise_map_hint')}</p>
    </div>
  );
}
