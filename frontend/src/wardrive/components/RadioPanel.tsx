import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { batteryKnown, batteryPercent, isLowBattery } from '../radio/battery';

export function RadioPanel({
  info,
  lost,
  bleSupported,
  serialSupported,
  onConnect,
  onDisconnect,
  batteryMv = null,
  autoDiscoverCadence,
}: {
  info: { publicKey: string; name: string } | null;
  lost: boolean;
  bleSupported: boolean;
  serialSupported: boolean;
  onConnect: (kind: 'ble' | 'usb') => void;
  onDisconnect: () => void;
  /** The radio's battery (GET_STATS), null before it answered. */
  batteryMv?: number | null;
  /** Seconds between Auto-discover cycles; null when off. */
  autoDiscoverCadence?: number | null;
}) {
  const t = useT();
  const hasBattery = !!info && batteryKnown(batteryMv);
  const percent = hasBattery ? batteryPercent(batteryMv) : null;
  const volts = hasBattery ? (batteryMv / 1000).toFixed(2) : '';
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h2 className="text-base font-semibold">{t('wardrive_page_radio_heading')}</h2>
      {info ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            {t('wardrive_page_radio_connected', {
              name: info.name || '?',
              key: info.publicKey.slice(0, 8),
            })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onDisconnect}>
            {t('wardrive_page_disconnect')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {bleSupported && (
            <Button type="button" onClick={() => onConnect('ble')}>
              {t('wardrive_page_connect_ble')}
            </Button>
          )}
          {serialSupported && (
            <Button type="button" variant="outline" onClick={() => onConnect('usb')}>
              {t('wardrive_page_connect_usb')}
            </Button>
          )}
        </div>
      )}
      {info && batteryMv === null && (
        // Not answered yet (or older firmware): unknown, not hidden. A radio
        // that cannot measure (0 mV) shows no line at all.
        <p className="text-sm text-muted-foreground" data-testid="wardrive-battery">
          {t('wardrive_page_battery_unknown')}
        </p>
      )}
      {hasBattery && (
        <p
          className={`text-sm ${isLowBattery(batteryMv) ? 'text-destructive' : 'text-muted-foreground'}`}
          data-testid="wardrive-battery"
        >
          {percent === null
            ? t('wardrive_page_battery_volts', { volts })
            : t('wardrive_page_battery', { volts, percent })}
          {isLowBattery(batteryMv) && ` ${t('wardrive_page_battery_low')}`}
        </p>
      )}
      {info && autoDiscoverCadence !== undefined && (
        <p className="text-sm text-muted-foreground" data-testid="wardrive-autodiscover-status">
          {autoDiscoverCadence === null
            ? t('wardrive_page_autodiscover_status_off')
            : t('wardrive_page_autodiscover_status_on', { seconds: autoDiscoverCadence })}
        </p>
      )}
      {!bleSupported && !serialSupported && (
        <p className="text-sm text-muted-foreground">{t('wardrive_page_no_radio_support')}</p>
      )}
      {lost && (
        <p className="text-sm text-destructive" role="status">
          {t('wardrive_page_radio_lost')}
        </p>
      )}
    </section>
  );
}
