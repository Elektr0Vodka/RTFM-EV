// The wardrive screen's layout: the map fills the screen; over it the top bar
// and banners at the top, the live log as its own block under them (it scrolls
// and moves on its own, the top bar stays put), the button rail at the right
// above the HUD, the HUD at the bottom. Everything stays inside the safe areas
// (notch, home bar). The start screen, the menu and the target and filter
// sheets lie on top when open.
import { useEffect, useRef, type ReactNode } from 'react';

import type { MapInsets } from '../map/compassMode';

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
  /** What the top bar and the HUD cover, in px (the map keeps the followed
   * position clear of them). */
  onInsets?: (insets: MapInsets) => void;
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
  onInsets,
}: WardriveScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const onInsetsRef = useRef(onInsets);
  onInsetsRef.current = onInsets;

  // Measured heights: the HUD (the map's bottom controls sit on it), the
  // whole bottom block, rail included, and the top stack (the log starts
  // under it and stays clear of the bottom block).
  useEffect(() => {
    const root = rootRef.current;
    const hud = hudRef.current;
    const bottom = bottomRef.current;
    const bar = barRef.current;
    const top = topRef.current;
    if (!root || !hud || !bottom || !bar || !top || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--wd-hud-h', `${hud.offsetHeight}px`);
      root.style.setProperty('--wd-bottom-h', `${bottom.offsetHeight}px`);
      root.style.setProperty('--wd-top-h', `${top.offsetTop + top.offsetHeight}px`);
      const insets = { top: bar.offsetTop + bar.offsetHeight, bottom: hud.offsetHeight };
      const key = `${insets.top}:${insets.bottom}`;
      if (key !== last) {
        last = key;
        onInsetsRef.current?.(insets);
      }
    });
    ro.observe(hud);
    ro.observe(bottom);
    ro.observe(bar);
    ro.observe(top);
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
        <div
          ref={topRef}
          className="wd-top-stack flex w-full flex-col items-center gap-2"
          data-region="top"
        >
          {/* Only the bars and cards take touches; the map stays draggable around them. */}
          <div ref={barRef} className="pointer-events-auto w-full" data-region="topbar">
            {topBar}
          </div>
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2">
            {banners}
          </div>
        </div>
      </div>
      {/* The live log: its own block under the top stack, so it scrolls (and
          moves) without taking the top bar along. */}
      <div
        className="wd-log pointer-events-none absolute inset-x-0 z-10 flex justify-center"
        data-region="log"
        style={{
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        {log}
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
