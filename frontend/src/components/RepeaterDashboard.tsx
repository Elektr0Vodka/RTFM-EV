import { useState } from 'react';

import { toast } from './ui/sonner';
import { Bell, Info, Route, Star, Trash2 } from 'lucide-react';
import { DirectTraceIcon } from './DirectTraceIcon';
import { handleKeyboardActivate } from '../utils/a11y';
import { ContactStatusInfo } from './ContactStatusInfo';
import type { Contact, Conversation, PathDiscoveryResponse } from '../types';
import { cn } from '../lib/utils';
import { RepeaterDashboardBody } from './repeater/RepeaterDashboardBody';
import { ContactPathDiscoveryModal } from './ContactPathDiscoveryModal';
import { useT } from '../i18n';

// Re-export for backwards compatibility (used by repeaterFormatters.test.ts)
export { formatDuration, formatClockDrift } from './repeater/repeaterPaneShared';

// --- Main Dashboard ---

interface RepeaterDashboardProps {
  conversation: Conversation;
  contacts: Contact[];
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationsPermission: NotificationPermission | 'unsupported';
  radioLat: number | null;
  radioLon: number | null;
  radioName: string | null;
  onTrace: () => void;
  onPathDiscovery: (publicKey: string) => Promise<PathDiscoveryResponse>;
  onToggleNotifications: () => void;
  onToggleFavorite: (type: 'channel' | 'contact', id: string) => void;
  onDeleteContact: (publicKey: string) => void;
  onOpenContactInfo?: (publicKey: string) => void;
  trackedTelemetryRepeaters: string[];
  onToggleTrackedTelemetry: (publicKey: string) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
  autoLoginAndLoadAll?: boolean;
  onAutoLoginConsumed?: () => void;
}

export function RepeaterDashboard({
  conversation,
  contacts,
  notificationsSupported,
  notificationsEnabled,
  notificationsPermission,
  radioLat,
  radioLon,
  radioName,
  onTrace,
  onPathDiscovery,
  onToggleNotifications,
  onToggleFavorite,
  onDeleteContact,
  onOpenContactInfo,
  trackedTelemetryRepeaters,
  onToggleTrackedTelemetry,
  onSeedKnownRegions,
  autoLoginAndLoadAll,
  onAutoLoginConsumed,
}: RepeaterDashboardProps) {
  const t = useT();
  const [pathDiscoveryOpen, setPathDiscoveryOpen] = useState(false);
  const contact = contacts.find((c) => c.public_key === conversation.id) ?? null;
  const isFav = contact?.favorite ?? false;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header
        className={cn(
          'grid items-start gap-x-2 gap-y-0.5 border-b border-border px-4 py-2.5',
          contact
            ? 'grid-cols-[minmax(0,1fr)_auto] min-[1100px]:grid-cols-[minmax(0,1fr)_auto_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto]'
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <h2 className="min-w-0 flex-shrink font-semibold text-base">
                {onOpenContactInfo ? (
                  <button
                    type="button"
                    className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('repeater_view_info_aria', { name: conversation.name })}
                    onClick={() => onOpenContactInfo(conversation.id)}
                  >
                    <span className="truncate">{conversation.name}</span>
                    <Info
                      className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/80"
                      aria-hidden="true"
                    />
                  </button>
                ) : (
                  <span className="truncate">{conversation.name}</span>
                )}
              </h2>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground transition-colors hover:text-primary"
                role="button"
                tabIndex={0}
                onKeyDown={handleKeyboardActivate}
                onClick={() => {
                  navigator.clipboard.writeText(conversation.id);
                  toast.success(t('toast_contact_key_copied'));
                }}
                title={t('a11y_click_to_copy')}
              >
                {conversation.id}
              </span>
            </span>
          </span>
        </span>
        {contact && (
          <div className="col-span-2 row-start-2 min-w-0 text-[0.6875rem] text-muted-foreground min-[1100px]:col-span-1 min-[1100px]:col-start-2 min-[1100px]:row-start-1">
            <ContactStatusInfo contact={contact} ourLat={radioLat} ourLon={radioLon} />
          </div>
        )}
        <div className="flex items-center gap-0.5">
          {contact && (
            <button
              className="p-1 rounded hover:bg-accent text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPathDiscoveryOpen(true)}
              title={t('chat_path_discovery_description')}
              aria-label={t('a11y_path_discovery')}
            >
              <Route className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-accent text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onTrace}
            title={t('a11y_direct_trace')}
            aria-label={t('a11y_direct_trace')}
          >
            <DirectTraceIcon className="h-4 w-4 text-muted-foreground" />
          </button>
          {notificationsSupported && (
            <button
              className="flex items-center gap-1 rounded px-1 py-1 hover:bg-accent text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              {notificationsEnabled && (
                <span className="hidden md:inline text-[0.6875rem] font-medium text-status-connected">
                  {t('repeater_notifications_on')}
                </span>
              )}
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-accent text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onToggleFavorite('contact', conversation.id)}
            title={
              isFav ? t('chat_remove_favorite_contact_desc') : t('chat_add_favorite_contact_desc')
            }
            aria-label={isFav ? t('common_remove_from_favorites') : t('common_add_to_favorites')}
          >
            {isFav ? (
              <Star className="h-4 w-4 fill-current text-favorite" aria-hidden="true" />
            ) : (
              <Star className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          <button
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive text-lg leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onDeleteContact(conversation.id)}
            title={t('common_delete')}
            aria-label={t('common_delete')}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {contact && (
          <ContactPathDiscoveryModal
            open={pathDiscoveryOpen}
            onClose={() => setPathDiscoveryOpen(false)}
            contact={contact}
            contacts={contacts}
            radioName={radioName}
            onDiscover={onPathDiscovery}
          />
        )}
      </header>
      <div data-toast-anchor="conversation" aria-hidden="true" />

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <RepeaterDashboardBody
          conversation={conversation}
          contacts={contacts}
          trackedTelemetryRepeaters={trackedTelemetryRepeaters}
          onToggleTrackedTelemetry={onToggleTrackedTelemetry}
          onSeedKnownRegions={onSeedKnownRegions}
          autoLoginAndLoadAll={autoLoginAndLoadAll}
          onAutoLoginConsumed={onAutoLoginConsumed}
        />
      </div>
    </div>
  );
}
