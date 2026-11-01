import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider, useT } from '../../../i18n';
import {
  driveLabel,
  formatDuration,
  formatShare,
  nodeLabel,
} from '../../../wardrive/reports/format';
import { queryString } from '../../../wardrive/reports/types';
import { drive } from './fixtures';

const t = renderHook(() => useT(), { wrapper: I18nProvider }).result.current;

describe('report formatters', () => {
  it('says how long', () => {
    expect(formatDuration(3900, t)).toBe('1 h 5 min');
    expect(formatDuration(720, t)).toBe('12 min');
    expect(formatDuration(59, t)).toBe('59 s');
    expect(formatDuration(-5, t)).toBe('0 s');
  });

  it('shows a share or a dash', () => {
    expect(formatShare(0.62)).toBe('62 %');
    expect(formatShare(null)).toBe('-');
  });

  it('labels a drive by name or start', () => {
    expect(driveLabel(drive({ name: 'Ochtend' }), 'en')).toBe('Ochtend');
    expect(driveLabel(drive(), 'en')).toMatch(/2026/);
  });

  it('labels a node by name, guess mark or short id', () => {
    expect(nodeLabel({ id: 'c3', name: 'Toren', guess: true })).toBe('~Toren');
    expect(nodeLabel({ id: 'c3', name: 'Toren' })).toBe('Toren');
    expect(nodeLabel({ id: 'a1b2c3d4e5f6', name: null })).toBe('a1b2c3');
  });

  it('builds the query with drive repeated', () => {
    expect(queryString({ drive: [3, 4], res: 9, since: undefined, radio_key: '' })).toBe(
      '?drive=3&drive=4&res=9'
    );
    expect(queryString({})).toBe('');
  });
});
