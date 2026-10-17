import { useEffect, useState } from 'react';

import { api } from '../../api';
import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import type { SpamGuardState, SpamKnownList } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatDuration } from './spamGuardText';

const PAGE = 50;

/**
 * Who Spam Guard knows: names learnt from genuine messages, names still being
 * learnt, and trusted names. Trust keeps a name for good; Forget makes someone
 * count as new again. Names only, never message text.
 *
 * The list is read from the backend in pages (it can hold thousands of names)
 * and read again whenever the Spam Guard state changes.
 */
export function SpamKnownPeopleCard({
  state,
  guard,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [list, setList] = useState<SpamKnownList | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      api
        .getSpamGuardKnown(query, shown)
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
  }, [query, shown, state]);

  const now = Date.now() / 1000;
  const needed = state.tunables.known_min_msgs;
  const disabled = guard.busy || !state.enabled;

  return (
    <section
      className="space-y-2 rounded-md border border-border/60 p-3"
      data-testid="spam-known-people"
    >
      <h3 className="text-sm font-semibold text-foreground">{t('spam_known_title')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('spam_known_desc', { count: needed })}
      </p>
      <label className="block max-w-xs space-y-1 text-[0.8125rem] text-muted-foreground">
        <span>{t('spam_known_search')}</span>
        <Input
          value={query}
          maxLength={64}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
        />
      </label>
      {failed && <p className="text-[0.8125rem] text-destructive">{t('spam_known_failed')}</p>}
      {list && list.people.length === 0 && (
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_known_empty')}</p>
      )}
      {list && list.people.length > 0 && (
        <ul className="divide-y divide-border/60">
          {list.people.map((person) => (
            <li
              key={person.name}
              className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              data-testid="spam-known-person"
            >
              <div className="min-w-0">
                <div className="wrap-break-word text-sm text-foreground">{person.name}</div>
                <div className="text-[0.75rem] text-muted-foreground">
                  {person.trusted
                    ? t('spam_known_trusted')
                    : person.known
                      ? t('spam_known_known', { count: person.genuine })
                      : t('spam_known_learning', { count: person.genuine, needed })}
                  {person.last !== null &&
                    ` | ${t('spam_known_last', { time: formatDuration(now - person.last, t) })}`}
                </div>
              </div>
              <div className="flex gap-1">
                {!person.trusted && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void guard.action('allow_sender', { sender: person.name })}
                  >
                    {t('spam_known_trust')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void guard.action('forget_known', { name: person.name })}
                >
                  {t('spam_known_forget')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && list.total > list.people.length && (
        <Button size="sm" variant="ghost" onClick={() => setShown((count) => count + PAGE)}>
          {t('spam_known_more', { count: list.total - list.people.length })}
        </Button>
      )}
    </section>
  );
}
