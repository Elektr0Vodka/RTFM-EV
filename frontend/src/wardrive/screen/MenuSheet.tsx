// The menu: a sheet over the map with tabs. Presentation only: the page passes
// in what each tab holds (account, radio, position and forwarding on Status;
// theme and accessibility on Settings; stored drives and the stored-data map
// on Drives; reports on Reports; About).
import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useT } from '../../i18n';
import { SIDE_SHEET_STYLE } from './sheetStyle';

export type MenuTab = 'status' | 'settings' | 'drives' | 'reports' | 'about';
const TABS: MenuTab[] = ['status', 'settings', 'drives', 'reports', 'about'];
const TAB_KEY: Record<MenuTab, string> = {
  status: 'wardrive_page_tab_status',
  settings: 'wardrive_page_tab_settings',
  drives: 'wardrive_page_tab_drives',
  reports: 'wardrive_page_tab_reports',
  about: 'wardrive_page_tab_about',
};

export interface MenuSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  tab: MenuTab;
  onTab(tab: MenuTab): void;
  status: ReactNode;
  settings: ReactNode;
  drives: ReactNode;
  reports: ReactNode;
  about: ReactNode;
}

export function MenuSheet({
  open,
  onOpenChange,
  tab,
  onTab,
  status,
  settings,
  drives,
  reports,
  about,
}: MenuSheetProps) {
  const t = useT();
  const body: Record<MenuTab, ReactNode> = { status, settings, drives, reports, about };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        style={SIDE_SHEET_STYLE}
      >
        <SheetTitle className="sr-only">{t('wardrive_page_menu')}</SheetTitle>
        <Tabs value={tab} onValueChange={(v) => onTab(v as MenuTab)}>
          {/* The close button sits in the top right corner: the tabs end before it. */}
          <TabsList className="mb-3 mr-10 flex h-auto flex-wrap">
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id} className="flex-1 px-1 text-xs sm:px-3 sm:text-sm">
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
