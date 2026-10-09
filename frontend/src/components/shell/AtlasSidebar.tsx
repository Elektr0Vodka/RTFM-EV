import type { ReactNode } from 'react';
import { ArrowLeft, MessagesSquare, Moon, Search, Settings, Sun } from 'lucide-react';

import { useT } from '../../i18n';
import { useIsDarkTheme } from '../../hooks/useIsDarkTheme';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';
import { BUDDY_ANCHORS } from '../../buddy/buddyAnchors';
import { openCommandPalette } from '../../utils/commandPalette';
import { HeaderLanguageMenu } from '../HeaderLanguageMenu';
import { AppBrand, type AppBrandProps } from './AppBrand';
import { cn } from '@/lib/utils';

// The Atlas layout (themes with `layout: 'atlas'`) moves the brand and the
// app-level controls out of the top bar and into the sidebar: the head carries
// the brand and the search button, the foot carries settings, chat window,
// language and theme. `rail` is the sidebar collapsed to icons.

const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

interface AtlasSidebarHeadProps extends AppBrandProps {
  rail?: boolean;
}

export function AtlasSidebarHead({ rail = false, ...brand }: AtlasSidebarHeadProps) {
  const t = useT();
  return (
    <div
      className={cn(
        'atlas-side-head flex flex-col border-b border-border',
        rail ? 'items-center gap-2 px-1 py-3' : 'gap-3 px-3 pb-3 pt-4'
      )}
    >
      <h1
        className={cn(
          'flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight text-foreground',
          !rail && 'px-1'
        )}
      >
        <AppBrand {...brand} iconOnly={rail} iconClassName="h-6 w-6" />
      </h1>
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label={t('nav_search_anything')}
        title={rail ? t('nav_search_anything') : undefined}
        className={cn(
          'flex items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          rail ? 'h-9 w-9 justify-center' : 'h-9 w-full gap-2 px-3 text-[0.8125rem]'
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!rail && (
          <>
            <span className="flex-1 truncate text-left">{t('nav_search_anything')}</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.625rem]">
              {IS_APPLE ? '⌘K' : 'Ctrl K'}
            </kbd>
          </>
        )}
      </button>
    </div>
  );
}

interface FootRowProps {
  icon: ReactNode;
  label: string;
  title?: string;
  rail: boolean;
  onClick: () => void;
  buddyAnchor?: string;
  children?: ReactNode;
}

function FootRow({ icon, label, title, rail, onClick, buddyAnchor, children }: FootRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (rail ? label : undefined)}
      aria-label={rail ? label : undefined}
      data-buddy-anchor={buddyAnchor}
      className={cn(
        'atlas-foot-row relative flex items-center border-l-2 border-transparent text-[0.8125rem] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        rail ? 'w-full justify-center py-2' : 'w-full gap-2 px-3 py-2 text-left'
      )}
    >
      <span className="relative flex h-4 w-4 items-center justify-center text-muted-foreground">
        {icon}
        {children}
      </span>
      {!rail && <span className="flex-1 truncate">{label}</span>}
    </button>
  );
}

interface AtlasSidebarFootProps {
  rail?: boolean;
  settingsMode: boolean;
  onSettingsClick: () => void;
  /** Open the chat-only popup window. The row is hidden when omitted. */
  onOpenChatWindow?: () => void;
  onOpenThemeSettings: () => void;
}

export function AtlasSidebarFoot({
  rail = false,
  settingsMode,
  onSettingsClick,
  onOpenChatWindow,
  onOpenThemeSettings,
}: AtlasSidebarFootProps) {
  const t = useT();
  const dark = useIsDarkTheme();
  const { status: updateStatus } = useUpdateStatus();

  return (
    <div className="atlas-side-foot relative border-t border-border py-1">
      <FootRow
        rail={rail}
        icon={
          settingsMode ? (
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Settings className="h-4 w-4" aria-hidden="true" />
          )
        }
        label={settingsMode ? t('nav_back_to_chat') : t('nav_settings_heading')}
        onClick={onSettingsClick}
        buddyAnchor={BUDDY_ANCHORS.update}
      >
        {updateStatus?.update_available ? (
          <span
            aria-label={t('a11y_update_available')}
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
          />
        ) : null}
      </FootRow>
      {onOpenChatWindow && (
        <FootRow
          rail={rail}
          icon={<MessagesSquare className="h-4 w-4" aria-hidden="true" />}
          label={t('popout_open_chat_window')}
          title={t('popout_open_chat_window_title')}
          onClick={onOpenChatWindow}
        />
      )}
      {/* The language menu opens upwards and needs the sidebar's width, so the
          rail leaves it out; it is in Settings and one click away when expanded. */}
      {!rail && <HeaderLanguageMenu variant="row" />}
      <FootRow
        rail={rail}
        icon={
          dark ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )
        }
        label={t('settings_color_scheme')}
        title={t('a11y_open_theme_settings')}
        onClick={onOpenThemeSettings}
      />
    </div>
  );
}
