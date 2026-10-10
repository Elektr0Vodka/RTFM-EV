import { useState } from 'react';

import { useSpamGuard } from '../hooks/useSpamGuard';
import { useT } from '../i18n';
import { cn } from '../lib/utils';
import type { Channel, Contact } from '../types';
import { SpamMessagesTab } from './spamGuard/SpamMessagesTab';
import { SpamOverviewTab } from './spamGuard/SpamOverviewTab';
import { SpamProtectionTab } from './spamGuard/SpamProtectionTab';
import { SpamSettingsTab } from './spamGuard/SpamSettingsTab';
import { SpamSourcesTab } from './spamGuard/SpamSourcesTab';

const TABS = ['overview', 'protection', 'messages', 'sources', 'settings'] as const;
type SpamTab = (typeof TABS)[number];

const TAB_KEYS: Record<SpamTab, string> = {
  overview: 'spam_tab_overview',
  protection: 'spam_tab_protection',
  messages: 'spam_tab_messages',
  sources: 'spam_tab_sources',
  settings: 'spam_tab_settings',
};

/**
 * Tools page for Spam Guard: channel spam detection that, in Protect mode,
 * keeps the host repeater from forwarding spam. It judges behaviour (the same
 * text under made-up names, floods of copies, repeaters that inject spam),
 * never a person; every automatic block expires. The page is only reachable
 * while the master switch in Settings is on.
 */
export function SpamGuardView({
  contacts,
  channels,
}: {
  contacts: Contact[];
  channels: Channel[];
}) {
  const t = useT();
  const guard = useSpamGuard();
  const [tab, setTab] = useState<SpamTab>('overview');
  const { state, loadError } = guard;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-semibold text-base text-foreground">{t('nav_spam_guard')}</h2>
        <p className="hidden text-xs text-muted-foreground md:block">{t('spam_page_desc')}</p>
      </div>
      <div
        role="tablist"
        aria-label={t('nav_spam_guard')}
        className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5"
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              tab === name
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            {t(TAB_KEYS[name])}
            {name === 'protection' && state && state.blocks > 0 ? ` (${state.blocks})` : ''}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        <div className="mx-auto max-w-4xl space-y-4">
          {loadError && (
            <p className="rounded border border-destructive/40 p-2 text-sm text-destructive">
              {t('spam_load_failed', { error: loadError })}
            </p>
          )}
          {!state && !loadError && (
            <p className="text-sm text-muted-foreground">{t('common_loading_spam_guard')}</p>
          )}
          {state && !state.enabled && (
            <p className="rounded border border-border p-3 text-sm text-muted-foreground">
              {t('spam_disabled_notice')}
            </p>
          )}
          {state && tab === 'overview' && <SpamOverviewTab state={state} guard={guard} />}
          {state && tab === 'protection' && <SpamProtectionTab state={state} guard={guard} />}
          {state && tab === 'messages' && <SpamMessagesTab state={state} guard={guard} />}
          {state && tab === 'sources' && (
            <SpamSourcesTab state={state} guard={guard} contacts={contacts} />
          )}
          {state && tab === 'settings' && (
            <SpamSettingsTab state={state} guard={guard} channels={channels} />
          )}
        </div>
      </div>
    </div>
  );
}
