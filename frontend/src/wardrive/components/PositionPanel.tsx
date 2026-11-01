import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { isUsableFix } from '../capture';
import type { Fix } from '../messages';

export function PositionPanel({
  kind,
  fix,
  nowMs,
  deviceAllowed,
  usbSupported,
  onChoose,
}: {
  kind: 'device' | 'usb-gps' | null;
  fix: Fix | null;
  nowMs: number;
  deviceAllowed: boolean;
  usbSupported: boolean;
  onChoose: (kind: 'device' | 'usb-gps') => void;
}) {
  const t = useT();
  const usable = isUsableFix(fix, nowMs);
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h2 className="text-base font-semibold">{t('wardrive_page_position_heading')}</h2>
      {!kind && (
        <div className="flex flex-wrap gap-2">
          {deviceAllowed && (
            <Button type="button" onClick={() => onChoose('device')}>
              {t('wardrive_page_position_device')}
            </Button>
          )}
          {usbSupported && (
            <Button type="button" variant="outline" onClick={() => onChoose('usb-gps')}>
              {t('wardrive_page_position_usb')}
            </Button>
          )}
        </div>
      )}
      {!deviceAllowed && (
        <p className="text-xs text-muted-foreground">{t('wardrive_page_laptop_gps')}</p>
      )}
      {kind && fix && (
        <p className="text-sm">
          {t('wardrive_page_position_fix', {
            accuracy:
              fix.accM === null ? t('wardrive_page_accuracy_unknown') : `${Math.round(fix.accM)} m`,
            age: Math.max(0, Math.round((nowMs - fix.at) / 1000)),
          })}
        </p>
      )}
      {kind && !usable && (
        <p className="text-sm text-destructive" role="status">
          {t('wardrive_page_position_unusable')}
        </p>
      )}
    </section>
  );
}
