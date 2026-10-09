import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contact, HealthStatus } from '../types';

const loadBuddyAgentMock = vi.fn();
vi.mock('../buddy/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../buddy/agents')>()),
  loadBuddyAgent: (...args: unknown[]) => loadBuddyAgentMock(...args),
}));

const apiMock = vi.hoisted(() => ({
  getLatestTelemetry: vi.fn(),
  getOpenHopStatus: vi.fn(),
  getOpenHopUpdateStatus: vi.fn(),
}));
vi.mock('../api', () => ({ api: apiMock }));

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

import { BuddyHost, __resetBuddySessionState } from '../buddy/BuddyHost';
import { BUDDY_ANCHOR_ATTR, conversationAnchor } from '../buddy/buddyAnchors';
import { describeBuddyEvent } from '../buddy/buddyCatalog';
import { clearBuddyHistory, getBuddyHistory } from '../buddy/buddyHistory';
import { BuddySettings } from '../components/settings/BuddySettings';
import { BatteryWatch, pageTipKey } from '../buddy/buddyLogic';
import { emitBuddyEvent } from '../buddy/buddyEvents';
import {
  DEFAULT_BATTERY_THRESHOLD,
  getBuddyAgent,
  getBuddyBatteryThreshold,
  getBuddyMute,
  getBuddyPosition,
  getBuddyQuietHours,
  getWarnedBatteries,
  isBuddyGroupOn,
  isBuddyAvailable,
  isBuddyDiscovered,
  markBuddyDiscovered,
  muteBuddyUntilReload,
  setBuddyAgent,
  setBuddyBatteryThreshold,
  setBuddyGroupOn,
  unmuteBuddy,
  __resetBuddyMuteForTests,
} from '../buddy/buddyPrefs';
import { applyTheme } from '../utils/theme';

const ALICE_KEY = 'a1'.repeat(32);
const BOB_KEY = 'b2'.repeat(32);

function contact(publicKey: string, name: string, extra: Partial<Contact> = {}): Contact {
  return { public_key: publicKey, name, last_advert: 1, ...extra } as Contact;
}

const EXITED = 0;
const WAITING = 1;
const DEFAULT_ANIMATIONS = [
  'GetAttention',
  'Congratulate',
  'Alert',
  'Explain',
  'GestureLeft',
  'GestureRight',
  'GestureUp',
  'GestureDown',
];

/** Minimal stand-in for a clippyjs Agent: queue functions run immediately,
 *  unless the queue is held (then they run, in order, on release()).
 *  `actions` lists animations and lines in the order they were started. */
function makeFakeAgent(animations: string[] = DEFAULT_ANIMATIONS) {
  const el = document.createElement('div');
  const balloonEl = document.createElement('div');
  document.body.append(el, balloonEl);
  const spoken: string[] = [];
  const actions: string[] = [];
  /** Queue steps that reported they were done. */
  const done = { count: 0 };
  const complete = () => {
    done.count += 1;
  };
  /** How a requested animation behaves; tests swap `run` to stall one, and
   *  clear `starts` for one that waits behind an idle animation. */
  const playback = {
    starts: true,
    run: (name: string, callback: (name: string, state: number) => void) => callback(name, EXITED),
  };
  const held: Array<(complete: () => void) => void> = [];
  let holding = false;
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
        actions.push(`say:${text}`);
        complete();
      }),
    },
    hasAnimation: (name: string) => animations.includes(name),
    _playInternal: vi.fn((name: string, callback: (name: string, state: number) => void) => {
      actions.push(`play:${name}`);
      if (playback.starts) agent._animator.currentAnimationName = name;
      playback.run(name, callback);
    }) as ReturnType<typeof vi.fn> | undefined,
    _getDirection: vi.fn(() => 'Left'),
    _addToQueue: vi.fn((fn: (complete: () => void) => void) => {
      if (holding) held.push(fn);
      else fn(complete);
    }),
    _onQueueEmpty: vi.fn(),
    show: vi.fn(),
    hide: vi.fn((_fast: boolean, cb?: () => void) => cb?.()),
    reposition: vi.fn(),
    animate: vi.fn(),
    dispose: vi.fn(() => {
      el.remove();
      balloonEl.remove();
    }),
  };
  const hold = () => {
    holding = true;
  };
  const release = () => {
    holding = false;
    for (const fn of held.splice(0)) fn(complete);
  };
  return { agent, spoken, actions, done, playback, el, balloonEl, hold, release };
}

/** Puts an element the buddy can point at on screen. */
function addAnchor(anchor: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(BUDDY_ANCHOR_ATTR, anchor);
  el.getBoundingClientRect = () => ({ left: 0, top: 100, width: 200, height: 40 }) as DOMRect;
  document.body.append(el);
  return el;
}

function hostProps(overrides: Partial<Parameters<typeof BuddyHost>[0]> = {}) {
  return {
    health: null as HealthStatus | null,
    contacts: [contact(ALICE_KEY, 'Alice'), contact(BOB_KEY, 'Bob', { power_source: 'mains' })],
    channels: [],
    activePage: null,
    onSelectConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onNavigateMentionToMessage: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  applyTheme('original');
  __resetBuddySessionState();
  __resetBuddyMuteForTests();
  clearBuddyHistory();
  loadBuddyAgentMock.mockReset();
  apiMock.getLatestTelemetry.mockReset().mockResolvedValue({});
  apiMock.getOpenHopStatus.mockReset().mockResolvedValue({ configured: false });
  apiMock.getOpenHopUpdateStatus.mockReset();
  useUpdateStatusMock.mockReset().mockReturnValue({ status: null });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
});

describe('buddy prefs', () => {
  it('defaults to Clippy under Windows 95 until the user picks another buddy or Off', () => {
    expect(getBuddyAgent('windows-95')).toBe('clippy');
    localStorage.setItem('rtfm-buddy-agent', 'not-a-buddy');
    expect(getBuddyAgent('windows-95')).toBe('clippy');
    setBuddyAgent('merlin');
    expect(getBuddyAgent('windows-95')).toBe('merlin');
    setBuddyAgent(null);
    expect(localStorage.getItem('rtfm-buddy-agent')).toBe('off');
    expect(getBuddyAgent('windows-95')).toBeNull();
  });

  it('keeps other themes buddy-free until Windows 95 was used, then defaults them to Off', () => {
    setBuddyAgent('merlin');
    expect(isBuddyAvailable('original')).toBe(false);
    expect(getBuddyAgent('original')).toBeNull();

    markBuddyDiscovered();
    expect(isBuddyAvailable('original')).toBe(true);
    expect(getBuddyAgent('original')).toBe('merlin');

    localStorage.removeItem('rtfm-buddy-agent');
    expect(getBuddyAgent('original')).toBeNull();
    expect(getBuddyAgent('windows-95')).toBe('clippy');
  });

  it('clamps the battery threshold', () => {
    expect(getBuddyBatteryThreshold()).toBe(DEFAULT_BATTERY_THRESHOLD);
    setBuddyBatteryThreshold(150);
    expect(getBuddyBatteryThreshold()).toBe(95);
    setBuddyBatteryThreshold(0);
    expect(getBuddyBatteryThreshold()).toBe(1);
    localStorage.setItem('rtfm-buddy-battery-threshold', 'junk');
    expect(getBuddyBatteryThreshold()).toBe(DEFAULT_BATTERY_THRESHOLD);
  });
});

describe('BatteryWatch', () => {
  it('warns once per drop and re-arms 5 points above the threshold', () => {
    const watch = new BatteryWatch();
    expect(watch.observe('n', 25, 20)).toBe(false);
    expect(watch.observe('n', 19, 20)).toBe(true);
    expect(watch.observe('n', 10, 20)).toBe(false);
    expect(watch.observe('n', 24, 20)).toBe(false);
    expect(watch.observe('n', 18, 20)).toBe(false);
    expect(watch.observe('n', 25, 20)).toBe(false); // re-armed
    expect(watch.observe('n', 15, 20)).toBe(true);
  });
});

describe('pageTipKey', () => {
  it('maps pages to tips and returns null for pages without one', () => {
    expect(pageTipKey('map')).toBe('buddy_tip_map');
    expect(pageTipKey('settings')).toBe('buddy_tip_settings');
    expect(pageTipKey('snmp')).toBe('buddy_tip_snmp');
    expect(pageTipKey('link')).toBeNull();
    expect(pageTipKey(null)).toBeNull();
  });
});

describe('describeBuddyEvent', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    `${key}${params ? JSON.stringify(params) : ''}`;
  const contacts = [contact(ALICE_KEY, 'Alice')];

  it('targets the new node, or Mesh Health for a batch', () => {
    const single = describeBuddyEvent(
      { kind: 'new-node', count: 1, publicKey: ALICE_KEY, name: 'Alice' },
      t,
      contacts,
      []
    );
    expect(single?.target).toEqual({
      kind: 'conversation',
      conversation: { type: 'contact-info', id: ALICE_KEY, name: 'Alice' },
    });
    const batch = describeBuddyEvent(
      { kind: 'new-node', count: 4, publicKey: null, name: null },
      t,
      contacts,
      []
    );
    expect(batch?.text).toBe('buddy_new_nodes{"count":4}');
    expect(batch?.target).toMatchObject({ conversation: { type: 'mesh-health' } });
  });

  it('sends a radio disconnect to the radio settings', () => {
    const line = describeBuddyEvent({ kind: 'radio', state: 'disconnected' }, t, [], []);
    expect(line?.target).toEqual({ kind: 'settings', section: 'radio' });
  });

  it('jumps to the mentioned message', () => {
    const line = describeBuddyEvent(
      { kind: 'mention', channelKey: 'CHAN1', messageId: 42, senderName: 'Bob' },
      t,
      [],
      [{ key: 'CHAN1', name: '#test' } as never]
    );
    expect(line?.text).toBe('buddy_mention{"name":"Bob","channel":"#test"}');
    expect(line?.target).toEqual({ kind: 'mention', channelKey: 'CHAN1', messageId: 42 });
  });
});

describe('BuddyHost', () => {
  it('stays unloaded on other themes until Windows 95 was used', async () => {
    setBuddyAgent('clippy');
    render(<BuddyHost {...hostProps()} />);
    await act(async () => {});
    expect(loadBuddyAgentMock).not.toHaveBeenCalled();
  });

  it('shows Clippy by default under Windows 95 when nothing was chosen', async () => {
    applyTheme('windows-95');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());
    expect(loadBuddyAgentMock).toHaveBeenCalledWith('clippy');
    // Below the CRT scanline/vignette overlays (themes.css), above app layers.
    expect(fake.el.style.zIndex).toBe('9996');
    expect(fake.balloonEl.style.zIndex).toBe('9996');
  });

  it('stays unloaded when the user turned the buddy off', async () => {
    applyTheme('windows-95');
    setBuddyAgent(null);
    render(<BuddyHost {...hostProps()} />);
    await act(async () => {});
    expect(loadBuddyAgentMock).not.toHaveBeenCalled();
  });

  it('says the page tip, announces a DM and jumps to it on balloon click', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps({ activePage: 'map' });
    render(<BuddyHost {...props} />);

    // The host shows the agent first and only then puts it in React state; the
    // tip is said by an effect after that render. Wait for the tip itself, not
    // for show(): on a slow machine the effect has not run yet when show() has.
    await waitFor(() =>
      expect(fake.spoken).toContain(
        "It looks like you're looking at the map. Drag to pan, scroll to zoom."
      )
    );
    expect(loadBuddyAgentMock).toHaveBeenCalledWith('clippy');

    act(() => {
      emitBuddyEvent({ kind: 'dm', publicKey: ALICE_KEY, senderName: null });
    });
    expect(fake.spoken).toContain('Alice sent you a direct message. Click to read it.');

    fireEvent.click(fake.balloonEl);
    expect(props.onSelectConversation).toHaveBeenCalledWith({
      type: 'contact',
      id: ALICE_KEY,
      name: 'Alice',
    });
  });

  it('skips a queued tip for a page the user already left, and says it on a later visit', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const fake = makeFakeAgent();
    fake.hold();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps({ activePage: 'map' });
    const { rerender } = render(<BuddyHost {...props} />);
    // Wait until the map tip sits in the held queue (see the test above), so
    // leaving the page really happens while that tip is still waiting.
    await waitFor(() => expect(fake.agent._addToQueue).toHaveBeenCalled());

    rerender(<BuddyHost {...props} activePage="search" />);
    act(() => fake.release());
    expect(fake.spoken).toEqual(['Search through all stored messages from here.']);
    // The skipped map tip did not get its animation either.
    expect(fake.actions).toEqual([
      'play:Explain',
      'say:Search through all stored messages from here.',
    ]);

    rerender(<BuddyHost {...props} activePage="map" />);
    expect(fake.spoken).toContain(
      "It looks like you're looking at the map. Drag to pan, scroll to zoom."
    );
  });

  it('warns once about a low node battery and skips mains-powered nodes', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const now = Math.floor(Date.now() / 1000);
    apiMock.getLatestTelemetry.mockResolvedValue({
      [ALICE_KEY]: { timestamp: now, battery_volts: 3.3, source: 'repeater' },
      [BOB_KEY]: { timestamp: now, battery_volts: 3.3, source: 'repeater' },
    });
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);

    await waitFor(() =>
      expect(fake.spoken.some((line) => line.startsWith('Alice is running low on battery'))).toBe(
        true
      )
    );
    expect(fake.spoken.some((line) => line.startsWith('Bob'))).toBe(false);
  });

  it('ignores stale node telemetry', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const old = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
    apiMock.getLatestTelemetry.mockResolvedValue({
      [ALICE_KEY]: { timestamp: old, battery_volts: 3.3, source: 'repeater' },
    });
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(apiMock.getLatestTelemetry).toHaveBeenCalled());
    await act(async () => {});
    expect(fake.spoken.some((line) => line.includes('battery'))).toBe(false);
  });

  it("warns about the own radio's battery and opens My Node", async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps({
      health: { radio_stats: { battery_mv: 3300 } } as unknown as HealthStatus,
    });
    render(<BuddyHost {...props} />);
    await waitFor(() =>
      expect(
        fake.spoken.some((line) => line.startsWith("It looks like your radio's battery"))
      ).toBe(true)
    );
    fireEvent.click(fake.balloonEl);
    expect(props.onSelectConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'node' })
    );
  });

  it('announces an available app update once and opens About', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    useUpdateStatusMock.mockReturnValue({ status: { update_available: true, commits_behind: 3 } });
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const props = hostProps();
    render(<BuddyHost {...props} />);
    await waitFor(() =>
      expect(fake.spoken).toContain('A new RTFM-EV version is available. Click to see the details.')
    );
    fireEvent.click(fake.balloonEl);
    expect(props.onOpenSettings).toHaveBeenCalledWith('about');
  });

  const DM_LINE = 'Alice sent you a direct message. Click to read it.';

  async function showBuddy(fake: ReturnType<typeof makeFakeAgent>, props = hostProps()) {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    const view = render(<BuddyHost {...props} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());
    // The agent reaches React state one render after show(); let that settle.
    await act(async () => {});
    return view;
  }

  function emitDm() {
    act(() => {
      emitBuddyEvent({ kind: 'dm', publicKey: ALICE_KEY, senderName: null });
    });
  }

  it('plays the mood animation before the line', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    emitDm();
    expect(fake.actions).toEqual(['play:GetAttention', `say:${DM_LINE}`]);
  });

  it('gestures toward the sidebar row of the sender when it is on screen', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    addAnchor(conversationAnchor('contact', ALICE_KEY));
    emitDm();
    expect(fake.agent._getDirection).toHaveBeenCalledWith(100, 120);
    expect(fake.actions).toEqual(['play:GetAttention', 'play:GestureLeft', `say:${DM_LINE}`]);
  });

  it('speaks while it gestures, and only moves on when both are done', async () => {
    const fake = makeFakeAgent();
    // The mood animation ends at once; the gesture never reports back.
    fake.playback.run = (name, callback) => {
      if (!name.startsWith('Gesture')) callback(name, EXITED);
    };
    await showBuddy(fake);
    addAnchor(conversationAnchor('contact', ALICE_KEY));
    vi.useFakeTimers();
    emitDm();
    expect(fake.actions).toEqual(['play:GetAttention', 'play:GestureLeft', `say:${DM_LINE}`]);
    expect(fake.done.count).toBe(0);
    act(() => {
      vi.advanceTimersByTime(2000 + 1500); // gesture cap + its exit grace
    });
    expect(fake.done.count).toBe(1);
  });

  it('just speaks when the character has no fitting animation', async () => {
    const fake = makeFakeAgent([]);
    await showBuddy(fake);
    addAnchor(conversationAnchor('contact', ALICE_KEY));
    emitDm();
    expect(fake.actions).toEqual([`say:${DM_LINE}`]);
  });

  it('still speaks when the library no longer has the animation internals', async () => {
    const fake = makeFakeAgent();
    fake.agent._playInternal = undefined;
    await showBuddy(fake);
    emitDm();
    expect(fake.spoken).toEqual([DM_LINE]);
  });

  it('ends an animation that holds its pose, then speaks', async () => {
    const fake = makeFakeAgent();
    let report: ((name: string, state: number) => void) | null = null;
    fake.playback.run = (name, callback) => {
      report = callback;
      callback(name, WAITING);
    };
    await showBuddy(fake);
    emitDm();
    expect(fake.agent._animator.exitAnimation).toHaveBeenCalledTimes(1);
    expect(fake.spoken).toEqual([]);
    act(() => report?.('GetAttention', EXITED));
    expect(fake.spoken).toEqual([DM_LINE]);
  });

  it('cuts off an animation that never reports back', async () => {
    const fake = makeFakeAgent();
    fake.playback.run = () => {};
    await showBuddy(fake);
    vi.useFakeTimers();
    emitDm();
    expect(fake.spoken).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fake.agent._animator.exitAnimation).toHaveBeenCalled();
    expect(fake.spoken).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(fake.spoken).toEqual([DM_LINE]);
  });

  it('lets a running idle animation hand over before it times the mood animation', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    fake.agent._animator.currentAnimationName = 'Idle1_1';
    fake.playback.starts = false;
    let report: ((name: string, state: number) => void) | null = null;
    fake.playback.run = (_name, callback) => {
      report = callback;
    };
    vi.useFakeTimers();
    emitDm();
    // The idle animation is asked to wrap up; the mood animation is not on yet.
    expect(fake.agent._animator.exitAnimation).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fake.agent._animator.currentAnimationName = 'GetAttention'; // idle ended, ours began
    act(() => {
      vi.advanceTimersByTime(100 + 2900);
    });
    // It has had 2.9 of its own 3 seconds: not cut off yet.
    expect(fake.agent._animator.exitAnimation).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(fake.agent._animator.exitAnimation).toHaveBeenCalledTimes(2);
    act(() => report?.('GetAttention', EXITED));
    expect(fake.spoken).toEqual([DM_LINE]);
  });

  it('speaks anyway when an idle animation never hands over', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    fake.agent._animator.currentAnimationName = 'Idle1_1';
    fake.playback.starts = false;
    fake.playback.run = () => {};
    vi.useFakeTimers();
    emitDm();
    act(() => {
      vi.advanceTimersByTime(4000 + 3000 + 1400); // handover wait + cap + most of the grace
    });
    expect(fake.spoken).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(fake.spoken).toEqual([DM_LINE]);
  });

  it('says nothing about a group that is switched off', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    act(() => setBuddyGroupOn('messages', false));
    emitDm();
    expect(fake.actions).toEqual([]);
    expect(getBuddyHistory()).toEqual([]);
  });

  it('keeps lines back while muted and sums them up when the mute ends', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    act(() => muteBuddyUntilReload());
    emitDm();
    act(() => {
      emitBuddyEvent({ kind: 'new-node', count: 3, publicKey: null, name: null });
    });
    expect(fake.actions).toEqual([]);
    expect(getBuddyHistory().map((entry) => [entry.kind, entry.shown])).toEqual([
      ['dm', false],
      ['new-node', false],
    ]);

    act(() => unmuteBuddy());
    // One held-back line about three nodes counts as three.
    expect(fake.spoken).toEqual(['While I was quiet: 1 message, 3 new nodes.']);

    emitDm();
    expect(fake.spoken).toContain(DM_LINE);
    expect(getBuddyHistory().slice(-1)[0]).toMatchObject({ kind: 'dm', shown: true });
  });

  it('says no summary when nothing was kept back', async () => {
    const fake = makeFakeAgent();
    await showBuddy(fake);
    act(() => muteBuddyUntilReload());
    act(() => unmuteBuddy());
    expect(fake.spoken).toEqual([]);
  });

  it('drops a page tip while muted and gives it on a later visit', async () => {
    const fake = makeFakeAgent();
    act(() => muteBuddyUntilReload());
    const props = hostProps({ activePage: 'map' });
    const { rerender } = await showBuddy(fake, props);
    expect(fake.spoken).toEqual([]);

    act(() => unmuteBuddy());
    expect(fake.spoken).toEqual([]); // tips are not part of the summary
    rerender(<BuddyHost {...props} activePage="search" />);
    rerender(<BuddyHost {...props} activePage="map" />);
    expect(fake.spoken).toContain(
      "It looks like you're looking at the map. Drag to pan, scroll to zoom."
    );
  });

  it('does not repeat a battery warning after a reload', async () => {
    const props = hostProps({
      health: { radio_stats: { battery_mv: 3300 } } as unknown as HealthStatus,
    });
    const first = makeFakeAgent();
    const view = await showBuddy(first, props);
    expect(first.spoken.some((line) => line.includes("radio's battery"))).toBe(true);
    expect(getWarnedBatteries()).toEqual(['self']);
    view.unmount();

    const second = makeFakeAgent();
    await showBuddy(second, props);
    expect(second.spoken.some((line) => line.includes("radio's battery"))).toBe(false);
  });

  it('forgets a warned node once its telemetry is gone', async () => {
    localStorage.setItem('rtfm-buddy-battery-warned', JSON.stringify(['self', ALICE_KEY]));
    const fake = makeFakeAgent();
    await showBuddy(fake);
    await waitFor(() => expect(getWarnedBatteries()).toEqual(['self']));
  });

  it('saves the dragged position', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());

    fireEvent.mouseDown(fake.el);
    fake.el.style.left = '120px';
    fake.el.style.top = '340px';
    fireEvent.mouseUp(window);
    expect(getBuddyPosition()).toEqual({ x: 120, y: 340 });
  });

  it('right-click sends the buddy away until a different buddy is picked', async () => {
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());

    fireEvent.contextMenu(fake.el);
    expect(fake.agent.hide).toHaveBeenCalled();
    await waitFor(() => expect(fake.agent.dispose).toHaveBeenCalled());

    const next = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(next.agent);
    act(() => setBuddyAgent('merlin'));
    await waitFor(() => expect(next.agent.show).toHaveBeenCalled());
    expect(loadBuddyAgentMock).toHaveBeenLastCalledWith('merlin');
  });

  it('disposes the default Clippy when leaving Windows 95 for another theme', async () => {
    applyTheme('windows-95');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());
    act(() => applyTheme('original'));
    expect(fake.agent.dispose).toHaveBeenCalled();
    expect(isBuddyDiscovered()).toBe(true);
  });

  it('keeps a chosen buddy on other themes once Windows 95 was used', async () => {
    applyTheme('windows-95');
    const fake = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(fake.agent);
    render(<BuddyHost {...hostProps()} />);
    await waitFor(() => expect(fake.agent.show).toHaveBeenCalled());
    act(() => applyTheme('original'));

    const next = makeFakeAgent();
    loadBuddyAgentMock.mockResolvedValue(next.agent);
    act(() => setBuddyAgent('rover'));
    await waitFor(() => expect(next.agent.show).toHaveBeenCalled());
    expect(loadBuddyAgentMock).toHaveBeenLastCalledWith('rover');
  });
});

describe('BuddySettings', () => {
  it('is hidden on other themes until Windows 95 was used', () => {
    render(<BuddySettings />);
    expect(screen.queryByTestId('buddy-settings')).toBeNull();
  });

  it('is offered on other themes after Windows 95 was used, starting at Off', () => {
    markBuddyDiscovered();
    render(<BuddySettings />);
    expect(screen.getByLabelText('Desktop buddy')).toHaveValue('off');
  });

  it('picks a buddy and saves the battery threshold', () => {
    applyTheme('windows-95');
    render(<BuddySettings />);
    const select = screen.getByLabelText('Desktop buddy');
    expect(select).toHaveValue('clippy');
    expect(screen.getByLabelText(/Battery warning below/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'merlin' } });
    expect(getBuddyAgent()).toBe('merlin');

    const threshold = screen.getByLabelText(/Battery warning below/);
    fireEvent.change(threshold, { target: { value: '35' } });
    fireEvent.blur(threshold);
    expect(getBuddyBatteryThreshold()).toBe(35);

    fireEvent.change(select, { target: { value: 'off' } });
    expect(getBuddyAgent()).toBeNull();
    expect(select).toHaveValue('off');
    expect(screen.queryByLabelText(/Battery warning below/)).toBeNull();
    expect(screen.queryByText('Tell me about')).toBeNull();
  });

  it('switches a group of lines off and on again', () => {
    applyTheme('windows-95');
    render(<BuddySettings />);
    const tips = screen.getByRole('checkbox', { name: 'Page tips' });
    expect(tips).toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);

    fireEvent.click(tips);
    expect(isBuddyGroupOn('tips')).toBe(false);
    expect(tips).not.toBeChecked();

    fireEvent.click(tips);
    expect(isBuddyGroupOn('tips')).toBe(true);
  });

  it('mutes for a while, shows until when, and ends the mute', () => {
    applyTheme('windows-95');
    render(<BuddySettings />);
    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: '1 hour' }));

    const mute = getBuddyMute();
    expect(mute?.kind).toBe('until');
    expect(mute?.kind === 'until' ? mute.until - before : 0).toBeGreaterThanOrEqual(3_600_000);
    expect(screen.getByText(/^Muted until \d/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1 hour' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'End now' }));
    expect(getBuddyMute()).toBeNull();
    expect(screen.getByRole('button', { name: '15 minutes' })).toBeInTheDocument();
  });

  it('mutes until the page is reloaded', () => {
    applyTheme('windows-95');
    render(<BuddySettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Until reload' }));
    expect(getBuddyMute()).toEqual({ kind: 'reload' });
    expect(screen.getByText('Muted until you reload the page.')).toBeInTheDocument();
  });

  it('saves quiet hours once both times are set, and clears them', () => {
    applyTheme('windows-95');
    render(<BuddySettings />);
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

    fireEvent.change(from, { target: { value: '22:00' } });
    expect(getBuddyQuietHours()).toBeNull();
    fireEvent.change(to, { target: { value: '07:00' } });
    expect(getBuddyQuietHours()).toEqual({ from: '22:00', to: '07:00' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(getBuddyQuietHours()).toBeNull();
    expect(from).toHaveValue('');
    expect(to).toHaveValue('');
  });

  it('shows stored quiet hours', () => {
    applyTheme('windows-95');
    localStorage.setItem('rtfm-buddy-quiet-hours', '{"from":"23:30","to":"06:15"}');
    render(<BuddySettings />);
    expect(screen.getByLabelText('From')).toHaveValue('23:30');
    expect(screen.getByLabelText('To')).toHaveValue('06:15');
  });

  it('keeps the compact copy to the picker and the battery threshold', () => {
    applyTheme('windows-95');
    render(<BuddySettings compact />);
    expect(screen.getByLabelText('Desktop buddy')).toHaveValue('clippy');
    expect(screen.getByLabelText(/Battery warning below/)).toBeInTheDocument();
    expect(screen.queryByText('Tell me about')).toBeNull();
    expect(screen.queryByRole('button', { name: '15 minutes' })).toBeNull();
    expect(screen.queryByLabelText('From')).toBeNull();
  });
});
