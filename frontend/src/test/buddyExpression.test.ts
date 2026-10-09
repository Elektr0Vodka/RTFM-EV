import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import courtneyData from '../buddy/custom/courtney/agent.json';
import gourdyData from '../buddy/custom/gourdy/agent.json';
import { BUDDY_ANCHORS, conversationAnchor, findAnchorPoint } from '../buddy/buddyAnchors';
import {
  batteryNodesLine,
  describeBuddyEvent,
  quietSummaryLine,
  tipLine,
  updateAppLine,
} from '../buddy/buddyCatalog';
import {
  BUDDY_HISTORY_LIMIT,
  clearBuddyHistory,
  getBuddyHistory,
  recordBuddyLine,
} from '../buddy/buddyHistory';
import { BatteryWatch } from '../buddy/buddyLogic';
import { pickAnimation, type BuddyMood } from '../buddy/buddyMood';
import {
  __resetBuddyMuteForTests,
  getBuddyGroupsOff,
  getBuddyMute,
  getBuddyQuietHours,
  getWarnedBatteries,
  isBuddyGroupOn,
  isBuddyQuiet,
  muteBuddyFor,
  muteBuddyUntilReload,
  setBuddyGroupOn,
  setBuddyQuietHours,
  setWarnedBatteries,
  unmuteBuddy,
} from '../buddy/buddyPrefs';
import { HeldBack, isQuiet, isWithinQuietHours } from '../buddy/buddyQuiet';

const t = (key: string, params?: Record<string, unknown>) =>
  `${key}${params ? JSON.stringify(params) : ''}`;

function hasFrom(data: { animations: Record<string, unknown> }) {
  return (name: string) => name in data.animations;
}

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 9, hours, minutes, 0);
}

beforeEach(() => {
  localStorage.clear();
  __resetBuddyMuteForTests();
  clearBuddyHistory();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('pickAnimation', () => {
  const moods: BuddyMood[] = ['attention', 'happy', 'alert', 'info', 'explain'];

  it('takes the first animation of the chain that Clippy has', async () => {
    const clippy = (await (await import('clippyjs/agents/clippy')).default.agent()).default as {
      animations: Record<string, unknown>;
    };
    expect(moods.map((mood) => pickAnimation(hasFrom(clippy), mood))).toEqual([
      'GetAttention',
      'Congratulate',
      'Alert',
      'Explain', // Clippy has no Announce
      'Explain',
    ]);
  });

  it('falls back along the chain for a converted character', () => {
    expect(moods.map((mood) => pickAnimation(hasFrom(courtneyData), mood))).toEqual([
      'GetAttention',
      'Congratulate',
      'GetAttention', // Courtney has no Alert
      'Announce',
      'Explain',
    ]);
  });

  it('returns null when the character has none of the chain, or there is no mood', () => {
    expect(moods.map((mood) => pickAnimation(hasFrom(gourdyData), mood))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(pickAnimation(() => true, null)).toBeNull();
  });
});

describe('quiet hours', () => {
  it('covers a range within one day, end exclusive', () => {
    const hours = { from: '09:00', to: '17:30' };
    expect(isWithinQuietHours(at(8, 59), hours)).toBe(false);
    expect(isWithinQuietHours(at(9, 0), hours)).toBe(true);
    expect(isWithinQuietHours(at(17, 29), hours)).toBe(true);
    expect(isWithinQuietHours(at(17, 30), hours)).toBe(false);
  });

  it('wraps midnight', () => {
    const hours = { from: '22:00', to: '07:00' };
    expect(isWithinQuietHours(at(21, 59), hours)).toBe(false);
    expect(isWithinQuietHours(at(22, 0), hours)).toBe(true);
    expect(isWithinQuietHours(at(3, 0), hours)).toBe(true);
    expect(isWithinQuietHours(at(7, 0), hours)).toBe(false);
  });

  it('is off for equal, missing or malformed times', () => {
    expect(isWithinQuietHours(at(12), { from: '12:00', to: '12:00' })).toBe(false);
    expect(isWithinQuietHours(at(12), null)).toBe(false);
    expect(isWithinQuietHours(at(12), { from: '25:00', to: '13:00' })).toBe(false);
    expect(isWithinQuietHours(at(12), { from: 'noon', to: '13:00' })).toBe(false);
  });
});

describe('isQuiet', () => {
  it('is quiet during a timed mute and not after it', () => {
    const now = at(12);
    expect(isQuiet(now, { kind: 'until', until: now.getTime() + 1000 }, null)).toBe(true);
    expect(isQuiet(now, { kind: 'until', until: now.getTime() }, null)).toBe(false);
  });

  it('is quiet until reload, or inside quiet hours, and not otherwise', () => {
    expect(isQuiet(at(12), { kind: 'reload' }, null)).toBe(true);
    expect(isQuiet(at(23), null, { from: '22:00', to: '07:00' })).toBe(true);
    expect(isQuiet(at(12), null, { from: '22:00', to: '07:00' })).toBe(false);
    expect(isQuiet(at(12), null, null)).toBe(false);
  });
});

describe('HeldBack', () => {
  it('counts per group in a fixed order and empties on take', () => {
    const held = new HeldBack();
    expect(held.takeSummary()).toBeNull();
    held.add('nodes');
    held.add('messages');
    held.add('messages');
    expect(held.takeSummary()).toEqual([
      { group: 'messages', count: 2 },
      { group: 'nodes', count: 1 },
    ]);
    expect(held.takeSummary()).toBeNull();
  });

  it('counts a line about several things as that many', () => {
    const held = new HeldBack();
    held.add('nodes', 3);
    held.add('nodes');
    expect(held.takeSummary()).toEqual([{ group: 'nodes', count: 4 }]);
  });
});

describe('buddy prefs: groups, mute, quiet hours, warned batteries', () => {
  it('has every group on by default and remembers the ones switched off', () => {
    expect(getBuddyGroupsOff()).toEqual([]);
    expect(isBuddyGroupOn('tips')).toBe(true);
    setBuddyGroupOn('tips', false);
    setBuddyGroupOn('radio', false);
    expect(isBuddyGroupOn('tips')).toBe(false);
    expect(JSON.parse(localStorage.getItem('rtfm-buddy-groups-off') ?? 'null')).toEqual([
      'radio',
      'tips',
    ]);
    setBuddyGroupOn('tips', true);
    expect(getBuddyGroupsOff()).toEqual(['radio']);
  });

  it('ignores unknown groups and malformed stored values', () => {
    localStorage.setItem('rtfm-buddy-groups-off', '["tips","nonsense",3]');
    expect(getBuddyGroupsOff()).toEqual(['tips']);
    localStorage.setItem('rtfm-buddy-groups-off', '{not json');
    expect(getBuddyGroupsOff()).toEqual([]);
  });

  it('keeps a timed mute in storage until it runs out', () => {
    const now = 1_000_000;
    muteBuddyFor(15 * 60 * 1000, now);
    expect(localStorage.getItem('rtfm-buddy-mute-until')).toBe(String(now + 900_000));
    expect(getBuddyMute(now + 1)).toEqual({ kind: 'until', until: now + 900_000 });
    expect(getBuddyMute(now + 900_000)).toBeNull();
    muteBuddyFor(60_000, now);
    unmuteBuddy();
    expect(getBuddyMute(now + 1)).toBeNull();
  });

  it('holds a mute until reload in memory only', () => {
    muteBuddyUntilReload();
    expect(getBuddyMute()).toEqual({ kind: 'reload' });
    expect(localStorage.getItem('rtfm-buddy-mute-until')).toBeNull();
    expect(isBuddyQuiet()).toBe(true);
    unmuteBuddy();
    expect(getBuddyMute()).toBeNull();
    expect(isBuddyQuiet()).toBe(false);
  });

  it('stores quiet hours and ignores malformed ones', () => {
    expect(getBuddyQuietHours()).toBeNull();
    setBuddyQuietHours({ from: '22:00', to: '07:00' });
    expect(getBuddyQuietHours()).toEqual({ from: '22:00', to: '07:00' });
    expect(isBuddyQuiet(at(23))).toBe(true);
    expect(isBuddyQuiet(at(12))).toBe(false);
    setBuddyQuietHours(null);
    expect(localStorage.getItem('rtfm-buddy-quiet-hours')).toBeNull();
    localStorage.setItem('rtfm-buddy-quiet-hours', '{"from":"9","to":"07:00"}');
    expect(getBuddyQuietHours()).toBeNull();
  });

  it('round-trips the warned batteries and tolerates junk', () => {
    expect(getWarnedBatteries()).toEqual([]);
    setWarnedBatteries(['self', 'abc']);
    expect(getWarnedBatteries()).toEqual(['self', 'abc']);
    localStorage.setItem('rtfm-buddy-battery-warned', '"self"');
    expect(getWarnedBatteries()).toEqual([]);
  });
});

describe('BatteryWatch persistence', () => {
  it('reports the warned keys and stays quiet for a key that was warned before', () => {
    const onChange = vi.fn();
    const first = new BatteryWatch([], onChange);
    expect(first.observe('n', 10, 20)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(['n']);

    const afterReload = new BatteryWatch(['n'], onChange);
    expect(afterReload.observe('n', 10, 20)).toBe(false);
    expect(afterReload.observe('n', 25, 20)).toBe(false); // re-armed
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(afterReload.observe('n', 10, 20)).toBe(true);
  });

  it('prunes keys the caller no longer wants to keep', () => {
    const onChange = vi.fn();
    const watch = new BatteryWatch(['self', 'gone', 'fresh'], onChange);
    watch.prune((key) => key !== 'gone');
    expect(onChange).toHaveBeenLastCalledWith(['self', 'fresh']);
    onChange.mockClear();
    watch.prune(() => true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('findAnchorPoint', () => {
  function tagged(anchor: string, rect: Partial<DOMRect>): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-buddy-anchor', anchor);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect;
    document.body.append(el);
    return el;
  }

  it('returns the centre of the tagged element', () => {
    tagged(BUDDY_ANCHORS.radio, { left: 100, top: 20, width: 10, height: 10 });
    expect(findAnchorPoint(BUDDY_ANCHORS.radio)).toEqual({ x: 105, y: 25 });
  });

  it('returns null when the element is absent, has no size or is off screen', () => {
    expect(findAnchorPoint(BUDDY_ANCHORS.battery)).toBeNull();
    tagged(BUDDY_ANCHORS.battery, { left: 100, top: 20 });
    expect(findAnchorPoint(BUDDY_ANCHORS.battery)).toBeNull();
    tagged(BUDDY_ANCHORS.update, {
      left: 100,
      top: window.innerHeight + 50,
      width: 10,
      height: 10,
    });
    expect(findAnchorPoint(BUDDY_ANCHORS.update)).toBeNull();
  });

  it('skips a hidden copy of a row and takes the visible one', () => {
    const anchor = conversationAnchor('contact', 'AB12');
    expect(anchor).toBe('conversation:contact:ab12');
    tagged(anchor, {});
    tagged(anchor, { left: 0, top: 200, width: 200, height: 40 });
    expect(findAnchorPoint(anchor)).toEqual({ x: 100, y: 220 });
  });
});

describe('buddy history', () => {
  it('keeps the newest lines up to the limit', () => {
    for (let i = 0; i < BUDDY_HISTORY_LIMIT + 5; i++) {
      recordBuddyLine({
        at: i,
        kind: 'dm',
        group: 'messages',
        text: `line ${i}`,
        target: null,
        shown: true,
      });
    }
    const history = getBuddyHistory();
    expect(history).toHaveLength(BUDDY_HISTORY_LIMIT);
    expect(history[0].text).toBe('line 5');
    expect(history[history.length - 1].text).toBe(`line ${BUDDY_HISTORY_LIMIT + 4}`);
  });
});

describe('buddy catalog', () => {
  it('gives a DM its group, mood and the sidebar row to point at', () => {
    const line = describeBuddyEvent({ kind: 'dm', publicKey: 'AB12', senderName: 'Al' }, t, [], []);
    expect(line).toMatchObject({
      kind: 'dm',
      group: 'messages',
      mood: 'attention',
      anchor: 'conversation:contact:ab12',
    });
  });

  it('points a mention at its channel row', () => {
    const line = describeBuddyEvent(
      { kind: 'mention', channelKey: 'CHAN1', messageId: 1, senderName: 'Bob' },
      t,
      [],
      []
    );
    expect(line).toMatchObject({ group: 'messages', anchor: 'conversation:channel:chan1' });
  });

  it('knows how many things a line is about', () => {
    const one = describeBuddyEvent({ kind: 'dm', publicKey: 'AB12', senderName: 'Al' }, t, [], []);
    const batch = describeBuddyEvent(
      { kind: 'new-node', count: 4, publicKey: null, name: null },
      t,
      [],
      []
    );
    const low = batteryNodesLine(
      t,
      [],
      [
        { publicKey: 'AA', pct: 10 },
        { publicKey: 'BB', pct: 12 },
      ]
    );
    expect([one?.count, batch?.count, low?.count]).toEqual([1, 4, 2]);
  });

  it('tells the radio states apart', () => {
    const lost = describeBuddyEvent({ kind: 'radio', state: 'disconnected' }, t, [], []);
    const back = describeBuddyEvent({ kind: 'radio', state: 'connected' }, t, [], []);
    const paused = describeBuddyEvent({ kind: 'radio', state: 'paused' }, t, [], []);
    expect(lost).toMatchObject({ kind: 'radio-disconnected', group: 'radio', mood: 'alert' });
    expect(back).toMatchObject({ kind: 'radio-connected', group: 'radio', mood: 'happy' });
    expect(paused).toMatchObject({ kind: 'radio-paused', group: 'radio', mood: null });
    expect(lost?.anchor).toBe(BUDDY_ANCHORS.radio);
  });

  it('builds tips and update lines from the same table', () => {
    expect(tipLine(t, 'map')).toMatchObject({
      kind: 'tip',
      group: 'tips',
      mood: 'explain',
      text: 'buddy_tip_map',
      anchor: null,
    });
    expect(tipLine(t, 'link')).toBeNull();
    expect(updateAppLine(t, 3)).toMatchObject({
      kind: 'update-app',
      group: 'updates',
      mood: 'info',
      anchor: BUDDY_ANCHORS.update,
      target: { kind: 'settings', section: 'about' },
    });
  });

  it('sums up what was held back, without a group or click target', () => {
    const line = quietSummaryLine(t, [
      { group: 'messages', count: 2 },
      { group: 'nodes', count: 1 },
    ]);
    expect(line).toMatchObject({ kind: 'quiet-summary', group: null, mood: null, target: null });
    expect(line.text).toBe(
      'buddy_quiet_summary{"items":"buddy_quiet_part_messages{\\"count\\":2}, buddy_quiet_part_nodes{\\"count\\":1}"}'
    );
  });
});
