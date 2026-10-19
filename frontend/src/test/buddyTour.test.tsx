import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Channel, Contact, HealthStatus } from '../types';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import de from '../i18n/locales/de.json';

const loadBuddyAgentMock = vi.fn();
vi.mock('../buddy/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../buddy/agents')>()),
  loadBuddyAgent: (...args: unknown[]) => loadBuddyAgentMock(...args),
}));

const apiMock = vi.hoisted(() => ({
  getLatestTelemetry: vi.fn(),
  snmpNodes: vi.fn(),
  getOpenHopStatus: vi.fn(),
  getOpenHopUpdateStatus: vi.fn(),
}));
vi.mock('../api', () => ({ api: apiMock }));

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

import { BuddyHost, __resetBuddySessionState } from '../buddy/BuddyHost';
import { BUDDY_ANCHOR_ATTR, BUDDY_ANCHORS } from '../buddy/buddyAnchors';
import { emitBuddyEvent } from '../buddy/buddyEvents';
import { clearBuddyHistory, getBuddyHistory } from '../buddy/buddyHistory';
import { getBuddyPosition, setBuddyAgent, __resetBuddyMuteForTests } from '../buddy/buddyPrefs';
import {
  buddyTourStepIndex,
  declineBuddyTourOffer,
  endBuddyTour,
  getBuddyTourState,
  moveBuddyTour,
  pauseBuddyTour,
  resumeBuddyTour,
  snoozeBuddyTourOffer,
  startBuddyTour,
  __resetBuddyTourForTests,
} from '../buddy/buddyTour';
import { BUDDY_TOUR_KEY, markBuddyTourInstall } from '../buddy/buddyTourBoot';
import { boxesOverlap, placeBuddy, placePanel, type Box } from '../buddy/buddyTourPlacement';
import {
  BUDDY_TOUR_STEPS,
  buddyTourSteps,
  buddyTourTextKey,
  buddyTourTitleKey,
} from '../buddy/buddyTourSteps';
import { ManualView } from '../components/ManualView';
import { applyTheme } from '../utils/theme';

const ALICE_KEY = 'a1'.repeat(32);
const ALL_STEPS = buddyTourSteps(true);

function channel(key: string, name: string): Channel {
  return { key, name } as Channel;
}

/**
 * Minimal stand-in for a clippyjs Agent: queued functions and animations
 * finish at once, unless the queue is held (then they wait, and `stop()`
 * throws them away like the library does).
 */
function makeFakeAgent() {
  const el = document.createElement('div');
  const balloonEl = document.createElement('div');
  document.body.append(el, balloonEl);
  const spoken: string[] = [];
  const played: string[] = [];
  const queue = { held: false, waiting: 0 };
  const agent = {
    _el: el,
    _animator: {
      _data: { framesize: [124, 93] },
      exitAnimation: vi.fn(),
      currentAnimationName: undefined as string | undefined,
    },
    _balloon: {
      _balloon: balloonEl,
      CLOSE_BALLOON_DELAY: 2000,
      hide: vi.fn(),
      speak: vi.fn((complete: () => void, text: string) => {
        spoken.push(text);
        complete();
      }),
    },
    hasAnimation: (name: string) => name.startsWith('Gesture'),
    _playInternal: vi.fn((name: string, callback: (name: string, state: number) => void) => {
      played.push(name);
      agent._animator.currentAnimationName = name;
      callback(name, 0);
    }),
    _getDirection: vi.fn(() => 'Left'),
    _addToQueue: vi.fn((fn: (complete: () => void) => void) => {
      if (queue.held) queue.waiting += 1;
      else fn(() => {});
    }),
    _onQueueEmpty: vi.fn(),
    stop: vi.fn(() => {
      queue.held = false;
      queue.waiting = 0;
    }),
    show: vi.fn(),
    hide: vi.fn((_fast: boolean, cb?: () => void) => cb?.()),
    reposition: vi.fn(),
    animate: vi.fn(),
    dispose: vi.fn(() => {
      el.remove();
      balloonEl.remove();
    }),
  };
  return { agent, spoken, played, queue, el, balloonEl };
}

/** Puts an element a stop can point at on screen. */
function addAnchor(anchor: string, box: Box): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(BUDDY_ANCHOR_ATTR, anchor);
  el.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }) as DOMRect;
  document.body.append(el);
  return el;
}

function hostProps(overrides: Partial<Parameters<typeof BuddyHost>[0]> = {}) {
  return {
    health: null as HealthStatus | null,
    contacts: [{ public_key: ALICE_KEY, name: 'Alice', last_advert: 1 } as Contact],
    channels: [channel('c1'.repeat(16), 'Public')],
    activePage: null,
    onSelectConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onNavigateMentionToMessage: vi.fn(),
    ...overrides,
  };
}

function panel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Guided walkthrough' });
}

/**
 * The panel is on screen and its effects have run. The buddy loads outside
 * act(), so React can commit the panel before running its effects (the tour
 * subscription, opening the stop's page); a test that moves the tour then
 * would move it unseen. The panel focuses "Next" in one of those effects.
 */
async function waitForPanel(): Promise<void> {
  await waitFor(() => expect(panel().contains(document.activeElement)).toBe(true));
}

function stored(): { status: string; step?: string } | null {
  return JSON.parse(localStorage.getItem(BUDDY_TOUR_KEY) ?? 'null');
}

/** A reload: what is kept in memory is gone, what is stored stays. */
function reload() {
  __resetBuddyTourForTests();
}

/** The first load of the app in a browser that holds `data` (nothing: a fresh install). */
function firstLoad(data: Record<string, string> = {}) {
  localStorage.clear();
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
  markBuddyTourInstall(localStorage);
  reload();
}

beforeEach(() => {
  localStorage.clear();
  applyTheme('original');
  __resetBuddyTourForTests();
  __resetBuddySessionState();
  __resetBuddyMuteForTests();
  clearBuddyHistory();
  loadBuddyAgentMock.mockReset();
  apiMock.getLatestTelemetry.mockReset().mockResolvedValue({});
  apiMock.snmpNodes.mockReset().mockResolvedValue([]);
  apiMock.getOpenHopStatus.mockReset().mockResolvedValue({ configured: false });
  apiMock.getOpenHopUpdateStatus.mockReset();
  useUpdateStatusMock.mockReset().mockReturnValue({ status: null });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
  __resetBuddyTourForTests();
});

describe('fresh-install check', () => {
  it('offers the walkthrough to a browser without app data', () => {
    firstLoad();
    expect(stored()).toEqual({ status: 'offer' });
    expect(getBuddyTourState()).toEqual({ phase: 'offer', stepId: null });
  });

  it('treats a browser that already holds app data as an existing user', () => {
    firstLoad({ 'remoteterm-theme': 'light' });
    expect(stored()).toEqual({ status: 'existing' });
    expect(getBuddyTourState().phase).toBe('idle');
  });

  it('does not count the login redirect note as app data', () => {
    firstLoad({ 'remoteterm-auth-redirect-url': '/#map' });
    expect(stored()).toEqual({ status: 'offer' });
  });

  it('decides only once', () => {
    firstLoad();
    localStorage.setItem('remoteterm-theme', 'light');
    markBuddyTourInstall(localStorage);
    expect(stored()).toEqual({ status: 'offer' });
  });
});

describe('walkthrough state', () => {
  it('starts at the first stop and steps forward and back', () => {
    startBuddyTour();
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'welcome' });
    moveBuddyTour(ALL_STEPS, -1);
    expect(getBuddyTourState().stepId).toBe('welcome');
    moveBuddyTour(ALL_STEPS, 1);
    moveBuddyTour(ALL_STEPS, 1);
    expect(getBuddyTourState().stepId).toBe('sidebar');
    moveBuddyTour(ALL_STEPS, -1);
    expect(getBuddyTourState().stepId).toBe('radio');
  });

  it('keeps the stop when paused and resumes there', () => {
    startBuddyTour();
    moveBuddyTour(ALL_STEPS, 1);
    pauseBuddyTour();
    expect(getBuddyTourState()).toEqual({ phase: 'paused', stepId: 'radio' });
    resumeBuddyTour();
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'radio' });
  });

  it('comes back paused, not running, after a reload during a tour', () => {
    startBuddyTour();
    moveBuddyTour(ALL_STEPS, 1);
    moveBuddyTour(ALL_STEPS, 1);
    reload();
    expect(getBuddyTourState()).toEqual({ phase: 'paused', stepId: 'sidebar' });
  });

  it('ends when stepping past the last stop, and stays ended after a reload', () => {
    startBuddyTour();
    for (let i = 0; i < ALL_STEPS.length; i += 1) moveBuddyTour(ALL_STEPS, 1);
    expect(getBuddyTourState()).toEqual({ phase: 'idle', stepId: null });
    expect(stored()).toEqual({ status: 'done' });
    reload();
    expect(getBuddyTourState().phase).toBe('idle');
  });

  it('ends on request and can be started again', () => {
    startBuddyTour();
    endBuddyTour();
    expect(getBuddyTourState().phase).toBe('idle');
    startBuddyTour();
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'welcome' });
  });

  it('asks again on the next load after "Not now", and never after "Don\'t ask again"', () => {
    firstLoad();
    snoozeBuddyTourOffer();
    expect(getBuddyTourState().phase).toBe('idle');
    reload();
    expect(getBuddyTourState().phase).toBe('offer');

    declineBuddyTourOffer();
    expect(getBuddyTourState().phase).toBe('idle');
    reload();
    expect(getBuddyTourState().phase).toBe('idle');
  });

  it('ignores a stored stop that no longer exists', () => {
    localStorage.setItem(BUDDY_TOUR_KEY, JSON.stringify({ status: 'paused', step: 'gone' }));
    expect(getBuddyTourState()).toEqual({ phase: 'paused', stepId: 'welcome' });
  });
});

describe('walkthrough stops', () => {
  it('has a title and a text for every stop in every language', () => {
    for (const catalog of [en, nl, de] as Record<string, unknown>[]) {
      for (const step of BUDDY_TOUR_STEPS) {
        expect(catalog[buddyTourTitleKey(step)], buddyTourTitleKey(step)).toEqual(
          expect.any(String)
        );
        expect(catalog[buddyTourTextKey(step)], buddyTourTextKey(step)).toEqual(expect.any(String));
      }
    }
  });

  it('leaves the chat stops out when there is no channel to open', () => {
    const ids = buddyTourSteps(false).map((step) => step.id);
    expect(ids).not.toContain('chat');
    expect(ids).not.toContain('chat_header');
    expect(ids).toHaveLength(BUDDY_TOUR_STEPS.length - 2);
    expect(buddyTourSteps(true)).toHaveLength(BUDDY_TOUR_STEPS.length);
  });

  it('carries on from the stop before one that fell out of the run', () => {
    const withoutChat = buddyTourSteps(false);
    const index = buddyTourStepIndex(withoutChat, 'chat_header');
    expect(withoutChat[index].id).toBe('conversations');
    expect(withoutChat[index + 1].id).toBe('map');
  });
});

describe('placement', () => {
  const viewport = { width: 1280, height: 800 };
  const buddy = { width: 124, height: 93 };
  const panelSize = { width: 320, height: 190 };
  const onScreen = (box: Box) =>
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + box.width <= viewport.width &&
    box.top + box.height <= viewport.height;

  const targets: Record<string, Box> = {
    sidebar: { left: 0, top: 90, width: 240, height: 700 },
    'top bar item': { left: 1000, top: 8, width: 120, height: 24 },
    composer: { left: 240, top: 740, width: 1040, height: 60 },
    'chat header': { left: 240, top: 40, width: 1040, height: 50 },
    'map buttons': { left: 252, top: 52, width: 44, height: 420 },
    'bottom tab': { left: 960, top: 740, width: 300, height: 56 },
  };

  it.each(Object.entries(targets))('puts the buddy beside the %s, not on it', (_name, target) => {
    const spot = placeBuddy(target, buddy, viewport);
    const box = { left: spot.x, top: spot.y, ...buddy };
    expect(onScreen(box)).toBe(true);
    expect(boxesOverlap(box, target)).toBe(false);
  });

  it('stands to the right of the sidebar, under a top bar and over the composer', () => {
    expect(placeBuddy(targets.sidebar, buddy, viewport).x).toBeGreaterThanOrEqual(240);
    expect(placeBuddy(targets['top bar item'], buddy, viewport).y).toBeGreaterThanOrEqual(32);
    expect(placeBuddy(targets.composer, buddy, viewport).y + buddy.height).toBeLessThanOrEqual(740);
  });

  it.each(Object.entries(targets))(
    'keeps the panel on screen and off the %s and the buddy',
    (_name, target) => {
      const spot = placeBuddy(target, buddy, viewport);
      const buddyBox = { left: spot.x, top: spot.y, ...buddy };
      const at = placePanel(buddyBox, panelSize, viewport, target);
      const box = { left: at.x, top: at.y, ...panelSize };
      expect(onScreen(box)).toBe(true);
      expect(boxesOverlap(box, target)).toBe(false);
      expect(boxesOverlap(box, buddyBox)).toBe(false);
    }
  );

  it('stands outside the bar or panel the target is part of', () => {
    // The row at the top of the sidebar: under it would cover the search box.
    const sidebar = { left: 0, top: 44, width: 240, height: 756 };
    const head = { left: 0, top: 51, width: 239, height: 49 };
    const beside = placeBuddy(head, buddy, viewport, sidebar);
    expect(boxesOverlap({ left: beside.x, top: beside.y, ...buddy }, sidebar)).toBe(false);
    expect(placeBuddy(head, buddy, viewport).x).toBeLessThan(240);

    // An item in the top bar: next to it would cover the rest of the bar.
    const bar = { left: 0, top: 0, width: 1280, height: 44 };
    const under = placeBuddy(targets['top bar item'], buddy, viewport, bar);
    expect(under.y).toBeGreaterThanOrEqual(44);
  });

  it('slides the panel along the buddy to get past a target on a narrow screen', () => {
    // Map buttons down the left edge of a phone, the buddy right next to them.
    const phone = { width: 444, height: 962 };
    const buttons = { left: 12, top: 126, width: 44, height: 476 };
    const size = { width: 320, height: 170 };
    const spot = placeBuddy(buttons, buddy, phone);
    const buddyBox = { left: spot.x, top: spot.y, ...buddy };
    const at = placePanel(buddyBox, size, phone, buttons);
    const box = { left: at.x, top: at.y, ...size };
    expect(boxesOverlap(box, buttons)).toBe(false);
    expect(boxesOverlap(box, buddyBox)).toBe(false);
    expect(box.left + box.width).toBeLessThanOrEqual(phone.width);
  });

  it('fits the panel next to a buddy in the corner on a phone', () => {
    const phone = { width: 375, height: 812 };
    const buddyBox = { left: 211, top: 569, ...buddy };
    const size = { width: 320, height: 220 };
    const at = placePanel(buddyBox, size, phone, null);
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x + size.width).toBeLessThanOrEqual(phone.width);
    expect(boxesOverlap({ left: at.x, top: at.y, ...size }, buddyBox)).toBe(false);
  });
});

describe('BuddyHost with the walkthrough', () => {
  it('offers the walkthrough on a fresh install without loading a buddy', async () => {
    firstLoad();
    render(<BuddyHost {...hostProps()} />);
    const offer = screen.getByRole('dialog', { name: 'New here?' });
    expect(within(offer).getByRole('button', { name: 'Start walkthrough' })).toBeInTheDocument();
    await act(async () => {});
    expect(loadBuddyAgentMock).not.toHaveBeenCalled();

    fireEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored()).toEqual({ status: 'offer' });
  });

  it('stops asking after "Don\'t ask again"', () => {
    firstLoad();
    render(<BuddyHost {...hostProps()} />);
    fireEvent.click(screen.getByRole('button', { name: "Don't ask again" }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored()).toEqual({ status: 'declined' });
  });

  it('does not offer it to an existing user', () => {
    firstLoad({ 'remoteterm-theme': 'light' });
    render(<BuddyHost {...hostProps()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('summons Clippy for the tour only, without touching the preference', async () => {
    firstLoad();
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start walkthrough' }));

    await waitForPanel();
    expect(loadBuddyAgentMock).toHaveBeenCalledWith('clippy');
    expect(within(panel()).getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(within(panel()).getByText('Step 1 of 12')).toBeInTheDocument();
    expect(localStorage.getItem('rtfm-buddy-agent')).toBeNull();
    expect(localStorage.getItem('rtfm-buddy-discovered')).toBeNull();

    // A summoned buddy keeps to the tour: no polling, no lines.
    expect(apiMock.getLatestTelemetry).not.toHaveBeenCalled();
    expect(apiMock.snmpNodes).not.toHaveBeenCalled();
    act(() => emitBuddyEvent({ kind: 'dm', publicKey: ALICE_KEY, senderName: null }));
    expect(fake.spoken).toEqual([]);
    expect(getBuddyHistory()).toEqual([]);

    fireEvent.click(within(panel()).getByRole('button', { name: 'End' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.agent.dispose).toHaveBeenCalled();
    expect(stored()).toEqual({ status: 'done' });
  });

  it('opens the page of a stop, stands beside its target and rings it', async () => {
    vi.useFakeTimers();
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps();
    render(<BuddyHost {...props} />);
    act(() => startBuddyTour());
    await act(async () => {});

    const radio: Box = { left: 700, top: 8, width: 120, height: 24 };
    addAnchor(BUDDY_ANCHORS.radio, radio);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
    expect(within(panel()).getByRole('heading', { name: 'Radio status' })).toBeInTheDocument();
    expect(props.onSelectConversation).not.toHaveBeenCalled();

    const ring = document.querySelector<HTMLElement>('[data-buddy-tour-ring="radio"]');
    expect(ring).not.toBeNull();
    expect(ring?.style.left).toBe('696px');
    expect(ring?.style.width).toBe('128px');
    // Tailwind's CSS is not loaded here: the class is what keeps clicks going through.
    expect(ring?.classList.contains('pointer-events-none')).toBe(true);

    // Under the status bar, and pointing once it has arrived.
    const buddyBox = {
      left: parseFloat(fake.el.style.left),
      top: parseFloat(fake.el.style.top),
      width: 124,
      height: 93,
    };
    expect(buddyBox.top).toBeGreaterThanOrEqual(radio.top + radio.height);
    expect(boxesOverlap(buddyBox, radio)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(fake.played).toContain('GestureLeft');

    // Jump ahead to the map stop: it opens the Map page.
    act(() => {
      for (let i = 0; i < 5; i += 1) moveBuddyTour(ALL_STEPS, 1);
    });
    expect(within(panel()).getByRole('heading', { name: 'The map' })).toBeInTheDocument();
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'map',
      id: 'map',
      name: 'Node Map',
    });
  });

  it('opens a channel for the chat stop and Settings for the settings stop', async () => {
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps();
    render(<BuddyHost {...props} />);
    act(() => startBuddyTour());
    await waitForPanel();

    act(() => {
      for (let i = 0; i < 4; i += 1) moveBuddyTour(ALL_STEPS, 1);
    });
    expect(getBuddyTourState().stepId).toBe('chat');
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'channel',
      id: 'c1'.repeat(16),
      name: 'Public',
    });

    act(() => {
      for (let i = 0; i < 5; i += 1) moveBuddyTour(ALL_STEPS, 1);
    });
    expect(getBuddyTourState().stepId).toBe('settings');
    expect(props.onOpenSettings).toHaveBeenLastCalledWith('local');
  });

  it('counts fewer stops when there is no channel', async () => {
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps({ channels: [] })} />);
    act(() => startBuddyTour());
    await waitForPanel();
    expect(within(panel()).getByText('Step 1 of 10')).toBeInTheDocument();
  });

  it('shows only the text when nothing of a stop is on screen', async () => {
    vi.useFakeTimers();
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    act(() => startBuddyTour());
    await act(async () => {});
    const home = { left: fake.el.style.left, top: fake.el.style.top };

    fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(within(panel()).getByRole('heading', { name: 'Radio status' })).toBeInTheDocument();
    expect(document.querySelector('[data-buddy-tour-ring]')).toBeNull();
    expect({ left: fake.el.style.left, top: fake.el.style.top }).toEqual(home);
  });

  it('scrolls a target into view that is further down a list, and falls back to the next one', async () => {
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    act(() => startBuddyTour());
    await waitForPanel();

    // The User Guide row sits below the fold until it is scrolled to.
    const row = addAnchor('tool-manual', { left: 0, top: 1400, width: 239, height: 40 });
    row.scrollIntoView = vi.fn(() => {
      row.getBoundingClientRect = () =>
        ({ left: 0, top: 600, width: 239, height: 40, right: 239, bottom: 640 }) as DOMRect;
    });
    act(() => {
      for (let i = 0; i < ALL_STEPS.length - 1; i += 1) moveBuddyTour(ALL_STEPS, 1);
    });
    expect(getBuddyTourState().stepId).toBe('guide');
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('[data-buddy-tour-ring="guide"]')?.style.top).toBe(
      '596px'
    );

    // On a phone the row is not there; the More tab is.
    row.remove();
    addAnchor('tab-more', { left: 280, top: 700, width: 90, height: 56 });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Back' }));
    act(() => moveBuddyTour(ALL_STEPS, 1));
    expect(document.querySelector<HTMLElement>('[data-buddy-tour-ring="guide"]')?.style.left).toBe(
      '276px'
    );
  });

  it('pauses from the panel and with Escape, and removes a summoned buddy', async () => {
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    act(() => startBuddyTour());
    await waitForPanel();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Pause' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.agent.dispose).toHaveBeenCalled();
    expect(getBuddyTourState()).toEqual({ phase: 'paused', stepId: 'radio' });

    const again = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(again.agent);
    act(() => resumeBuddyTour());
    await waitForPanel();
    expect(within(panel()).getByRole('heading', { name: 'Radio status' })).toBeInTheDocument();
    fireEvent.keyDown(panel(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getBuddyTourState().phase).toBe('paused');
  });

  it('finishes on the last stop', async () => {
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    act(() => startBuddyTour());
    await waitForPanel();
    act(() => {
      for (let i = 0; i < ALL_STEPS.length - 1; i += 1) moveBuddyTour(ALL_STEPS, 1);
    });
    expect(within(panel()).getByText('Step 12 of 12')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored()).toEqual({ status: 'done' });
  });

  it('pauses the walkthrough when the buddy cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadBuddyAgentMock.mockRejectedValue(new Error('no sprite'));
    render(<BuddyHost {...hostProps()} />);
    act(() => startBuddyTour());
    await waitFor(() => expect(getBuddyTourState().phase).toBe('paused'));
    expect(screen.queryByRole('dialog')).toBeNull();
    error.mockRestore();
  });

  describe('with an active buddy', () => {
    async function showBuddy() {
      applyTheme('windows-95');
      setBuddyAgent('clippy');
      const fake = makeFakeAgent();
      loadBuddyAgentMock.mockResolvedValue(fake.agent);
      const props = hostProps();
      render(<BuddyHost {...props} />);
      await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());
      await act(async () => {});
      return { fake, props };
    }

    it('keeps the buddy after the tour and sends it back to where it stood', async () => {
      const { fake } = await showBuddy();
      vi.useFakeTimers();
      const home = { left: fake.el.style.left, top: fake.el.style.top };
      addAnchor(BUDDY_ANCHORS.radio, { left: 700, top: 8, width: 120, height: 24 });
      act(() => startBuddyTour());
      fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
      expect({ left: fake.el.style.left, top: fake.el.style.top }).not.toEqual(home);

      fireEvent.click(within(panel()).getByRole('button', { name: 'End' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fake.agent.dispose).not.toHaveBeenCalled();
      expect({ left: fake.el.style.left, top: fake.el.style.top }).toEqual(home);
    });

    it('holds lines back during the tour and sums them up afterwards', async () => {
      const { fake } = await showBuddy();
      act(() => startBuddyTour());
      act(() => emitBuddyEvent({ kind: 'dm', publicKey: ALICE_KEY, senderName: null }));
      expect(fake.spoken).toEqual([]);
      expect(getBuddyHistory().map((entry) => entry.shown)).toEqual([false]);

      act(() => endBuddyTour());
      expect(fake.spoken).toEqual(['While I was quiet: 1 message. Click to see them.']);
    });

    it('keeps back a line that was still waiting for its turn when the tour started', async () => {
      const { fake } = await showBuddy();
      fake.queue.held = true;
      act(() => emitBuddyEvent({ kind: 'dm', publicKey: ALICE_KEY, senderName: null }));
      expect(fake.queue.waiting).toBe(2);

      act(() => startBuddyTour());
      expect(fake.agent.stop).toHaveBeenCalled();
      expect(fake.agent._balloon.hide).toHaveBeenCalledWith(true);
      expect(getBuddyHistory().map((entry) => entry.shown)).toEqual([false]);

      act(() => endBuddyTour());
      expect(fake.spoken).toEqual(['While I was quiet: 1 message. Click to see them.']);
    });

    it('gives no page tips during the tour', async () => {
      const { fake } = await showBuddy();
      act(() => startBuddyTour());
      cleanup();
      const again = makeFakeAgent();
      loadBuddyAgentMock.mockResolvedValue(again.agent);
      render(<BuddyHost {...hostProps({ activePage: 'map' })} />);
      await waitForPanel();
      expect(fake.spoken).toEqual([]);
      expect(again.spoken).toEqual([]);
    });

    it('does not save the spot the tour or a drag during it put the buddy in', async () => {
      const { fake } = await showBuddy();
      act(() => startBuddyTour());
      fireEvent.mouseDown(fake.el, { clientX: 50, clientY: 50 });
      fake.el.style.left = '300px';
      fake.el.style.top = '200px';
      fireEvent.mouseUp(window);
      expect(getBuddyPosition()).toBeNull();
    });

    it('keeps the click menu closed during the tour and offers the tour in it otherwise', async () => {
      const { fake } = await showBuddy();
      const click = () => {
        fireEvent.mouseDown(fake.el, { clientX: 50, clientY: 50 });
        fireEvent.mouseUp(window);
        fireEvent.click(fake.el, { clientX: 50, clientY: 50, detail: 1 });
        act(() => {
          vi.advanceTimersByTime(300);
        });
      };
      vi.useFakeTimers();
      click();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Guided walkthrough' }));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'welcome' });
      expect(panel()).toBeInTheDocument();

      click();
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
      fireEvent.click(within(panel()).getByRole('button', { name: 'Pause' }));
      click();
      expect(screen.getByRole('menuitem', { name: 'Resume walkthrough' })).toBeInTheDocument();
    });

    it('pauses the tour when the buddy is sent away with a right-click', async () => {
      const { fake } = await showBuddy();
      act(() => startBuddyTour());
      fireEvent.contextMenu(fake.el);
      expect(getBuddyTourState().phase).toBe('paused');
      expect(fake.agent.hide).toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('ManualView walkthrough button', () => {
  it('starts the walkthrough', () => {
    render(<ManualView />);
    fireEvent.click(screen.getByRole('button', { name: 'Start guided walkthrough' }));
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'welcome' });
    expect(screen.queryByRole('button', { name: 'Start guided walkthrough' })).toBeNull();
    expect(screen.getByText('The walkthrough is running')).toBeInTheDocument();
  });

  it('offers to resume or start over when the walkthrough is paused', () => {
    startBuddyTour();
    moveBuddyTour(ALL_STEPS, 1);
    pauseBuddyTour();
    render(<ManualView />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume walkthrough' }));
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'radio' });

    act(() => pauseBuddyTour());
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(getBuddyTourState()).toEqual({ phase: 'running', stepId: 'welcome' });
  });
});
