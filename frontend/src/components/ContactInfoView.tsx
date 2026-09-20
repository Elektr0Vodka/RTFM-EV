import { useState } from 'react';
import { Bell, ChevronDown, ChevronLeft, ChevronUp, Lock, Route, Trash2 } from 'lucide-react';

import { useT } from '../i18n';
import { toast } from './ui/sonner';
import { handleKeyboardActivate } from '../utils/a11y';
import { getContactDisplayName } from '../utils/pubkey';
import { useContactInfoData } from '../hooks/useContactInfoData';
import { ContactAvatar } from './ContactAvatar';
import { ContactInfoBody, contactTypeLabel } from './ContactInfoBody';
import { ContactStatusInfo } from './ContactStatusInfo';
import { DirectTraceIcon } from './DirectTraceIcon';
import { ContactPathDiscoveryModal } from './ContactPathDiscoveryModal';
import { RepeaterDashboardBody } from './repeater/RepeaterDashboardBody';
import { RoomServerPanel } from './RoomServerPanel';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../types';
import type {
  AnalyzerSite,
  Contact,
  Conversation,
  PathDiscoveryResponse,
  RadioConfig,
} from '../types';

export interface ContactInfoViewProps {
  publicKey: string;
  contacts: Contact[];
  config: RadioConfig | null;
  onBack: () => void;
  onToggleFavorite: (type: 'channel' | 'contact', id: string) => void | Promise<void>;
  onNavigateToChannel?: (channelKey: string) => void;
  onSearchMessagesByKey?: (publicKey: string) => void;
  onToggleBlockedKey?: (key: string) => void;
  onToggleBlockedName?: (name: string) => void;
  blockedKeys?: string[];
  blockedNames?: string[];
  trackedTelemetryContacts?: string[];
  onToggleTrackedTelemetryContact?: (publicKey: string) => Promise<void>;
  analyzerSites?: AnalyzerSite[];
  onOpenContactInfo?: (publicKey: string) => void;
  onOpenConversation?: (publicKey: string) => void;

  // Repeater/room embedded login+dashboard region (optional).
  radioLat?: number | null;
  radioLon?: number | null;
  radioName?: string | null;
  notificationsSupported?: boolean;
  notificationsEnabled?: boolean;
  notificationsPermission?: NotificationPermission | 'unsupported';
  onToggleNotifications?: () => void;
  onTrace?: () => void;
  onPathDiscovery?: (publicKey: string) => Promise<PathDiscoveryResponse>;
  onDeleteContact?: (publicKey: string) => void | Promise<void>;
  trackedTelemetryRepeaters?: string[];
  onToggleTrackedTelemetry?: (publicKey: string) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
  repeaterAutoLoginKey?: string | null;
  onClearRepeaterAutoLogin?: () => void;
}

/**
 * Desktop full-page contact info view. Rendered by ConversationPane for the
 * `contact-info` route, and for repeaters/rooms on desktop. Reuses
 * `ContactInfoBody` split into three curated columns, and embeds the
 * repeater/room login + dashboard in a minimizable region. Mobile keeps the
 * `ContactInfoPane` Sheet and the standalone dashboards instead.
 */
export function ContactInfoView({
  publicKey,
  contacts,
  config,
  onBack,
  onToggleFavorite,
  onNavigateToChannel,
  onSearchMessagesByKey,
  onToggleBlockedKey,
  onToggleBlockedName,
  blockedKeys = [],
  blockedNames = [],
  trackedTelemetryContacts = [],
  onToggleTrackedTelemetryContact,
  analyzerSites = [],
  onOpenContactInfo,
  onOpenConversation,
  radioLat = null,
  radioLon = null,
  radioName = null,
  notificationsSupported = false,
  notificationsEnabled = false,
  notificationsPermission = 'unsupported',
  onToggleNotifications,
  onTrace,
  onPathDiscovery,
  onDeleteContact,
  trackedTelemetryRepeaters = [],
  onToggleTrackedTelemetry,
  onSeedKnownRegions,
  repeaterAutoLoginKey = null,
  onClearRepeaterAutoLogin,
}: ContactInfoViewProps) {
  const t = useT();
  const { analytics, loading, telemetryLoading, telemetryHistory, fetchTelemetry } =
    useContactInfoData(publicKey);
  const [pathDiscoveryOpen, setPathDiscoveryOpen] = useState(false);

  const liveContact = contacts.find((c) => c.public_key === publicKey) ?? null;
  const contact = liveContact ?? analytics?.contact ?? null;

  if (loading && !contact) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <MinimalTopBar t={t} onBack={onBack} title={t('contact_info_title')} />
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          {t('common_loading')}
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <MinimalTopBar t={t} onBack={onBack} title={t('contact_info_title')} />
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          {t('contact_not_found')}
        </div>
      </div>
    );
  }

  const displayName = getContactDisplayName(contact.name, contact.public_key, contact.last_advert);
  const isRepeater = contact.type === CONTACT_TYPE_REPEATER;
  const isRoom = contact.type === CONTACT_TYPE_ROOM;
  const conversation: Conversation = { type: 'contact', id: contact.public_key, name: displayName };

  const bodyProps = {
    contact,
    contacts,
    analytics,
    config,
    chartsReady: true,
    telemetryLoading,
    telemetryHistory,
    onFetchTelemetry: fetchTelemetry,
    onToggleFavorite,
    onNavigateToChannel,
    onSearchMessagesByKey,
    onToggleBlockedKey,
    onToggleBlockedName,
    blockedKeys,
    blockedNames,
    trackedTelemetryContacts,
    onToggleTrackedTelemetryContact,
    analyzerSites,
    onOpenContactInfo,
    onOpenConversation,
    showHeader: false,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common_back')}
          title={t('common_back')}
          className="p-1 flex-shrink-0 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <ContactAvatar
          name={contact.name}
          publicKey={contact.public_key}
          size={40}
          contactType={contact.type}
        />
        <div className="min-w-0">
          <h2 className="font-semibold text-base truncate leading-tight">{displayName}</h2>
          <span
            className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-primary transition-colors block truncate"
            role="button"
            tabIndex={0}
            onKeyDown={handleKeyboardActivate}
            onClick={() => {
              navigator.clipboard.writeText(contact.public_key);
              toast.success(t('toast_public_key_copied'));
            }}
            title={t('a11y_click_to_copy')}
          >
            {contact.public_key}
          </span>
          {(isRepeater || isRoom) && (
            <div className="text-[0.6875rem] text-muted-foreground">
              <ContactStatusInfo contact={contact} ourLat={radioLat} ourLon={radioLon} />
            </div>
          )}
        </div>
        <span className="ml-1 flex-shrink-0 text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
          {contactTypeLabel(contact.type, t)}
        </span>
        {(isRepeater || isRoom) && (
          <div className="ml-auto flex items-center gap-0.5">
            {onPathDiscovery && (
              <button
                type="button"
                className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setPathDiscoveryOpen(true)}
                title={t('chat_path_discovery_description')}
                aria-label={t('a11y_path_discovery')}
              >
                <Route className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            )}
            {onTrace && (
              <button
                type="button"
                className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onTrace}
                title={t('a11y_direct_trace')}
                aria-label={t('a11y_direct_trace')}
              >
                <DirectTraceIcon className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
            {notificationsSupported && onToggleNotifications && (
              <button
                type="button"
                className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onToggleNotifications}
                title={
                  notificationsEnabled
                    ? t('repeater_notifications_disable_title')
                    : notificationsPermission === 'denied'
                      ? t('repeater_notifications_blocked_title')
                      : t('repeater_notifications_enable_title')
                }
                aria-label={
                  notificationsEnabled
                    ? t('repeater_notifications_disable_aria')
                    : t('repeater_notifications_enable_aria')
                }
              >
                <Bell
                  className={`h-4 w-4 ${notificationsEnabled ? 'text-status-connected' : 'text-muted-foreground'}`}
                  fill={notificationsEnabled ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              </button>
            )}
            {onDeleteContact && (
              <button
                type="button"
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onDeleteContact(contact.public_key)}
                title={t('common_delete')}
                aria-label={t('common_delete')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {(isRepeater || isRoom) && (
          <LoginRegion
            t={t}
            contact={contact}
            conversation={conversation}
            contacts={contacts}
            isRepeater={isRepeater}
            trackedTelemetryRepeaters={trackedTelemetryRepeaters}
            onToggleTrackedTelemetry={onToggleTrackedTelemetry}
            onSeedKnownRegions={onSeedKnownRegions}
            autoLoginAndLoadAll={repeaterAutoLoginKey === contact.public_key}
            onAutoLoginConsumed={onClearRepeaterAutoLogin}
          />
        )}
        <div className="mx-auto w-full max-w-6xl px-4 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-6 items-start">
            <RegionColumn heading={t('contact_region_identity')}>
              <ContactInfoBody {...bodyProps} region="identity" />
            </RegionColumn>
            <RegionColumn heading={t('contact_region_data')}>
              <ContactInfoBody {...bodyProps} region="data" />
            </RegionColumn>
            <RegionColumn heading={t('contact_region_network')}>
              <ContactInfoBody {...bodyProps} region="network" />
            </RegionColumn>
          </div>
        </div>
      </div>

      {(isRepeater || isRoom) && onPathDiscovery && (
        <ContactPathDiscoveryModal
          open={pathDiscoveryOpen}
          onClose={() => setPathDiscoveryOpen(false)}
          contact={contact}
          contacts={contacts}
          radioName={radioName}
          onDiscover={onPathDiscovery}
        />
      )}
    </div>
  );
}

function RegionColumn({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border overflow-hidden">
      <h3 className="px-5 py-2 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
        {heading}
      </h3>
      {children}
    </section>
  );
}

function LoginRegion({
  t,
  contact,
  conversation,
  contacts,
  isRepeater,
  trackedTelemetryRepeaters,
  onToggleTrackedTelemetry,
  onSeedKnownRegions,
  autoLoginAndLoadAll,
  onAutoLoginConsumed,
}: {
  t: ReturnType<typeof useT>;
  contact: Contact;
  conversation: Conversation;
  contacts: Contact[];
  isRepeater: boolean;
  trackedTelemetryRepeaters: string[];
  onToggleTrackedTelemetry?: (publicKey: string) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
  autoLoginAndLoadAll: boolean;
  onAutoLoginConsumed?: () => void;
}) {
  // Expanded by default so the login form is immediately visible.
  const [open, setOpen] = useState(true);
  const label = isRepeater
    ? t('contact_repeater_login_dashboard')
    : t('contact_room_login_dashboard');

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={label}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 bg-muted/40 text-sm font-medium hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="p-4">
          {isRepeater ? (
            <RepeaterDashboardBody
              conversation={conversation}
              contacts={contacts}
              trackedTelemetryRepeaters={trackedTelemetryRepeaters}
              onToggleTrackedTelemetry={onToggleTrackedTelemetry ?? (async () => {})}
              onSeedKnownRegions={onSeedKnownRegions}
              autoLoginAndLoadAll={autoLoginAndLoadAll}
              onAutoLoginConsumed={onAutoLoginConsumed}
            />
          ) : (
            <RoomServerPanel contact={contact} />
          )}
        </div>
      )}
    </div>
  );
}

function MinimalTopBar({
  t,
  onBack,
  title,
}: {
  t: ReturnType<typeof useT>;
  onBack: () => void;
  title: string;
}) {
  return (
    <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common_back')}
        title={t('common_back')}
        className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <h2 className="font-semibold text-base truncate">{title}</h2>
    </header>
  );
}
