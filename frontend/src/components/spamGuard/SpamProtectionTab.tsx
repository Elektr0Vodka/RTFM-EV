import { useState } from 'react';

import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import type { SpamBlock, SpamGuardHopMatch, SpamGuardState } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { blockLabel, formatDuration, formatExpiry, reasonLabel } from './spamGuardText';

const LOCKDOWN_MINUTES = [30, 60, 120];
const PAGE = 10;

function channelName(state: SpamGuardState, key: string | null): string {
  if (!key) return '';
  return state.settings.channels.find((c) => c.key === key)?.name ?? key.slice(0, 8);
}

function BlockRow({
  block,
  state,
  guard,
}: {
  block: SpamBlock;
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const now = Date.now() / 1000;
  const modes: SpamGuardHopMatch[] =
    state.backend === 'host'
      ? ['contains_known', 'exact_paths', 'contains', 'starts_at']
      : ['contains_known', 'exact_paths', 'contains'];
  return (
    <li className="space-y-1.5 rounded-md border border-border/60 p-3" data-testid="spam-block">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="wrap-break-word text-sm font-medium text-foreground">
            {blockLabel(block, t)}
          </div>
          <div className="text-[0.8125rem] text-muted-foreground">
            {reasonLabel(block, t)}
            {block.channel ? ` | ${channelName(state, block.channel)}` : ''}
          </div>
          <div className="text-[0.75rem] text-muted-foreground">
            {t('spam_block_meta', { hits: block.hits, expiry: formatExpiry(block, now, t) })}
            {block.gated ? ` | ${t('spam_block_gated')}` : ''}
            {block.observe ? ` | ${t('spam_block_observing')}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={guard.busy}
            onClick={() => void guard.action('extend', { key: block.key, seconds: 3600 })}
          >
            {t('spam_block_extend')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={guard.busy}
            onClick={() => void guard.action('extend', { key: block.key, permanent: true })}
          >
            {t('spam_block_keep')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={guard.busy}
            aria-pressed={block.observe}
            onClick={() =>
              void guard.action('block_action', { key: block.key, observe: !block.observe })
            }
          >
            {t(block.observe ? 'spam_block_enforce' : 'spam_block_observe')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={guard.busy}
            onClick={() =>
              void guard.action(
                block.kind === 'lockdown' ? 'lockdown' : 'unblock',
                block.kind === 'lockdown' ? { minutes: 0 } : { key: block.key }
              )
            }
          >
            {t('spam_block_remove')}
          </Button>
        </div>
      </div>
      {block.kind === 'hop' && (
        <label className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
          {t('spam_set_hop_match_mode_label')}
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-[0.8125rem] text-foreground"
            value={block.match ?? ''}
            disabled={guard.busy}
            onChange={(e) =>
              void guard.action('hop_mode', { key: block.key, match: e.target.value || null })
            }
          >
            <option value="">{t('spam_hop_mode_default')}</option>
            {modes.map((mode) => (
              <option key={mode} value={mode}>
                {t(`spam_choice_hop_match_mode_${mode}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {block.kind === 'hop' && block.paths.length > 0 && (
        <ul className="space-y-0.5 text-[0.75rem] text-muted-foreground">
          {block.paths.map((path) => (
            <li key={path} className="flex items-center gap-2">
              <code>{path.split('>').join(' > ')}</code>
              <button
                type="button"
                className="underline hover:text-foreground"
                disabled={guard.busy}
                onClick={() => void guard.action('forget_path', { key: block.key, path })}
              >
                {t('spam_block_forget_path')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {block.kind === 'suffix' && (
        <div className="text-[0.75rem] text-muted-foreground">
          {t('spam_block_allowed_origins', {
            hops: (block.allowed_origins ?? []).join(', ') || '-',
          })}
        </div>
      )}
    </li>
  );
}

export function SpamProtectionTab({
  state,
  guard,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const [minutes, setMinutes] = useState(60);
  const [hop, setHop] = useState('');
  const [text, setText] = useState('');
  const [textChannel, setTextChannel] = useState(state.settings.channels[0]?.key ?? '');
  const [shown, setShown] = useState(PAGE);
  const [heldShown, setHeldShown] = useState(PAGE);
  // Duplicate suppression makes a short-lived block for nearly every long
  // message; they are routine, so they stay out of the list unless asked for.
  const [showDuplicates, setShowDuplicates] = useState(false);
  const duplicates = state.block_list.filter((b) => b.source === 'dedupe').length;
  const listed = state.block_list.filter((b) => showDuplicates || b.source !== 'dedupe');
  const lockdown = state.block_list.find((b) => b.kind === 'lockdown');
  const now = Date.now() / 1000;
  const disabled = guard.busy || !state.enabled;

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_lockdown_title')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_lockdown_desc')}</p>
        {lockdown ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-warning">
              {t('spam_lockdown_active', { time: formatDuration(lockdown.expires - now, t) })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void guard.action('lockdown', { minutes: 0 })}
            >
              {t('spam_lockdown_end')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="spam-lockdown-minutes" className="text-sm text-foreground">
              {t('spam_lockdown_duration')}
            </label>
            <select
              id="spam-lockdown-minutes"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {LOCKDOWN_MINUTES.map((value) => (
                <option key={value} value={value}>
                  {formatDuration(value * 60, t)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="destructive"
              disabled={disabled}
              onClick={() => void guard.action('lockdown', { minutes })}
            >
              {t('spam_lockdown_start')}
            </Button>
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('spam_lockdown_known', { count: state.known_names.length })}
            </span>
          </div>
        )}
        {state.mode !== 'protect' && (
          <p className="text-[0.8125rem] text-warning">{t('spam_monitor_no_effect')}</p>
        )}
      </section>

      {state.held.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('spam_held_title')}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">{t('spam_held_desc')}</p>
          <ul className="space-y-2">
            {state.held.slice(0, heldShown).map((held) => (
              <li
                key={`${held.ts}-${held.sender}-${held.matched}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{held.sender}</div>
                  <div className="wrap-break-word text-[0.8125rem] text-muted-foreground">
                    {held.text}
                  </div>
                  <div className="text-[0.75rem] text-muted-foreground">
                    {t('spam_held_meta', {
                      path: held.path.join(' > ') || t('spam_path_direct'),
                      time: formatDuration(now - held.ts, t),
                    })}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || state.settings.allow_senders.includes(held.sender)}
                  onClick={() =>
                    void guard.action(
                      'not_spam',
                      { sender: held.sender, matched: held.matched },
                      held.message_id
                    )
                  }
                >
                  {t('spam_let_through')}
                </Button>
              </li>
            ))}
          </ul>
          {state.held.length > heldShown && (
            <Button size="sm" variant="ghost" onClick={() => setHeldShown((n) => n + PAGE)}>
              {t('spam_show_more')}
            </Button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t('spam_blocks_title', { count: state.block_list.length - duplicates })}
          </h3>
          {state.block_list.some((b) => b.source !== 'manual') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void guard.action('clear_auto')}
            >
              {t('spam_blocks_clear_auto')}
            </Button>
          )}
        </div>
        {duplicates > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-current"
              checked={showDuplicates}
              onChange={(e) => setShowDuplicates(e.target.checked)}
            />
            {t('spam_blocks_show_duplicates', { count: duplicates })}
          </label>
        )}
        {listed.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">{t('spam_blocks_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {listed.slice(0, shown).map((block) => (
              <BlockRow key={block.key} block={block} state={state} guard={guard} />
            ))}
          </ul>
        )}
        {listed.length > shown && (
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            {t('spam_show_more')}
          </Button>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_manual_title')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_manual_desc')}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void guard.action('block_hop', { hop }).then((ok) => ok && setHop(''));
          }}
        >
          <div className="space-y-1">
            <label htmlFor="spam-block-hop" className="text-[0.8125rem] text-foreground">
              {t('spam_manual_hop_label')}
            </label>
            <Input
              id="spam-block-hop"
              className="h-9 w-32"
              value={hop}
              placeholder="27"
              maxLength={8}
              onChange={(e) => setHop(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={disabled || !hop.trim()}>
            {t('spam_manual_block_hop')}
          </Button>
        </form>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void guard
              .action('block_text', { text, channel: textChannel })
              .then((ok) => ok && setText(''));
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="spam-block-text" className="text-[0.8125rem] text-foreground">
              {t('spam_manual_text_label')}
            </label>
            <Input
              id="spam-block-text"
              className="h-9"
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <select
            aria-label={t('spam_manual_channel_label')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={textChannel}
            onChange={(e) => setTextChannel(e.target.value)}
          >
            {state.settings.channels.map((channel) => (
              <option key={channel.key} value={channel.key}>
                {channel.name || channel.key.slice(0, 8)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={disabled || text.trim().length < 5 || !textChannel}
          >
            {t('spam_manual_block_text')}
          </Button>
        </form>
      </section>
    </div>
  );
}
