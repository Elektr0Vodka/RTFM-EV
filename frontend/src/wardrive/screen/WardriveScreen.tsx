// The wardrive screen's layout: the map fills the screen; over it the top bar,
// banners and live log at the top, the button rail at the right above the HUD,
// the HUD at the bottom. Everything stays inside the safe areas (notch, home
// bar). The start screen, the menu and the target and filter sheets lie on
// top when open.
import { useEffect, useRef, type ReactNode } from 'react';

import './screen.css';

export interface WardriveScreenProps {
  map: ReactNode;
  topBar: ReactNode;
  banners: ReactNode;
  log: ReactNode;
  hud: ReactNode;
  rail: ReactNode;
  start: ReactNode | null;
  menu: ReactNode;
  /** The target and filter sheets (portals, like the menu). */
  sheets?: ReactNode;
}

export function WardriveScreen({
  map,
  topBar,
  banners,
  log,
  hud,
  rail,
  start,
  menu,
  sheets = null,
}: WardriveScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Measured heights: the HUD (the map's bottom controls sit on it) and the
  // whole bottom block, rail included (the top stack stays clear of it).
  useEffect(() => {
    const root = rootRef.current;
    const hud = hudRef.current;
    const bottom = bottomRef.current;
    if (!root || !hud || !bottom || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--wd-hud-h', `${hud.offsetHeight}px`);
      root.style.setProperty('--wd-bottom-h', `${bottom.offsetHeight}px`);
    });
    ro.observe(hud);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="wd-screen relative h-[100dvh] w-full overflow-hidden bg-background text-foreground"
    >
      <div className="absolute inset-0" data-region="map">
        {map}
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 z-10 top-0 flex flex-col items-center gap-2"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        <div className="wd-top-stack flex w-full flex-col items-center gap-2" data-region="top">
          {/* Only the bars and cards take touches; the map stays draggable around them. */}
          <div className="pointer-events-auto w-full">{topBar}</div>
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
            {banners}
            {log}
          </div>
        </div>
      </div>
      <div
        ref={bottomRef}
        data-region="bottom"
        className="pointer-events-none absolute inset-x-0 z-10 bottom-0 flex flex-col items-stretch"
        style={{
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <div className="wd-rail pointer-events-auto mb-2 mr-3 self-end" data-region="rail">
          {rail}
        </div>
        <div
          ref={hudRef}
          className="pointer-events-auto mx-auto w-full max-w-xl"
          data-region="hud"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {hud}
        </div>
      </div>
      {start}
      {menu}
      {sheets}
    </div>
  );
}
