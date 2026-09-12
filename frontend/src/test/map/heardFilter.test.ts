import { describe, it, expect } from 'vitest';
import {
  passesHeardFilter,
  isContactVisibleForFilters,
  type HeardFilterMode,
} from '../../map/heardFilter';

describe('passesHeardFilter', () => {
  it('shows every contact in "all" mode', () => {
    expect(passesHeardFilter(1_700_000_000, 'all')).toBe(true);
    expect(passesHeardFilter(null, 'all')).toBe(true);
    expect(passesHeardFilter(undefined, 'all')).toBe(true);
  });

  it('shows only server-heard contacts in "hide" mode', () => {
    expect(passesHeardFilter(1_700_000_000, 'hide')).toBe(true);
    expect(passesHeardFilter(null, 'hide')).toBe(false);
    expect(passesHeardFilter(undefined, 'hide')).toBe(false);
  });

  it('shows only never-heard contacts in "only" mode', () => {
    expect(passesHeardFilter(null, 'only')).toBe(true);
    expect(passesHeardFilter(undefined, 'only')).toBe(true);
    expect(passesHeardFilter(1_700_000_000, 'only')).toBe(false);
  });
});

describe('isContactVisibleForFilters', () => {
  const base = { isFocused: false, isWithinSinceWindow: true };

  it('preserves current behaviour in "all" mode: gated only by the since window', () => {
    expect(isContactVisibleForFilters({ ...base, lastSeen: 1_700_000_000, mode: 'all' })).toBe(
      true
    );
    expect(
      isContactVisibleForFilters({
        ...base,
        lastSeen: 1_700_000_000,
        mode: 'all',
        isWithinSinceWindow: false,
      })
    ).toBe(false);
  });

  it('always shows the focused contact, whatever the filter', () => {
    const modes: HeardFilterMode[] = ['all', 'hide', 'only'];
    for (const mode of modes) {
      expect(
        isContactVisibleForFilters({
          lastSeen: 1_700_000_000,
          mode,
          isFocused: true,
          isWithinSinceWindow: false,
        })
      ).toBe(true);
    }
  });

  it('hides never-heard contacts in "hide" mode', () => {
    expect(
      isContactVisibleForFilters({
        ...base,
        lastSeen: null,
        mode: 'hide',
        isWithinSinceWindow: false,
      })
    ).toBe(false);
    expect(isContactVisibleForFilters({ ...base, lastSeen: 1_700_000_000, mode: 'hide' })).toBe(
      true
    );
  });

  it('shows never-heard contacts in "only" mode even when the since window would exclude them', () => {
    expect(
      isContactVisibleForFilters({
        ...base,
        lastSeen: null,
        mode: 'only',
        isWithinSinceWindow: false,
      })
    ).toBe(true);
  });

  it('hides server-heard contacts in "only" mode', () => {
    expect(isContactVisibleForFilters({ ...base, lastSeen: 1_700_000_000, mode: 'only' })).toBe(
      false
    );
  });
});
