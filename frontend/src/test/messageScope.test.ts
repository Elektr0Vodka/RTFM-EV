import { describe, expect, it } from 'vitest';

import { classifyMessageScope, formatTransportCode } from '../utils/messageScope';
import { isDirectMessage } from '../utils/pathUtils';
import type { MessagePath } from '../types';

describe('classifyMessageScope', () => {
  it('returns named when a region name resolved', () => {
    expect(classifyMessageScope(0x1234, 'Esperance')).toBe('named');
    // A resolved name wins even if that seems inconsistent with a null code.
    expect(classifyMessageScope(null, 'Esperance')).toBe('named');
  });

  it('returns unknown when scoped but the region is unresolved', () => {
    expect(classifyMessageScope(0x1234, null)).toBe('unknown');
    expect(classifyMessageScope(0, undefined)).toBe('unknown');
  });

  it('returns unscoped when there is no transport code and no region', () => {
    expect(classifyMessageScope(null, null)).toBe('unscoped');
    expect(classifyMessageScope(undefined, undefined)).toBe('unscoped');
  });
});

describe('formatTransportCode', () => {
  it('formats a uint16 as zero-padded uppercase hex', () => {
    expect(formatTransportCode(0x1a2b)).toBe('0x1A2B');
    expect(formatTransportCode(0)).toBe('0x0000');
    expect(formatTransportCode(255)).toBe('0x00FF');
  });
});

describe('isDirectMessage', () => {
  const p = (path: string, path_len: number): MessagePath => ({
    path,
    path_len,
    received_at: 0,
  });

  it('is true when every path is 0 hops', () => {
    expect(isDirectMessage([p('', 0)])).toBe(true);
    expect(isDirectMessage([p('', 0), p('', 0)])).toBe(true);
  });

  it('is false when any path has hops', () => {
    expect(isDirectMessage([p('ab', 1)])).toBe(false);
    expect(isDirectMessage([p('', 0), p('abcd', 2)])).toBe(false);
  });

  it('is false when there is no path info', () => {
    expect(isDirectMessage(null)).toBe(false);
    expect(isDirectMessage([])).toBe(false);
  });
});
