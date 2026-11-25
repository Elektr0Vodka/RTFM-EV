import { useEffect, useState } from 'react';

import { useSpamGuard } from '../hooks/useSpamGuard';
import { useT } from '../i18n';
import { cn } from '../lib/utils';
import type { AppSettingsUpdate, Channel, Contact, HealthStatus } from '../types';
import { SPAM_GUARD_TAB_EVENT, takeSpamGuardTab } from '../utils/spamGuardNavigation';
import { OpenHopPolicyPane } from './settings/openhop/OpenHopPolicyPane';
import { SettingsBotListsSection } from './settings/SettingsBotListsSection';
import { SpamMessagesTab } from './spamGuard/SpamMessagesTab';
import { SpamOverviewTab } from './spamGuard/SpamOverviewTab';
import { SpamProtectionTab } from './spamGuard/SpamProtectionTab';
import { SpamSettingsTab } from './spamGuard/SpamSettingsTab';
import { SpamSourcesTab } from './spamGuard/SpamSourcesTab';

const TABS = [
  'overview',
  'protection',
  'messages',
  'sources',
  'bot-lists',
  'settings',
  'policy',
] as const;
type SpamTab = (typeof TABS)[number];

const TAB_KEYS: Record<SpamTab, string> = {
  overview: 'spam_tab_overview',
  protection: 'spam_tab_protection',
  messages: 'spam_tab_messages',
  sources: 'spam_tab_sources',
  'bot-lists': 'spam_tab_bot_lists',
  settings: 'spam_tab_settings',
  policy: 'spam_tab_policy',
};

/**
 * Tools page for Spam Guard: channel spam detection that, in Protect mode,
 * keeps the host repeater from forwarding spam. It judges behaviour (the same
 * text under made-up names, floods of copies, repeaters that inject spam),
 * never a person; every automatic block expires. The page is only reachable
 * while the master switch in Settings is on.
 *
 * On an OpenHop node the page also holds the node's own policy editor (the
 * Policy tab), which Settings > OpenHop then leaves out.
 *
 * The Bot lists tab works without Spam Guard: marking and hiding bots in chat
 * does not need it. Settings links here, so the page can be opened while
 * Spam Guard is off; it then shows only that tab.
 */
export function SpamGuardView({
  contacts,
  channels,
  health = null,
  hideBots = false,
  onSaveAppSettings,
}: {
  contacts: Contact[];
  channels: Channel[];
  health?: HealthStatus | null;
  hideBots?: boolean;
  onSaveAppSettings?: (update: AppSettingsUpdate) => Promise<void> | void;
}) {
  const t = useT();
  const guard = useSpamGuard();
  const [tab, setTab] = useState<SpamTab>('overview');
  const { state, loadError } = guard;
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const spamOff = state !== null && !state.enabled;

  // A tab asked for from elsewhere (Settings links to Bot lists): taken on
  // arrival, and again when asked while the page is already open.
  useEffect(() => {
    const openRequested = () => {
      const requested = takeSpamGuardTab();
      if (requested && (TABS as readonly string[]).includes(requested)) {
        setTab(requested as SpamTab);
      }
    };
    openRequested();
    window.addEventListener(SPAM_GUARD_TAB_EVENT, openRequested);
    return () => window.removeEventListener(SPAM_GUARD_TAB_EVENT, openRequested);
  }, []);

  const tabs = spamOff
    ? (['bot-lists'] as SpamTab[])
    : TABS.filter((name) => name !== 'policy' || isOpenHop);
  // The radio is no longer an OpenHop node: its tab is gone, fall back.
  // With Spam Guard off only Bot lists is left.
  const shown: SpamTab = spamOff ? 'bot-lists' : tab === 'policy' && !isOpenHop ? 'overview' : tab;

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
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={shown === name}
            onClick={() => setTab(name)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              shown === name
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
          {!state && !loadError && shown !== 'bot-lists' && (
            <p className="text-sm text-muted-foreground">{t('common_loading_spam_guard')}</p>
          )}
          {spamOff && (
            <p className="rounded border border-border p-3 text-sm text-muted-foreground">
              {t('spam_disabled_notice')}
            </p>
          )}
          {shown === 'bot-lists' && (
            <SettingsBotListsSection
              appSettings={{ hide_bots: hideBots }}
              onSaveAppSettings={onSaveAppSettings}
            />
          )}
          {state && shown === 'overview' && <SpamOverviewTab state={state} guard={guard} />}
          {state && shown === 'protection' && <SpamProtectionTab state={state} guard={guard} />}
          {state && shown === 'messages' && <SpamMessagesTab state={state} guard={guard} />}
          {state && shown === 'sources' && (
            <SpamSourcesTab state={state} guard={guard} contacts={contacts} />
          )}
          {state && shown === 'settings' && (
            <SpamSettingsTab state={state} guard={guard} channels={channels} />
          )}
          {shown === 'policy' && (
            <div className="space-y-4">
              <p className="text-[0.8125rem] text-muted-foreground">{t('spam_policy_desc')}</p>
              <OpenHopPolicyPane health={health} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
