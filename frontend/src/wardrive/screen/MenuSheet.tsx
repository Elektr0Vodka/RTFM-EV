// The menu: a sheet over the map with tabs. Presentation only: the page passes
// in what each tab holds (account, radio, position and forwarding on Status;
// theme and accessibility on Settings; the stored-data map; About).
import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useT } from '../../i18n';

export type MenuTab = 'status' | 'settings' | 'map' | 'about';
const TABS: MenuTab[] = ['status', 'settings', 'map', 'about'];
const TAB_KEY: Record<MenuTab, string> = {
  status: 'wardrive_page_tab_status',
  settings: 'wardrive_page_tab_settings',
  map: 'wardrive_page_tab_map',
  about: 'wardrive_page_tab_about',
};

export interface MenuSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  tab: MenuTab;
  onTab(tab: MenuTab): void;
  status: ReactNode;
  settings: ReactNode;
  map: ReactNode;
  about: ReactNode;
}

export function MenuSheet({
  open,
  onOpenChange,
  tab,
  onTab,
  status,
  settings,
  map,
  about,
}: MenuSheetProps) {
  const t = useT();
  const body: Record<MenuTab, ReactNode> = { status, settings, map, about };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle className="sr-only">{t('wardrive_page_menu')}</SheetTitle>
        <Tabs value={tab} onValueChange={(v) => onTab(v as MenuTab)}>
          <TabsList className="mb-3 w-full">
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id} className="flex-1">
                {t(TAB_KEY[id])}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((id) => (
            <TabsContent key={id} value={id} className="space-y-3">
              {body[id]}
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
