import { Ban, Search } from 'lucide-react';
import { formatTime } from '../utils/messageParser';
import { useT } from '../i18n';
import { ContactAvatar } from './ContactAvatar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { useEntranceSettled } from '../hooks/useEntranceSettled';
import { useContactInfoData } from '../hooks/useContactInfoData';
import {
  ContactInfoBody,
  ChannelAttributionWarning,
  MessageStatsSection,
  ActivityChartsSection,
  MostActiveChannelsSection,
  InfoItem,
} from './ContactInfoBody';
import type { AnalyzerSite, Contact, ContactGroup, RadioConfig } from '../types';

interface ContactInfoPaneProps {
  contactKey: string | null;
  fromChannel?: boolean;
  onClose: () => void;
  contacts: Contact[];
  config: RadioConfig | null;
  onToggleFavorite: (type: 'channel' | 'contact', id: string) => void;
  onNavigateToChannel?: (channelKey: string) => void;
  onSearchMessagesByKey?: (publicKey: string) => void;
  onSearchMessagesByName?: (name: string) => void;
  blockedKeys?: string[];
  blockedNames?: string[];
  onToggleBlockedKey?: (key: string) => void;
  onToggleBlockedName?: (name: string) => void;
  trackedTelemetryContacts?: string[];
  onToggleTrackedTelemetryContact?: (publicKey: string) => Promise<void>;
  analyzerSites?: AnalyzerSite[];
  contactGroups?: ContactGroup[];
  onUpdateContactGroups?: (next: ContactGroup[]) => void | Promise<void>;
  onOpenContactInfo?: (publicKey: string) => void;
  onOpenConversation?: (publicKey: string) => void;
}

export function ContactInfoPane({
  contactKey,
  fromChannel = false,
  onClose,
  contacts,
  config,
  onToggleFavorite,
  onNavigateToChannel,
  onSearchMessagesByKey,
  onSearchMessagesByName,
  blockedKeys = [],
  blockedNames = [],
  onToggleBlockedKey,
  onToggleBlockedName,
  trackedTelemetryContacts = [],
  onToggleTrackedTelemetryContact,
  analyzerSites = [],
  contactGroups,
  onUpdateContactGroups,
  onOpenContactInfo,
  onOpenConversation,
}: ContactInfoPaneProps) {
  const t = useT();
  const isNameOnly = contactKey?.startsWith('name:') ?? false;
  const nameOnlyValue = isNameOnly && contactKey ? contactKey.slice(5) : null;

  const { analytics, loading, telemetryLoading, telemetryHistory, fetchTelemetry } =
    useContactInfoData(contactKey);

  // Get live contact data from contacts array (real-time via WS)
  const liveContact =
    contactKey && !isNameOnly ? (contacts.find((c) => c.public_key === contactKey) ?? null) : null;

  // Defer mounting Recharts containers until the pane's slide-in animation
  // settles; mounting them mid-transform crashes Safari (React #185). See #317.
  const chartsReady = useEntranceSettled(contactKey !== null);

  // Use live contact data where available, fall back to analytics snapshot
  const contact = liveContact ?? analytics?.contact ?? null;

  return (
    <Sheet open={contactKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[400px] p-0 flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('contact_info_title')}</SheetTitle>
          <SheetDescription>{t('contact_info_description')}</SheetDescription>
        </SheetHeader>

        {isNameOnly && nameOnlyValue ? (
          <div className="flex-1 overflow-y-auto">
            {/* Name-only header */}
            <div className="px-5 pt-5 pb-4 border-b border-border">
              <div className="flex items-start gap-4">
                <ContactAvatar
                  name={analytics?.name ?? nameOnlyValue}
                  publicKey={`name:${nameOnlyValue}`}
                  size={56}
                />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold truncate">
                    {analytics?.name ?? nameOnlyValue}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('contact_name_only_advert_note')}
                  </p>
                </div>
              </div>
            </div>

            {/* Block by name toggle */}
            {onToggleBlockedName && (
              <div className="px-5 py-3 border-b border-border">
                <button
                  type="button"
                  className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
                  onClick={() => onToggleBlockedName(nameOnlyValue)}
                >
                  {blockedNames.includes(nameOnlyValue) ? (
                    <>
                      <Ban className="h-4.5 w-4.5 text-destructive" aria-hidden="true" />
                      <span>{t('contact_unblock_name')}</span>
                    </>
                  ) : (
                    <>
                      <Ban className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                      <span>{t('contact_block_name')}</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {onSearchMessagesByName && (
              <div className="px-5 py-3 border-b border-border">
                <button
                  type="button"
                  className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
                  onClick={() => onSearchMessagesByName(nameOnlyValue)}
                >
                  <Search className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t('contact_search_messages_by_name')}</span>
                </button>
              </div>
            )}

            {fromChannel && (
              <ChannelAttributionWarning
                t={t}
                nameOnly
                includeAliasNote={false}
                className="border-b border-border mx-0 my-0 rounded-none px-5 py-3"
              />
            )}

            <MessageStatsSection
              t={t}
              dmMessageCount={0}
              channelMessageCount={analytics?.channel_message_count ?? 0}
              showDirectMessages={false}
            />

            {analytics?.name_first_seen_at && (
              <div className="px-5 py-3 border-b border-border">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <InfoItem
                    label={t('contact_name_first_in_use')}
                    value={formatTime(analytics.name_first_seen_at)}
                  />
                </div>
              </div>
            )}

            <ActivityChartsSection analytics={analytics} ready={chartsReady} t={t} />

            <MostActiveChannelsSection
              t={t}
              channels={analytics?.most_active_rooms ?? []}
              onNavigateToChannel={onNavigateToChannel}
            />
          </div>
        ) : loading && !analytics && !contact ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            {t('common_loading')}
          </div>
        ) : contact ? (
          <div className="flex-1 overflow-y-auto">
            <ContactInfoBody
              contact={contact}
              contacts={contacts}
              analytics={analytics}
              config={config}
              chartsReady={chartsReady}
              telemetryLoading={telemetryLoading}
              telemetryHistory={telemetryHistory}
              onFetchTelemetry={fetchTelemetry}
              fromChannel={fromChannel}
              onToggleFavorite={onToggleFavorite}
              onNavigateToChannel={onNavigateToChannel}
              onSearchMessagesByKey={onSearchMessagesByKey}
              onToggleBlockedKey={onToggleBlockedKey}
              onToggleBlockedName={onToggleBlockedName}
              blockedKeys={blockedKeys}
              blockedNames={blockedNames}
              trackedTelemetryContacts={trackedTelemetryContacts}
              onToggleTrackedTelemetryContact={onToggleTrackedTelemetryContact}
              analyzerSites={analyzerSites}
              contactGroups={contactGroups}
              onUpdateContactGroups={onUpdateContactGroups}
              onOpenContactInfo={onOpenContactInfo}
              onOpenConversation={onOpenConversation}
              region="all"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            {t('contact_not_found')}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
