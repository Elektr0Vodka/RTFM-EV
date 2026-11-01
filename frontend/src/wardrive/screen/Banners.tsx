// Notes under the top bar, most urgent first: radio lost or missing, position
// missing or too rough, paused in the background, offline, an error, another
// account's receptions waiting, and once the hint to keep the screen on.
import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

export const SCREEN_HINT_KEY = 'rtfm-wardrive-hint-screen';

export interface BannersProps {
  noRadio: boolean;
  radioLost: boolean;
  noFix: boolean;
  /** Accuracy in metres of a fix too rough to store with, else null. */
  fixTooPoor: number | null;
  /** When the page went to the background during a drive, else null. */
  pausedAt: number | null;
  offline: boolean;
  error: string | null;
  otherAccounts: number;
  onConnect(): void;
  onDismissError(): void;
}

function hintSeen(): boolean {
  try {
    return localStorage.getItem(SCREEN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

const BOX =
  'flex items-start gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-md backdrop-blur';

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function Banners(p: BannersProps) {
  const t = useT();
  const [hintHidden, setHintHidden] = useState(hintSeen);
  const dismissHint = () => {
    setHintHidden(true);
    try {
      localStorage.setItem(SCREEN_HINT_KEY, '1');
    } catch {
      // Not stored: shown again next time.
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      {(p.radioLost || p.noRadio) && (
        <div className={BOX} role="status">
          <span className="flex-1">
            {p.radioLost ? t('wardrive_page_radio_lost') : t('wardrive_page_banner_no_radio')}
          </span>
          <Button type="button" size="sm" onClick={p.onConnect}>
            {t('wardrive_page_connect')}
          </Button>
        </div>
      )}
      {p.fixTooPoor !== null ? (
        <div className={BOX} role="status">
          {t('wardrive_page_banner_fix_poor', { accuracy: Math.round(p.fixTooPoor) })}
        </div>
      ) : (
        p.noFix && (
          <div className={BOX} role="status">
            {t('wardrive_page_banner_no_fix')}
          </div>
        )
      )}
      {p.pausedAt !== null && (
        <div className={BOX} role="status">
          {t('wardrive_page_banner_paused', { time: clock(p.pausedAt) })}
        </div>
      )}
      {p.offline && (
        <div className={BOX} role="status">
          {t('wardrive_page_offline')}
        </div>
      )}
      {p.error && (
        <div className={`${BOX} border-destructive/60`} role="alert">
          <span className="flex-1">{t('wardrive_page_error', { error: p.error })}</span>
          <Button type="button" size="sm" variant="ghost" onClick={p.onDismissError}>
            {t('wardrive_page_dismiss')}
          </Button>
        </div>
      )}
      {p.otherAccounts > 0 && (
        <div className={BOX} role="status">
          {t('wardrive_page_other_accounts', { count: p.otherAccounts })}
        </div>
      )}
      {!hintHidden && (
        <div className={BOX} role="status">
          <span className="flex-1">{t('wardrive_page_banner_screen')}</span>
          <Button type="button" size="sm" variant="ghost" onClick={dismissHint}>
            {t('wardrive_page_dismiss')}
          </Button>
        </div>
      )}
    </div>
  );
}
