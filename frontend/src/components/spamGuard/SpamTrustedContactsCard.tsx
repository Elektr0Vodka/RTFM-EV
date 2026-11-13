import { useEffect, useState } from 'react';

import { api } from '../../api';
import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import type { SpamContactList, SpamGuardState } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PAGE = 50;

/**
 * The automatic trusted list: names of stored client contacts heard by advert.
 * It follows the contacts by itself and cannot be edited; the switch turns it
 * off, and Never trust moves one name to the never-trusted list.
 *
 * Read from the backend in pages and again whenever the Spam Guard state changes.
 */
export function SpamTrustedContactsCard({
  state,
  guard,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [list, setList] = useState<SpamContactList | null>(null);
  const [failed, setFailed] = useState(false);
  const on = state.settings.trust_contacts;

  useEffect(() => {
    if (!on) {
      setList(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api
        .getSpamGuardContacts(query, shown)
        .then((result) => {
          if (current) {
            setList(result);
            setFailed(false);
          }
        })
        .catch(() => {
          if (current) setFailed(true);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, shown, state, on]);

  const disabled = guard.busy || !state.enabled;

  return (
    <div className="space-y-1.5" data-testid="spam-trusted-contacts">
      <div className="text-sm font-medium text-foreground">{t('spam_contacts_title')}</div>
      <label className="flex items-center gap-2 text-[0.8125rem] text-foreground">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => void guard.save({ ...state.settings, trust_contacts: e.target.checked })}
        />
        {t('spam_contacts_switch')}
      </label>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('spam_contacts_help', { count: state.contact_names })}
      </p>
      <p className="text-[0.8125rem] text-warning">{t('spam_contacts_risk')}</p>
      {on && (
        <details>
          <summary className="cursor-pointer text-[0.8125rem] text-muted-foreground">
            {t('spam_contacts_show', { count: state.contact_names })}
          </summary>
          <div className="mt-2 space-y-2">
            <label className="block max-w-xs space-y-1 text-[0.8125rem] text-muted-foreground">
              <span>{t('spam_contacts_search')}</span>
              <Input
                value={query}
                maxLength={64}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE);
                }}
              />
            </label>
            {failed && (
              <p className="text-[0.8125rem] text-destructive">{t('spam_known_failed')}</p>
            )}
            {list && list.names.length === 0 && (
              <p className="text-[0.8125rem] text-muted-foreground">{t('spam_known_empty')}</p>
            )}
            {list && list.names.length > 0 && (
              <ul className="divide-y divide-border/60">
                {list.names.map((name) => (
                  <li
                    key={name}
                    className="flex flex-wrap items-center justify-between gap-2 py-1"
                    data-testid="spam-trusted-contact"
                  >
                    <span className="wrap-break-word min-w-0 text-sm text-foreground">{name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => void guard.action('deny_sender', { sender: name })}
                    >
                      {t('spam_known_never')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {list && list.total > list.names.length && (
              <Button size="sm" variant="ghost" onClick={() => setShown((count) => count + PAGE)}>
                {t('spam_known_more', { count: list.total - list.names.length })}
              </Button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
