import { describe, expect, it, vi } from 'vitest';
import { buildLinkPopup } from '../../map/linkPopup';

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe('buildLinkPopup', () => {
  it('shows names, count, distance and opens details', () => {
    const onDetails = vi.fn();
    const el = buildLinkPopup(
      {
        a: 'aa',
        b: 'bb',
        count: 4,
        lastSeen: 100,
        coords: [
          [5, 52],
          [5, 52.1],
        ],
      },
      {
        t,
        nameFor: (pk) => (pk === 'aa' ? 'Alpha' : 'Bravo'),
        formatTime: () => 'T',
        onDetails,
      }
    );
    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).toContain('Bravo');
    expect(el.textContent).toContain('map_link_popup_packets:{"count":4}');
    expect(el.textContent).toContain('map_link_popup_distance:{"km":"11.1"}');
    el.querySelector('button')!.click();
    expect(onDetails).toHaveBeenCalledWith('aa', 'bb');
  });

  it('omits distance without coordinates', () => {
    const el = buildLinkPopup(
      { a: 'aa', b: 'bb', count: 1, lastSeen: 1, coords: [] },
      { t, nameFor: (pk) => pk, formatTime: () => 'T', onDetails: vi.fn() }
    );
    expect(el.textContent).not.toContain('map_link_popup_distance');
  });
});
