import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RadioTower, Settings2 } from 'lucide-react';

import { useT } from '../i18n';
import { cn } from '@/lib/utils';
import { gatewayApi, radioHref, radiosPageHref, type GatewayRadioInfo } from './api';
import { getGatewayContext } from './context';
import { RADIO_STATE_DOT, RADIO_STATE_LABEL } from './radioState';

const REFRESH_MS = 5000;

/**
 * Radio switcher for the header, shown only in multi-radio mode. Each radio is
 * its own workspace under /r/<key>/, so switching is a plain link. Modeled on
 * HeaderLanguageMenu.
 */
export function HeaderRadioMenu() {
  const t = useT();
  const context = getGatewayContext();
  const current = context?.page === 'workspace' ? context.radio : null;
  const active = current !== null;
  const [open, setOpen] = useState(false);
  const [radios, setRadios] = useState<GatewayRadioInfo[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !active) return;

    let cancelled = false;
    const load = () => {
      gatewayApi
        .listRadios()
        .then((list) => {
          if (!cancelled) setRadios(list);
        })
        .catch(() => {
          if (!cancelled) setRadios((previous) => previous ?? []);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);

    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, active]);

  if (!current) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('gateway_switch_radio')}
        title={t('gateway_switch_radio')}
        className="flex items-center gap-1 px-1.5 py-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RadioTower className="h-4 w-4" aria-hidden="true" />
        <span className="max-w-32 truncate text-[0.6875rem] font-medium">{current.name}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-52 rounded-md border border-border bg-card p-1 shadow-lg z-50"
        >
          {radios === null && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('common_loading')}</div>
          )}
          {radios?.map((radio) => {
            const isCurrent = radio.id === current.id;
            const href = radioHref(radio);
            const row = (
              <>
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', RADIO_STATE_DOT[radio.state])}
                  title={t(RADIO_STATE_LABEL[radio.state])}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{radio.name}</span>
                {isCurrent && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
              </>
            );
            const rowClass =
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-left transition-colors';
            if (isCurrent || !href) {
              return (
                <div
                  key={radio.id}
                  role="menuitem"
                  aria-disabled="true"
                  aria-current={isCurrent ? 'true' : undefined}
                  title={isCurrent ? t('gateway_current_radio') : t('gateway_radio_no_url')}
                  className={cn(
                    rowClass,
                    isCurrent ? 'text-foreground' : 'text-muted-foreground/60'
                  )}
                >
                  {row}
                </div>
              );
            }
            return (
              <a
                key={radio.id}
                role="menuitem"
                href={href}
                className={cn(
                  rowClass,
                  'text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                {row}
              </a>
            );
          })}
          <div className="my-1 border-t border-border" />
          <a
            role="menuitem"
            href={radiosPageHref()}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('gateway_manage_radios')}</span>
          </a>
        </div>
      )}
    </div>
  );
}
