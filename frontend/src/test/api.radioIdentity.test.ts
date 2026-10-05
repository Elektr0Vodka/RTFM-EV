import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

let mockFetch: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

beforeEach(() => {
  mockFetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    );
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

const url = (i: number) => String(mockFetch.mock.calls[i][0]);

describe('radio identity api (plan 18)', () => {
  it('omits the radio filter by default', async () => {
    await api.getBatteryRange(1, 2);
    await api.getNoiseFloorHistory(1, 2);
    await api.getAirtimeRange(1, 2, 10);
    await api.getBatteryHistory();
    expect(url(0)).toMatch(/\/statistics\/battery\/range\?start_ts=1&end_ts=2$/);
    expect(url(1)).toMatch(/\/statistics\/noise-floor\?start_ts=1&end_ts=2$/);
    expect(url(2)).toMatch(/\/statistics\/airtime\/range\?start_ts=1&end_ts=2&bin_count=10$/);
    expect(url(3)).toMatch(/\/statistics\/battery$/);
  });

  it('adds radio_id or unassigned', async () => {
    await api.getBatteryRange(1, 2, { radioId: 7 });
    await api.getAirtimeRange(1, 2, 10, { unassigned: true });
    await api.getBatteryHistory({ radioId: 3 });
    expect(url(0)).toContain('/statistics/battery/range?start_ts=1&end_ts=2&radio_id=7');
    expect(url(1)).toContain('bin_count=10&unassigned=true');
    expect(url(2)).toMatch(/\/statistics\/battery\?radio_id=3$/);
  });

  it('posts answers to the registry endpoints', async () => {
    await api.replaceRadio(2, {
      old_id: 1,
      carry_stats: true,
      carry_owned: false,
      carry_note: true,
    });
    await api.answerLegacyHistory(2, true);
    await api.removeRadioLink(1);
    expect(url(0)).toContain('/radio-identities/2/replace');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      old_id: 1,
      carry_stats: true,
      carry_owned: false,
      carry_note: true,
    });
    expect(url(1)).toContain('/radio-identities/2/legacy-history');
    expect(mockFetch.mock.calls[2][1].method).toBe('DELETE');
  });

  it('removes a radio, keeping or deleting its stat history', async () => {
    await api.removeRadio(3, false);
    await api.removeRadio(4, true);
    expect(url(0)).toMatch(/\/radio-identities\/3\?delete_stats=false$/);
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    expect(url(1)).toMatch(/\/radio-identities\/4\?delete_stats=true$/);
  });
});
