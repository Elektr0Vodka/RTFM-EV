// The slim bar over the map: the target chip and the filters pill on the
// left, the live-log button (while the log is hidden), full screen (where the
// browser has it) and the menu button with the status dots on the right.
import { Activity, Crosshair, Maximize, Menu, Minimize, SlidersHorizontal } from 'lucide-react';

import type { FullscreenState } from '../useFullscreen';

import { useT } from '../../i18n';
import { StatusDots, type Dots } from './StatusDots';

const ROUND =
  'flex h-11 items-center gap-2 rounded-full border border-border bg-card/90 px-3 shadow-md backdrop-blur';

export interface TopBarProps {
  dots: Dots;
  /** "All senders", the one target's name, or "N targets". */
  targetLabel: string;
  onTargets(): void;
  /** Filters narrowing the view (the pill's badge). */
  filterCount: number;
  onFilters(): void;
  logHidden: boolean;
  onShowLog(): void;
  onMenu(): void;
  fullscreen?: FullscreenState;
  onFullscreen?(): void;
}

export function TopBar({
  dots,
  targetLabel,
  onTargets,
  filterCount,
  onFilters,
  logHidden,
  onShowLog,
  onMenu,
  fullscreen = 'unsupported',
  onFullscreen,
}: TopBarProps) {
  const t = useT();
  return (
    <header className="flex items-center gap-2">
      <button
        type="button"
        className={`${ROUND} min-w-0 max-w-[45%]`}
        aria-label={t('wardrive_page_targets_chip', { label: targetLabel })}
        onClick={onTargets}
      >
        <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm">{targetLabel}</span>
      </button>
      <button type="button" className={ROUND} onClick={onFilters}>
        <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-sm">{t('wardrive_page_filters')}</span>
        {filterCount > 0 && (
          <span
            className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
            data-testid="wardrive-filter-count"
          >
            {filterCount}
          </span>
        )}
      </button>
      <div className="ml-auto flex items-center gap-2">
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
        {fullscreen !== 'unsupported' && onFullscreen && (
          <button
            type="button"
            className={ROUND}
            aria-label={
              fullscreen === 'on'
                ? t('wardrive_page_fullscreen_leave')
                : t('wardrive_page_fullscreen')
            }
            onClick={onFullscreen}
          >
            {fullscreen === 'on' ? (
              <Minimize className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Maximize className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}
        <button
          type="button"
          className={ROUND}
          aria-label={t('wardrive_page_menu')}
          onClick={onMenu}
        >
          <StatusDots dots={dots} />
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
