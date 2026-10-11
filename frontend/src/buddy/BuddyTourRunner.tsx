import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import type { SettingsSection } from '../components/settings/settingsConstants';
import { useT } from '../i18n';
import type { Channel, Conversation } from '../types';
import type { BuddyAgent } from './agents';
import { findAnchorElement } from './buddyAnchors';
import type { BuddyPage } from './buddyCatalog';
import { buddyFrameSize, buddySpot, gestureAnimationAt, glideTo, playBriefly } from './buddyMotion';
import {
  buddyTourStepIndex,
  endBuddyTour,
  moveBuddyTour,
  pauseBuddyTour,
  useBuddyTour,
} from './buddyTour';
import { placeBuddy, placePanel, type Box, type Size } from './buddyTourPlacement';
import {
  buddyTourSteps,
  buddyTourTextKey,
  buddyTourTitleKey,
  type BuddyTourStep,
} from './buddyTourSteps';

/** How long the buddy takes to travel to a stop. */
const TRAVEL_MS = 700;
const GESTURE_MAX_MS = 2000;
/** How often the target is looked up again (layout, scrolling and pages change under a stop). */
const TRACK_MS = 300;
/** A stop that opens a page waits this long for its target before it goes without one. */
const ANCHOR_WAIT_MS = 2500;
/** The ring is drawn this far outside the target. */
const RING_PAD_PX = 4;
/** A target that moved less than this is the same target. */
const SAME_SPOT_PX = 4;
/** Used until the panel has been measured. */
const PANEL_SIZE_GUESS: Size = { width: 320, height: 190 };

export interface BuddyTourRunnerProps {
  agent: BuddyAgent;
  /** The buddy is only here for the tour and is removed when it stops. */
  summoned: boolean;
  channels: Channel[];
  activePage: BuddyPage | null;
  zIndex: string;
  onSelectConversation: (conversation: Conversation) => void;
  onOpenSettings: (section: SettingsSection) => void;
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The bar or panel an element is part of: the buddy stands outside it. */
const SURROUNDINGS = 'nav, header, aside, form, [role="dialog"]';

/** The part of a box that is on screen. */
function visiblePart(rect: DOMRect): Box {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

interface TourTarget {
  el: Element;
  box: Box;
  /** The bar or panel around it, or null. */
  around: Box | null;
}

/**
 * The first of a stop's anchors that is on screen. `reveal` is called for one
 * that is rendered but scrolled out of view (a row far down the sidebar), so
 * the caller can bring it in.
 */
function findTarget(step: BuddyTourStep, reveal: (el: Element) => void): TourTarget | null {
  for (const anchor of step.anchors) {
    const rendered = findAnchorElement(anchor, true);
    if (!rendered) continue;
    reveal(rendered.el);
    const found = findAnchorElement(anchor);
    if (!found) continue;
    const surroundings = found.el.closest(SURROUNDINGS);
    return {
      el: found.el,
      box: visiblePart(found.rect),
      around: surroundings ? visiblePart(surroundings.getBoundingClientRect()) : null,
    };
  }
  return null;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < SAME_SPOT_PX &&
    Math.abs(a.top - b.top) < SAME_SPOT_PX &&
    Math.abs(a.width - b.width) < SAME_SPOT_PX &&
    Math.abs(a.height - b.height) < SAME_SPOT_PX
  );
}

/**
 * The guided walkthrough while it runs. For each stop it opens the stop's
 * page, sends the buddy next to what the stop is about, rings that element and
 * shows the text with the controls in a panel beside the buddy.
 *
 * Nothing here blocks the page: there is no backdrop and no focus trap, the
 * ring takes no pointer events, and the app stays usable while the tour is on.
 * A stop only navigates; it never types, opens a composer or sends anything.
 */
export function BuddyTourRunner({
  agent,
  summoned,
  channels,
  activePage,
  zIndex,
  onSelectConversation,
  onOpenSettings,
}: BuddyTourRunnerProps) {
  const t = useT();
  const { stepId } = useBuddyTour();
  const hasChannel = channels.length > 0;
  const steps = useMemo(() => buddyTourSteps(hasChannel), [hasChannel]);
  const index = buddyTourStepIndex(steps, stepId);
  const step = steps[index];

  // Where the buddy was when the tour started; it goes back there afterwards.
  const [home] = useState(() => buddySpot(agent));
  const [target, setTarget] = useState<Box | null>(null);
  const [buddyBox, setBuddyBox] = useState<Box>(() => ({
    left: home?.x ?? 0,
    top: home?.y ?? 0,
    ...buddyFrameSize(agent),
  }));
  const [viewport, setViewport] = useState(viewportSize);
  const [panelSize, setPanelSize] = useState(PANEL_SIZE_GUESS);
  const panelRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const live = useRef({ t, channels, activePage, onSelectConversation, onOpenSettings });
  useEffect(() => {
    live.current = { t, channels, activePage, onSelectConversation, onOpenSettings };
  });

  // The buddy returns to where it stood. A summoned buddy is simply removed.
  useEffect(() => {
    try {
      agent._balloon.hide(true);
    } catch {
      // No balloon to clear.
    }
    return () => {
      if (summoned || !home || !agent._el.isConnected) return;
      glideTo(agent, home.x, home.y, prefersReducedMotion() ? 0 : TRAVEL_MS);
    };
  }, [agent, home, summoned]);

  // Starting or resuming was a click elsewhere: put the keyboard on "Next".
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  // Open the stop's page.
  useEffect(() => {
    const now = live.current;
    switch (step.page) {
      case 'channel': {
        // A channel chat that is already open will do.
        const channel = now.channels[0];
        if (channel && now.activePage !== 'channel') {
          now.onSelectConversation({ type: 'channel', id: channel.key, name: channel.name });
        }
        break;
      }
      case 'map':
        now.onSelectConversation({ type: 'map', id: 'map', name: now.t('nav_node_map') });
        break;
      case 'node':
        now.onSelectConversation({ type: 'node', id: 'node', name: now.t('nav_my_node') });
        break;
      case 'manual':
        now.onSelectConversation({ type: 'manual', id: 'manual', name: now.t('nav_user_guide') });
        break;
      case 'settings':
        now.onOpenSettings('local');
        break;
    }
  }, [step]);

  // Follow the stop's target and keep the buddy next to it.
  useEffect(() => {
    const el = agent._el;
    const startedAt = Date.now();
    let current: Box | null | undefined;
    let currentViewport = viewportSize();
    let scrolledTo: Element | null = null;
    // Once the user drags the buddy it stays where they put it for this stop.
    let dragged = false;
    let cancelGlide = () => {};
    let cancelGesture = () => {};

    // Scrolled into view once per stop: after that the user's scrolling wins.
    const reveal = (target: Element) => {
      if (target === scrolledTo) return;
      scrolledTo = target;
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    const track = () => {
      const found = findTarget(step, reveal);
      // The page this stop opened may still be loading.
      if (!found && step.anchors.length > 0 && Date.now() - startedAt < ANCHOR_WAIT_MS) return;
      const box = found?.box ?? null;
      const size = viewportSize();
      const resized =
        size.width !== currentViewport.width || size.height !== currentViewport.height;
      if (current !== undefined && sameBox(current, box) && !resized) return;
      current = box;
      currentViewport = size;
      setTarget(box);
      setViewport(size);
      if (dragged) return;

      const frame = buddyFrameSize(agent);
      const spot = box
        ? placeBuddy(box, frame, size, found?.around ?? null)
        : (home ?? buddySpot(agent));
      if (!spot) return;
      cancelGlide();
      cancelGesture();
      setBuddyBox({ left: spot.x, top: spot.y, ...frame });
      cancelGlide = glideTo(agent, spot.x, spot.y, prefersReducedMotion() ? 0 : TRAVEL_MS, () => {
        if (!box) return;
        const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        cancelGesture = playBriefly(
          agent,
          gestureAnimationAt(agent, point),
          GESTURE_MAX_MS,
          () => {}
        );
      });
    };

    const onPress = () => {
      dragged = true;
      cancelGlide();
    };
    const onRelease = () => {
      if (!dragged) return;
      const rect = el.getBoundingClientRect();
      setBuddyBox({ left: rect.left, top: rect.top, ...buddyFrameSize(agent) });
    };

    track();
    const timer = window.setInterval(track, TRACK_MS);
    window.addEventListener('resize', track);
    el.addEventListener('mousedown', onPress);
    window.addEventListener('mouseup', onRelease);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', track);
      el.removeEventListener('mousedown', onPress);
      window.removeEventListener('mouseup', onRelease);
      cancelGlide();
      cancelGesture();
    };
  }, [agent, home, step]);

  // The panel's size follows the text of the stop, the language and a narrow screen.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { offsetWidth: width, offsetHeight: height } = panel;
    if (width <= 0 || height <= 0) return;
    setPanelSize((size) =>
      size.width === width && size.height === height ? size : { width, height }
    );
  }, [step, t, viewport.width]);

  const panelSpot = placePanel(buddyBox, panelSize, viewport, target);
  const last = index === steps.length - 1;

  return (
    <>
      {target && (
        <div
          aria-hidden="true"
          data-buddy-tour-ring={step.id}
          className="pointer-events-none fixed rounded-md border-2 border-primary ring-4 ring-primary/30 transition-[left,top,width,height] duration-300 motion-safe:animate-pulse motion-reduce:transition-none"
          style={{
            left: target.left - RING_PAD_PX,
            top: target.top - RING_PAD_PX,
            width: target.width + RING_PAD_PX * 2,
            height: target.height + RING_PAD_PX * 2,
            zIndex,
          }}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={t('buddy_tour_label')}
        data-buddy-tour={step.id}
        className="fixed w-72 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[left,top] duration-300 motion-reduce:transition-none sm:w-80"
        // A dialog opened by the user switches pointer events off on <body>;
        // Pause and End must keep working then.
        style={{ left: panelSpot.x, top: panelSpot.y, zIndex, pointerEvents: 'auto' }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            pauseBuddyTour();
          }
        }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="mr-auto min-w-0 break-words text-sm font-semibold">
            {t(buddyTourTitleKey(step))}
          </h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {t('buddy_tour_progress', { current: index + 1, total: steps.length })}
          </span>
        </div>
        <p aria-live="polite" className="mt-1 text-sm leading-relaxed">
          {t(buddyTourTextKey(step))}
        </p>
        {/* Two groups that wrap as a whole: the long Dutch and German labels do not fit one row on a phone. */}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          <div className="mr-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              title={t('buddy_tour_pause_title')}
              onClick={pauseBuddyTour}
            >
              {t('buddy_tour_pause')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              title={t('buddy_tour_end_title')}
              onClick={endBuddyTour}
            >
              {t('buddy_tour_end')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={index === 0}
              onClick={() => moveBuddyTour(steps, -1)}
            >
              {t('common_back')}
            </Button>
            <Button
              ref={nextRef}
              type="button"
              size="sm"
              className="h-8"
              onClick={() => moveBuddyTour(steps, 1)}
            >
              {t(last ? 'buddy_tour_finish' : 'buddy_tour_next')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
