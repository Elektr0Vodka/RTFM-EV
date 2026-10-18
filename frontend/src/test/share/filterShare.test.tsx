import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const renderFilterCard = vi.fn();
vi.mock('../../share/cards/filterResultRender', () => ({
  renderFilterCard: (...args: unknown[]) => renderFilterCard(...args),
}));
vi.mock('../../share/shareBrand', () => ({
  loadShareBrand: vi.fn().mockResolvedValue({ name: 'RTFM-EV', icon: null }),
}));
const api = vi.hoisted(() => ({ getSpamGuardAirtime: vi.fn() }));
vi.mock('../../api', () => ({ api }));

import {
  useCompanionFilterBuild,
  useHostRepeaterFilterBuild,
  useRtfmFilterBuild,
  useSnmpFilterBuild,
} from '../../share/cards/useFilterShare';
import type { CardText } from '../../share/cardChrome';
import type { FilterResultModel } from '../../share/cards/filterResult';
import type { FilterStatsReport } from '../../utils/filterStatsReport';
import type { HostRepeaterStats, SnmpHistoryEntry } from '../../types';

const opts = { hidePosition: false, noMap: false, flags: {} };
const lastText = () =>
  renderFilterCard.mock.calls[renderFilterCard.mock.calls.length - 1][1] as CardText;
const lastModel = () =>
  renderFilterCard.mock.calls[renderFilterCard.mock.calls.length - 1][0] as FilterResultModel;

beforeEach(() => {
  vi.clearAllMocks();
  renderFilterCard.mockResolvedValue({ png: new Blob(['p'], { type: 'image/png' }) });
  api.getSpamGuardAirtime.mockResolvedValue({
    airtime_ms: 360000,
    from_ts: 0,
    to_ts: 1,
    partial: false,
  });
});

const snmpHistory: SnmpHistoryEntry[] = [
  {
    timestamp: 0,
    values: {
      filter_channel_drops: 10,
      filter_rate_limit_drops: 0,
      filter_air_saved_ms: 0,
      filter_dry_run: 0,
    },
  },
  {
    timestamp: 3600,
    values: {
      filter_channel_drops: 40,
      filter_rate_limit_drops: 5,
      filter_air_saved_ms: 90000,
      filter_dry_run: 0,
    },
  },
];

describe('useSnmpFilterBuild (5a repeater)', () => {
  it('builds reasons, airtime and title from the SNMP history', async () => {
    const { result } = renderHook(() =>
      useSnmpFilterBuild({
        name: 'RPT-1',
        history: snmpHistory,
        group: 'filter',
        windowLabel: '24h',
      })
    );
    await result.current!(opts);
    const text = lastText();
    expect(text.title).toBe("What RPT-1's filter did not repeat");
    expect(text.kicker).toBe('Filter results, 24h');
    expect(lastModel().reasons.map((r) => [r.label, r.value])).toEqual([
      ['Blocked-channel drops', 30],
      ['Rate-limit drops', 5],
    ]);
    expect(text.figures.map((f) => f.label)).toContain('airtime saved');
    // The top reason reads as its share, with the reason as the label (a long
    // reason name does not fit the big figure value).
    expect(text.figures).toContainEqual({ value: '86 %', label: 'Blocked-channel drops' });
  });

  it('says "would not have repeated" in dry run', async () => {
    const dry = snmpHistory.map((r) => ({ ...r, values: { ...r.values, filter_dry_run: 1 } }));
    const { result } = renderHook(() =>
      useSnmpFilterBuild({ name: 'RPT-1', history: dry, group: 'filter', windowLabel: '24h' })
    );
    await result.current!(opts);
    expect(lastText().title).toBe("What RPT-1's filter would not have repeated");
  });

  it('words the figures as "would have" in dry run', async () => {
    const dry = snmpHistory.map((r) => ({ ...r, values: { ...r.values, filter_dry_run: 1 } }));
    const { result } = renderHook(() =>
      useSnmpFilterBuild({ name: 'RPT-1', history: dry, group: 'filter', windowLabel: '24h' })
    );
    await result.current!(opts);
    const labels = lastText().figures.map((f) => f.label);
    expect(labels).toContain('packets it would not have repeated');
    expect(labels).toContain('airtime it would have saved');
    expect(labels).not.toContain('packets not repeated');
  });

  it('is null without at least two polls', () => {
    const { result } = renderHook(() =>
      useSnmpFilterBuild({
        name: 'RPT-1',
        history: snmpHistory.slice(0, 1),
        group: 'filter',
        windowLabel: '24h',
      })
    );
    expect(result.current).toBeNull();
  });
});

describe('useCompanionFilterBuild (5b own radio)', () => {
  it('uses the stored totals and bins, with no airtime', async () => {
    const history = {
      bins: [
        { timestamp: 0, malformed: 1, age: 0, path: 0, sender: 3, text: 0 },
        { timestamp: 1, malformed: 0, age: 0, path: 0, sender: 4, text: 2 },
      ],
      totals: { malformed: 1, age: 0, path: 0, sender: 7, text: 2 },
    };
    const { result } = renderHook(() =>
      useCompanionFilterBuild({ name: 'Base', history, windowLabel: '7d' })
    );
    await result.current!(opts);
    expect(lastText().title).toBe("What Base's filter hid");
    expect(lastModel().total).toBe(10);
    expect(lastModel().bins).toEqual([4, 6]);
    expect(lastText().figures.map((f) => f.label)).not.toContain('airtime saved');
  });
});

const report = {
  window: { start_ts: 1000, end_ts: 2000, bucket_seconds: 60, channel: null },
  totals: { messages: 400, spam: 50, malformed: 10, duplicate: 20, bot_now: 30, flagged: 100 },
  series: [
    { bucket_ts: 1000, flagged: 40 },
    { bucket_ts: 1060, flagged: 60 },
  ],
  senders: [{ name: 'SpamBot' }, { name: 'WX' }, { name: 'Echo' }, { name: 'Fourth' }],
  spam_guard_enabled: true,
} as unknown as FilterStatsReport;

describe('useRtfmFilterBuild (5c)', () => {
  it('fetches Spam Guard airtime when no channel is selected', async () => {
    const { result } = renderHook(() =>
      useRtfmFilterBuild({ report, channel: '', channelLabel: 'All channels', windowLabel: '24h' })
    );
    await result.current!(opts);
    expect(api.getSpamGuardAirtime).toHaveBeenCalledWith(1000, 2000);
    expect(lastText().figures.map((f) => f.label)).toContain('airtime saved');
    expect(lastModel().total).toBe(100);
    expect(lastText().quote).toBeUndefined();
  });

  it('leaves out airtime and does not ask for it with a channel selected', async () => {
    const { result } = renderHook(() =>
      useRtfmFilterBuild({ report, channel: 'abc', channelLabel: '#public', windowLabel: '24h' })
    );
    await result.current!(opts);
    expect(api.getSpamGuardAirtime).not.toHaveBeenCalled();
    expect(lastText().figures.map((f) => f.label)).not.toContain('airtime saved');
  });

  it('names up to three sources only when asked', async () => {
    const { result } = renderHook(() =>
      useRtfmFilterBuild({ report, channel: '', channelLabel: 'All channels', windowLabel: '24h' })
    );
    await result.current!({ ...opts, flags: { sources: true } });
    expect(lastText().quote).toBe('Top sources: SpamBot, WX, Echo');
  });
});

describe('useHostRepeaterFilterBuild (5d)', () => {
  it('says the host repeater is off when it is not running', async () => {
    const stats = {
      active: false,
      tx: { armed: false },
      lifetime: {
        since: 1_790_000_000,
        runs: 2,
        observed: 10,
        would_forward: 4,
        would_drop: 6,
        saved_airtime_total_ms: 0,
      },
    } as unknown as HostRepeaterStats;
    const { result } = renderHook(() => useHostRepeaterFilterBuild({ stats }));
    await result.current!(opts);
    expect(lastText().kicker).toContain('now off');
  });

  it('words lifetime totals neutrally and has no history to animate', async () => {
    const stats = {
      active: true,
      tx: { armed: false },
      lifetime: {
        since: 1_790_000_000,
        runs: 3,
        observed: 9000,
        would_forward: 3580,
        would_drop: 5120,
        saved_airtime_total_ms: 2_280_000,
      },
    } as unknown as HostRepeaterStats;
    const { result } = renderHook(() => useHostRepeaterFilterBuild({ stats }));
    await result.current!(opts);
    expect(lastModel().bins).toEqual([]);
    expect(lastText().title).toBe("What RTFM-EV's host repeater judged");
    expect(lastText().kicker).toContain('shadow');
    expect(lastModel().reasons.map((r) => r.label)).toEqual([
      'judged to drop',
      'judged to forward',
    ]);
  });
});
