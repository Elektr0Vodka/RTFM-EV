import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';

export function RadioPanel({
  info,
  lost,
  bleSupported,
  serialSupported,
  onConnect,
  onDisconnect,
}: {
  info: { publicKey: string; name: string } | null;
  lost: boolean;
  bleSupported: boolean;
  serialSupported: boolean;
  onConnect: (kind: 'ble' | 'usb') => void;
  onDisconnect: () => void;
}) {
  const t = useT();
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
