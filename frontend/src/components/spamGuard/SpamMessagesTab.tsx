import { useState } from 'react';

import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import type { SpamGuardMessage, SpamGuardState } from '../../types';
import { Button } from '../ui/button';
import { activityLabel, blockLabel, formatDuration } from './spamGuardText';

const PAGE = 10;

function Signal({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'warn' | 'ok' }) {
  const toneClass =
    tone === 'warn'
      ? 'bg-warning/15 text-warning'
      : tone === 'ok'
        ? 'bg-status-connected/15 text-status-connected'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider ${toneClass}`}>
      {label}
    </span>
  );
}

function MessageRow({
  message,
  state,
  guard,
}: {
  message: SpamGuardMessage;
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const now = Date.now() / 1000;
  const block = message.matched
    ? state.block_list.find((b) => b.key === message.matched)
    : undefined;
  const disabled = guard.busy || !state.enabled;
  return (
    <li className="space-y-1.5 rounded-md border border-border/60 p-3" data-testid="spam-message">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{message.sender}</span>
        {message.random && <Signal label={t('spam_signal_random')} tone="warn" />}
        {message.disguised && <Signal label={t('spam_signal_disguised')} tone="warn" />}
        {message.campaign !== null && <Signal label={t('spam_signal_campaign')} tone="warn" />}
        {message.known && <Signal label={t('spam_signal_known')} tone="ok" />}
        {message.exempt && <Signal label={t('spam_signal_exempt')} tone="ok" />}
        {message.spam && <Signal label={t('chat_spam_badge')} tone="warn" />}
        <span className="text-[0.75rem] text-muted-foreground">
          {t('spam_message_meta', {
            score: message.name_score,
            path: message.path.join(' > ') || t('spam_path_direct'),
            time: formatDuration(now - message.ts, t),
          })}
        </span>
      </div>
      <div className="wrap-break-word text-[0.8125rem] text-foreground">{message.text}</div>
      {message.matched && (
        <div className="text-[0.75rem] text-muted-foreground">
          {t('spam_message_caught', {
            block: block ? blockLabel(block, t) : message.matched,
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void guard.action(
              'mark_spam',
              { text: message.text, channel: message.channel },
              message.message_id
            )
          }
        >
          {t('chat_mark_spam_action')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void guard.action(
              'not_spam',
              { sender: message.sender, matched: message.matched },
              message.message_id
            )
          }
        >
          {t('chat_not_spam_action')}
        </Button>
      </div>
    </li>
  );
}

export function SpamMessagesTab({
  state,
  guard,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  const [activityShown, setActivityShown] = useState(PAGE);
  const now = Date.now() / 1000;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_messages_title')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_messages_desc')}</p>
        {state.messages.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">{t('spam_messages_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {state.messages.slice(0, shown).map((message) => (
              <MessageRow
                key={`${message.ts}-${message.message_id}-${message.sender}`}
                message={message}
                state={state}
                guard={guard}
              />
            ))}
          </ul>
        )}
        {state.messages.length > shown && (
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            {t('spam_show_more')}
          </Button>
        )}
      </section>

      {state.campaigns.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('spam_campaigns_title')}</h3>
          <ul className="space-y-2">
            {state.campaigns.map((campaign) => (
              <li key={campaign.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.8125rem] text-foreground">
                    {t('spam_campaign_meta', {
                      senders: campaign.senders,
                      messages: campaign.messages,
                    })}
                  </span>
                  {campaign.confirmed && (
                    <Signal label={t('spam_campaign_confirmed')} tone="warn" />
                  )}
                  {campaign.strong && <Signal label={t('spam_campaign_strong')} tone="warn" />}
                </div>
                <div className="wrap-break-word text-[0.8125rem] text-muted-foreground">
                  {campaign.sample}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_activity_title')}</h3>
        {state.activity.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">{t('spam_activity_empty')}</p>
        ) : (
          <ul className="space-y-1 text-[0.8125rem] text-muted-foreground">
            {state.activity.slice(0, activityShown).map((entry, index) => (
              <li key={`${entry.ts}-${index}`}>
                {t('spam_activity_line', {
                  time: formatDuration(now - entry.ts, t),
                  what: activityLabel(entry, t),
                })}
              </li>
            ))}
          </ul>
        )}
        {state.activity.length > activityShown && (
          <Button size="sm" variant="ghost" onClick={() => setActivityShown((n) => n + PAGE)}>
            {t('spam_show_more')}
          </Button>
        )}
      </section>
    </div>
  );
}
