// The start screen over the map: radio and GPS status, one big Connect button,
// then the position choice. Shown until the first usable fix or until it is
// closed; not again in this browser session once closed.
import { X } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

export const START_DISMISSED_KEY = 'rtfm-wardrive-start-dismissed';

export function startScreenWanted(hasUsableFix: boolean): boolean {
  if (hasUsableFix) return false;
  try {
    return sessionStorage.getItem(START_DISMISSED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissStartScreen(): void {
  try {
    sessionStorage.setItem(START_DISMISSED_KEY, '1');
  } catch {
    // Shown again after a reload; nothing else depends on it.
  }
}

export interface StartScreenProps {
  radioName: string | null;
  radioError: string | null;
  fixAccuracy: number | null;
  positionChosen: boolean;
  bleSupported: boolean;
  serialSupported: boolean;
  deviceAllowed: boolean;
  onConnectBle(): void;
  onConnectUsb(): void;
  onChoosePosition(kind: 'device' | 'usb-gps'): void;
  onClose(): void;
}

function Row({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <i
          className={`block h-2 w-2 rounded-full ${
            good ? 'bg-status-connected' : 'bg-muted-foreground/40'
          }`}
          aria-hidden="true"
        />
        {value}
      </span>
    </div>
  );
}

export function StartScreen(p: StartScreenProps) {
  const t = useT();
  const noRadioSupport = !p.bleSupported && !p.serialSupported;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
        <button
          type="button"
          className="absolute right-3 top-3 rounded p-1 hover:bg-muted"
          aria-label={t('wardrive_page_close')}
          onClick={p.onClose}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-center text-2xl font-bold">{t('wardrive_page_title')}</h1>
        <p className="mb-3 text-center text-xs text-muted-foreground">{t('wardrive_page_intro')}</p>
        <Row
          label={t('wardrive_page_start_radio')}
          value={p.radioName ?? p.radioError ?? t('wardrive_page_start_no_radio')}
          good={p.radioName !== null}
        />
        <Row
          label={t('wardrive_page_start_gps')}
          value={
            p.fixAccuracy !== null
              ? t('wardrive_page_start_fix', { accuracy: Math.round(p.fixAccuracy) })
              : t('wardrive_page_start_no_fix')
          }
          good={p.fixAccuracy !== null}
        />
        <div className="mt-4 flex flex-col gap-2">
          {noRadioSupport && <p className="text-sm">{t('wardrive_page_no_radio_support')}</p>}
          {p.radioName === null && p.bleSupported && (
            <Button type="button" size="lg" onClick={p.onConnectBle}>
              {t('wardrive_page_connect_ble')}
            </Button>
          )}
          {p.radioName === null && p.serialSupported && (
            <Button type="button" variant="outline" onClick={p.onConnectUsb}>
              {t('wardrive_page_connect_usb')}
            </Button>
          )}
          {p.radioName !== null && !p.positionChosen && p.deviceAllowed && (
            <Button type="button" size="lg" onClick={() => p.onChoosePosition('device')}>
              {t('wardrive_page_position_device')}
            </Button>
          )}
          {p.radioName !== null && !p.positionChosen && p.serialSupported && (
            <Button type="button" variant="outline" onClick={() => p.onChoosePosition('usb-gps')}>
              {t('wardrive_page_position_usb')}
            </Button>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t('wardrive_page_about_listens')}
        </p>
      </div>
    </div>
  );
}
