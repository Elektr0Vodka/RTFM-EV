// The slim bar over the map: the live-log button (while the log is hidden) and
// the menu button with the status dots.
import { Activity, Menu } from 'lucide-react';

import { useT } from '../../i18n';
import { StatusDots, type Dots } from './StatusDots';

const ROUND =
  'flex h-11 items-center gap-2 rounded-full border border-border bg-card/90 px-3 shadow-md backdrop-blur';

export interface TopBarProps {
  dots: Dots;
  logHidden: boolean;
  onShowLog(): void;
  onMenu(): void;
}

export function TopBar({ dots, logHidden, onShowLog, onMenu }: TopBarProps) {
  const t = useT();
  return (
    <header className="flex items-center justify-end gap-2">
      {logHidden && (
        <button
          type="button"
          className={ROUND}
          aria-label={t('wardrive_page_show_log')}
          onClick={onShowLog}
        >
          <Activity className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <button type="button" className={ROUND} aria-label={t('wardrive_page_menu')} onClick={onMenu}>
        <StatusDots dots={dots} />
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
}
