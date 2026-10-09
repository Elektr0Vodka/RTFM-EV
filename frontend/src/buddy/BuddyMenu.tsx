import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { formatDateTime } from '../utils/dateTimeFormat';
import type { BuddyTarget } from './buddyCatalog';
import { getBuddyHistory } from './buddyHistory';
import { getBuddyMute, muteBuddyFor, muteBuddyUntilReload, unmuteBuddy } from './buddyPrefs';

export type BuddyMenuView = 'menu' | 'recap';

export interface BuddyMenuProps {
  /** The buddy on screen; the menu is placed next to it. */
  anchor: HTMLElement;
  initialView: BuddyMenuView;
  /** Manual section for the page on screen, or null when it has none. */
  helpTarget: BuddyTarget | null;
  zIndex: string;
  onOpenTarget: (target: BuddyTarget) => void;
  onHide: () => void;
  onClose: () => void;
}

const MUTE_15_MINUTES_MS = 15 * 60 * 1000;
const MUTE_1_HOUR_MS = 60 * 60 * 1000;
/** Gap between the buddy and the menu, and between the menu and the screen edge. */
const GAP_PX = 8;
/** Below this much room above the buddy the menu opens under it. */
const MIN_ROOM_ABOVE_PX = 280;

const ITEM_CLASS =
  'w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Above the buddy when there is room, else below it; right edges aligned. */
function placeBy(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const right = Math.max(GAP_PX, window.innerWidth - rect.right);
  return rect.top >= MIN_ROOM_ABOVE_PX
    ? { right, bottom: window.innerHeight - rect.top + GAP_PX }
    : { right, top: rect.bottom + GAP_PX };
}

/**
 * What a single click on the desktop buddy opens: a recap of what it said or
 * kept back, help for the page on screen, the mute, and the way to another
 * buddy or to none. Nothing here sends anything; every item navigates or
 * changes a browser-local setting.
 */
export function BuddyMenu({
  anchor,
  initialView,
  helpTarget,
  zIndex,
  onOpenTarget,
  onHide,
  onClose,
}: BuddyMenuProps) {
  const t = useT();
  const [view, setView] = useState<BuddyMenuView>(initialView);
  // Snapshots of the moment the menu opened: it closes as soon as the buddy speaks.
  const [entries] = useState(() => [...getBuddyHistory()].reverse());
  const [muted] = useState(() => getBuddyMute() !== null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // A press on the buddy itself is its own business (drag, or close and reopen).
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || anchor.contains(target))) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [anchor, onClose]);

  // Keyboard focus lands in the menu, so Escape and Tab work from the start.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [view]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={t('buddy_menu_label')}
      data-buddy-menu={view}
      className="fixed w-64 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ ...placeBy(anchor), zIndex }}
    >
      {view === 'menu' ? (
        <>
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            onClick={() => setView('recap')}
          >
            {t('buddy_menu_recap')}
          </button>
          {helpTarget && (
            <button
              type="button"
              role="menuitem"
              className={ITEM_CLASS}
              onClick={run(() => onOpenTarget(helpTarget))}
            >
              {t('buddy_menu_help')}
            </button>
          )}
          {muted ? (
            <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(unmuteBuddy)}>
              {t('buddy_menu_unmute')}
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className={ITEM_CLASS}
                onClick={run(() => muteBuddyFor(MUTE_15_MINUTES_MS))}
              >
                {t('buddy_menu_mute_15m')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={ITEM_CLASS}
                onClick={run(() => muteBuddyFor(MUTE_1_HOUR_MS))}
              >
                {t('buddy_menu_mute_1h')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={ITEM_CLASS}
                onClick={run(muteBuddyUntilReload)}
              >
                {t('buddy_menu_mute_reload')}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={ITEM_CLASS}
            onClick={run(() => onOpenTarget({ kind: 'settings', section: 'local' }))}
          >
            {t('buddy_menu_switch')}
          </button>
          <button type="button" role="menuitem" className={ITEM_CLASS} onClick={run(onHide)}>
            {t('buddy_menu_hide')}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border px-1 pb-1 mb-1">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setView('menu')}
            >
              {t('common_back')}
            </button>
            <span className="text-sm font-medium">{t('buddy_recap_title')}</span>
          </div>
          {entries.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('buddy_recap_empty')}</p>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((entry, index) => {
                const target = entry.target;
                const body = (
                  <>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {formatDateTime(entry.at, { hour: '2-digit', minute: '2-digit' })}
                      {!entry.shown && ` · ${t('buddy_recap_kept_back')}`}
                    </span>
                    <span className="block">{entry.text}</span>
                  </>
                );
                return (
                  <li key={`${entry.at}-${index}`} data-testid="buddy-recap-entry">
                    {target && target.kind !== 'recap' ? (
                      <button
                        type="button"
                        className={ITEM_CLASS}
                        onClick={run(() => onOpenTarget(target))}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="px-2 py-1.5 text-sm">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
