import type { ReactNode } from 'react';
import { Gauge, Map, Menu, MessagesSquare } from 'lucide-react';

import { useT } from '../../i18n';
import { cn } from '@/lib/utils';

export type AtlasTab = 'chats' | 'map' | 'node' | 'more';

interface AtlasTabBarProps {
  /** The tab that matches the page (or the open drawer) on screen, if any. */
  active: AtlasTab | null;
  onSelect: (tab: AtlasTab) => void;
}

/**
 * The Atlas layout's phone navigation: a bottom tab bar instead of the menu
 * button. Chats and More open the drawer (conversations, or tools and app
 * controls); Map and My Node go straight to their page.
 */
export function AtlasTabBar({ active, onSelect }: AtlasTabBarProps) {
  const t = useT();
  const tabs: { id: AtlasTab; label: string; icon: ReactNode }[] = [
    { id: 'chats', label: t('nav_tab_chats'), icon: <MessagesSquare aria-hidden="true" /> },
    { id: 'map', label: t('nav_tab_map'), icon: <Map aria-hidden="true" /> },
    { id: 'node', label: t('nav_my_node'), icon: <Gauge aria-hidden="true" /> },
    { id: 'more', label: t('nav_tab_more'), icon: <Menu aria-hidden="true" /> },
  ];

  return (
    <nav
      className="atlas-tabbar flex border-t border-border bg-card px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      aria-label={t('a11y_navigation')}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          className={cn(
            'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&>svg]:h-[22px] [&>svg]:w-[22px]',
            active === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.icon}
          <span className="max-w-full truncate">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
