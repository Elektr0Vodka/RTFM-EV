import { describe, expect, it } from 'vitest';

import { countReboots, ratePoints, toChartPoints } from '../components/snmp/snmpSeries';
import type { SnmpHistoryEntry, SnmpValues } from '../types';

function entry(timestamp: number, values: SnmpValues): SnmpHistoryEntry {
  return { timestamp, values };
}

describe('toChartPoints', () => {
  it('keeps numbers and skips rows without one', () => {
    const history = [
      entry(100, { free_heap: 10 }),
      entry(160, { free_heap: null }),
      entry(220, { node_name: 'x' }),
      entry(280, { free_heap: 30 }),
    ];
    expect(toChartPoints(history, 'free_heap')).toEqual([
      { time: 100, value: 10 },
      { time: 280, value: 30 },
    ]);
  });
});

describe('ratePoints', () => {
  it('turns a counter into a per minute rate between two polls', () => {
    const history = [
      entry(1000, { packets_recv: 100, uptime_secs: 500 }),
      entry(1060, { packets_recv: 130, uptime_secs: 560 }),
      entry(1180, { packets_recv: 150, uptime_secs: 680 }),
    ];
    expect(ratePoints(history, 'packets_recv', 60)).toEqual([
      { time: 1060, value: 30 },
      { time: 1180, value: 10 },
    ]);
  });

  it('scales to a percentage for air time (seconds on air per 100 seconds)', () => {
    const history = [
      entry(1000, { total_air_time_secs: 10 }),
      entry(1200, { total_air_time_secs: 16 }),
    ];
    expect(ratePoints(history, 'total_air_time_secs', 100)).toEqual([{ time: 1200, value: 3 }]);
  });

  it('starts over after a reboot instead of drawing a negative spike', () => {
    const history = [
      entry(1000, { packets_recv: 900, uptime_secs: 5000 }),
      entry(1060, { packets_recv: 12, uptime_secs: 30 }),
      entry(1120, { packets_recv: 42, uptime_secs: 90 }),
    ];
    expect(ratePoints(history, 'packets_recv', 60)).toEqual([{ time: 1120, value: 30 }]);
  });

  it('treats a lower uptime as a reboot even when the counter is higher again', () => {
    const history = [
      entry(1000, { packets_recv: 10, uptime_secs: 5000 }),
      entry(1600, { packets_recv: 50, uptime_secs: 400 }),
    ];
    expect(ratePoints(history, 'packets_recv', 60)).toEqual([]);
  });

  it('bridges a poll that did not serve the value and ignores a repeated timestamp', () => {
    const history = [
      entry(1000, { recv_errors: 4 }),
      entry(1060, { recv_errors: null }),
      entry(1120, { recv_errors: 8 }),
      entry(1120, { recv_errors: 9 }),
    ];
    expect(ratePoints(history, 'recv_errors', 60)).toEqual([{ time: 1120, value: 2 }]);
  });

  it('needs two polls', () => {
    expect(ratePoints([entry(1000, { packets_recv: 1 })], 'packets_recv', 60)).toEqual([]);
    expect(ratePoints([], 'packets_recv', 60)).toEqual([]);
  });
});

describe('countReboots', () => {
  it('counts every time the uptime went down', () => {
    const history = [
      entry(1000, { uptime_secs: 100 }),
      entry(1060, { uptime_secs: 160 }),
      entry(1120, { uptime_secs: 20 }),
      entry(1180, { uptime_secs: null }),
      entry(1240, { uptime_secs: 140 }),
      entry(1300, { uptime_secs: 5 }),
    ];
    expect(countReboots(history)).toBe(2);
  });

  it('is zero without a drop', () => {
    expect(countReboots([])).toBe(0);
    expect(countReboots([entry(1, { uptime_secs: 5 }), entry(2, { uptime_secs: 6 })])).toBe(0);
  });
});
