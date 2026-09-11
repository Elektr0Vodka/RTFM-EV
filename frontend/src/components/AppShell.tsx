import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { useSwipeable } from 'react-swipeable';

import { StatusBar } from './StatusBar';
import { Sidebar } from './Sidebar';
import { ConversationPane } from './ConversationPane';
import { NewMessageModal } from './NewMessageModal';
import { BulkAddChannelResultModal } from './BulkAddChannelResultModal';
import { ContactInfoPane } from './ContactInfoPane';
import { ChannelInfoPane } from './ChannelInfoPane';
import { MentionTicker, type MentionEvent } from './MentionTicker';
import { CommandPalette } from './CommandPalette';
import { SecurityWarningModal } from './SecurityWarningModal';
import { Toaster } from './ui/sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import {
  SETTINGS_SECTION_ICONS,
  SETTINGS_SECTION_ORDER,
  settingsSectionLabel,
  type SettingsSection,
} from './settings/settingsConstants';
import { getContrastTextColor, type LocalLabel } from '../utils/localLabel';
import { useT } from '../i18n';
import type { CrackerPanelProps } from './CrackerPanel';
import type { SearchViewProps } from './SearchView';
import type { SettingsModalProps } from './SettingsModal';
import { cn } from '@/lib/utils';

const SettingsModal = lazy(() =>
  import('./SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const CrackerPanel = lazy(() =>
  import('./CrackerPanel').then((m) => ({ default: m.CrackerPanel }))
);
const SearchView = lazy(() => import('./SearchView').then((m) => ({ default: m.SearchView })));

type SidebarProps = ComponentProps<typeof Sidebar>;
type ConversationPaneProps = ComponentProps<typeof ConversationPane>;
type NewMessageModalProps = Omit<ComponentProps<typeof NewMessageModal>, 'open' | 'onClose'>;
type BulkAddChannelResultModalProps = Omit<
  ComponentProps<typeof BulkAddChannelResultModal>,
  'open' | 'onClose'
>;
type ContactInfoPaneProps = ComponentProps<typeof ContactInfoPane>;
type ChannelInfoPaneProps = ComponentProps<typeof ChannelInfoPane>;

interface AppShellProps {
  localLabel: LocalLabel;
  showNewMessage: boolean;
  showBulkAddResults: boolean;
  showSettings: boolean;
  settingsSection: SettingsSection;
  sidebarOpen: boolean;
  showCracker: boolean;
  disabledSettingsSections?: SettingsSection[];
  onSettingsSectionChange: (section: SettingsSection) => void;
  onSidebarOpenChange: (open: boolean) => void;
  onCrackerRunningChange: (running: boolean) => void;
  onToggleSettingsView: () => void;
  onCloseSettingsView: () => void;
  onCloseNewMessage: () => void;
  onCloseBulkAddResults: () => void;
  onLocalLabelChange: (label: LocalLabel) => void;
  statusProps: Pick<ComponentProps<typeof StatusBar>, 'health' | 'config'>;
  sidebarProps: SidebarProps;
  conversationPaneProps: ConversationPaneProps;
  searchProps: SearchViewProps;
  settingsProps: Omit<
    SettingsModalProps,
    'open' | 'pageMode' | 'externalSidebarNav' | 'desktopSection' | 'onClose' | 'onLocalLabelChange'
  >;
  crackerProps: Omit<CrackerPanelProps, 'visible' | 'onRunningChange'>;
  newMessageModalProps: NewMessageModalProps;
  bulkAddChannelResultModalProps: BulkAddChannelResultModalProps;
  contactInfoPaneProps: ContactInfoPaneProps;
  channelInfoPaneProps: ChannelInfoPaneProps;
  showMentionTicker?: boolean;
  mentionTickerEvents?: MentionEvent[];
  onNavigateMentionToMessage?: (channelKey: string, messageId: number) => void;
  onDismissMention?: (key: number) => void;
  onRepeaterAutoLogin: (publicKey: string, displayName: string) => void;
}

export function AppShell({
  localLabel,
  showNewMessage,
  showBulkAddResults,
  showSettings,
  settingsSection,
  sidebarOpen,
  showCracker,
  disabledSettingsSections = [],
  onSettingsSectionChange,
  onSidebarOpenChange,
  onCrackerRunningChange,
  onToggleSettingsView,
  onCloseSettingsView,
  onCloseNewMessage,
  onCloseBulkAddResults,
  onLocalLabelChange,
  statusProps,
  sidebarProps,
  conversationPaneProps,
  searchProps,
  settingsProps,
  crackerProps,
  newMessageModalProps,
  bulkAddChannelResultModalProps,
  contactInfoPaneProps,
  channelInfoPaneProps,
  showMentionTicker = true,
  mentionTickerEvents = [],
  onNavigateMentionToMessage,
  onDismissMention,
  onRepeaterAutoLogin,
}: AppShellProps) {
  const t = useT();
  const swipeHandlers = useSwipeable({
    onSwipedRight: ({ initial }) => {
      if (initial[0] < 30 && !sidebarOpen && window.innerWidth < 768) {
        onSidebarOpenChange(true);
      }
    },
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: true,
  });

  const closeSwipeHandlers = useSwipeable({
    onSwipedLeft: () => onSidebarOpenChange(false),
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
  });

  const handleOpenSettings = useCallback(
    (section: SettingsSection) => {
      onSettingsSectionChange(section);
      if (!showSettings) onToggleSettingsView();
    },
    [onSettingsSectionChange, onToggleSettingsView, showSettings]
  );

  const searchMounted = useRef(false);
  if (conversationPaneProps.activeConversation?.type === 'search') {
    searchMounted.current = true;
  }

  const crackerMounted = useRef(false);
  if (showCracker) {
    crackerMounted.current = true;
  }

  // Position toasts below the conversation header when in chat, otherwise below the status bar
  const TOAST_TOP_PADDING = 10;
  const [toastTopOffset, setToastTopOffset] = useState<number | undefined>(undefined);
  const hasLocalLabel = !!localLabel.text;
  const activeType = conversationPaneProps.activeConversation?.type;
  const activeId = conversationPaneProps.activeConversation?.id;
  useEffect(() => {
    const measure = () => {
      const anchor =
        document.querySelector('[data-toast-anchor="conversation"]') ??
        document.querySelector('[data-toast-anchor="statusbar"]');
      setToastTopOffset(
        anchor ? anchor.getBoundingClientRect().top + TOAST_TOP_PADDING : undefined
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hasLocalLabel, activeType, activeId, showSettings]);

  const settingsSidebarContent = (
    <nav
      className="sidebar w-60 h-full min-h-0 overflow-hidden bg-card border-r border-border flex flex-col"
      aria-label={t('a11y_settings_nav')}
    >
      <div className="flex justify-between items-center px-3 py-2.5 border-b border-border">
        <h2 className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {t('nav_settings_heading')}
        </h2>
        <button
          type="button"
          onClick={onCloseSettingsView}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-status-connected/15 border border-status-connected/30 text-status-connected hover:bg-status-connected/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t('a11y_back_to_conversations')}
          aria-label={t('a11y_back_to_conversations')}
        >
          &larr; {t('nav_back_to_chat')}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1 [contain:layout_paint]">
        {SETTINGS_SECTION_ORDER.map((section) => {
          const Icon = SETTINGS_SECTION_ICONS[section];
          const disabled = disabledSettingsSections.includes(section);
          return (
            <button
              key={section}
              type="button"
              disabled={disabled}
              className={cn(
                'w-full px-3 py-2 text-left text-[0.8125rem] border-l-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50',
                !disabled && 'hover:bg-accent',
                settingsSection === section && !disabled && 'bg-accent border-l-primary'
              )}
              aria-current={settingsSection === section ? 'true' : undefined}
              onClick={() => onSettingsSectionChange(section)}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>{settingsSectionLabel(section, t)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  const renderSidebar = (forceExpanded: boolean) =>
    showSettings ? settingsSidebarContent : <Sidebar {...sidebarProps} forceExpanded={forceExpanded} />;

  return (
    <div className="flex flex-col h-full" {...swipeHandlers}>
      <div className="page-stripe" aria-hidden="true" />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground"
      >
        {t('nav_skip_to_content')}
      </a>
      {localLabel.text && (
        <div
          style={{
            backgroundColor: localLabel.color,
            color: getContrastTextColor(localLabel.color),
          }}
          className="px-4 py-1 text-center text-sm font-medium"
        >
          {localLabel.text}
        </div>
      )}

      <StatusBar
        health={statusProps.health}
        config={statusProps.config}
        settingsMode={showSettings}
        onSettingsClick={onToggleSettingsView}
        onMenuClick={showSettings ? undefined : () => onSidebarOpenChange(true)}
      />
      <div data-toast-anchor="statusbar" aria-hidden="true" />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block min-h-0 overflow-hidden">{renderSidebar(false)}</div>

        <Sheet open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
          <SheetContent
            side="left"
            className="w-[280px] p-0 flex flex-col"
            hideCloseButton
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t('a11y_navigation')}</SheetTitle>
              <SheetDescription>{t('a11y_sidebar_navigation')}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-hidden" {...closeSwipeHandlers}>
              {renderSidebar(true)}
            </div>
          </SheetContent>
        </Sheet>

        <main id="main-content" className="flex-1 flex flex-col bg-background min-w-0">
          <MentionTicker
            enabled={showMentionTicker}
            mentions={mentionTickerEvents}
            onNavigateToMessage={onNavigateMentionToMessage ?? (() => {})}
            onDismiss={onDismissMention}
          />
          <div
            className={cn(
              'flex-1 flex flex-col min-h-0',
              (showSettings || conversationPaneProps.activeConversation?.type === 'search') &&
                'hidden'
            )}
          >
            <ConversationPane {...conversationPaneProps} />
          </div>

          {searchMounted.current && (
            <div
              className={cn(
                'flex-1 flex flex-col min-h-0',
                (conversationPaneProps.activeConversation?.type !== 'search' || showSettings) &&
                  'hidden'
              )}
            >
              <Suspense
                fallback={
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    {t('common_loading_search')}
                  </div>
                }
              >
                <SearchView {...searchProps} />
              </Suspense>
            </div>
          )}

          {showSettings && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
                      {t('common_loading_settings')}
                    </div>
                  }
                >
                  <SettingsModal
                    {...settingsProps}
                    open={showSettings}
                    pageMode
                    externalSidebarNav
                    desktopSection={settingsSection}
                    onClose={onCloseSettingsView}
                    onLocalLabelChange={onLocalLabelChange}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </main>
      </div>

      <div
        className={cn(
          'border-t border-border bg-background transition-all duration-200 overflow-hidden',
          showCracker ? 'h-[275px]' : 'h-0'
        )}
      >
        {crackerMounted.current && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t('common_loading_channel_finder')}
              </div>
            }
          >
            <CrackerPanel
              {...crackerProps}
              visible={showCracker}
              onRunningChange={onCrackerRunningChange}
            />
          </Suspense>
        )}
      </div>

      <NewMessageModal
        {...newMessageModalProps}
        open={showNewMessage}
        onClose={onCloseNewMessage}
      />
      <BulkAddChannelResultModal
        {...bulkAddChannelResultModalProps}
        open={showBulkAddResults}
        onClose={onCloseBulkAddResults}
      />

      <CommandPalette
        contacts={sidebarProps.contacts}
        channels={sidebarProps.channels}
        onSelectConversation={sidebarProps.onSelectConversation}
        onOpenSettings={handleOpenSettings}
        onRepeaterAutoLogin={onRepeaterAutoLogin}
      />
      <SecurityWarningModal health={statusProps.health} />
      <ContactInfoPane {...contactInfoPaneProps} />
      <ChannelInfoPane {...channelInfoPaneProps} />
      <Toaster
        position="top-right"
        offset={toastTopOffset !== undefined ? { top: toastTopOffset } : undefined}
        mobileOffset={toastTopOffset !== undefined ? { top: toastTopOffset } : undefined}
      />
    </div>
  );
}
