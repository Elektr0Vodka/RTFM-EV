// The Settings tab's Introduce my node to targets: with Auto-discover on and a
// companion picked as target, each cycle also sends this radio's own advert
// (zero-hop), since a companion answers only a sender it knows. Off by default.
import { useT } from '../../i18n';

export function IntroduceSetting({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        {t('wardrive_page_introduce')}
      </label>
      <p className="text-xs text-muted-foreground">{t('wardrive_page_introduce_hint')}</p>
    </div>
  );
}
