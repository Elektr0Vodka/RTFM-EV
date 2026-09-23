import { describe, expect, it } from 'vitest';
import { resolveLinkWindow, localDateTimeToEpochSec, isRelativeLinkAge } from '../../map/linkAge';

const NOW = 1_000_000;
const PRESETS = [
  { id: '24h', seconds: 86400 },
  { id: 'all', seconds: null },
];

describe('resolveLinkWindow', () => {
  it('follows the node window', () => {
    expect(
      resolveLinkWindow({
        follow: true,
        nodeWindow: { since: 5, until: 9 },
        presetId: '24h',
        presets: PRESETS,
        customFrom: '',
        customUntil: '',
        nowSec: NOW,
      })
    ).toEqual({ since: 5, until: 9 });
  });

  it('uses its own preset when not following', () => {
    expect(
      resolveLinkWindow({
        follow: false,
        nodeWindow: { since: 5, until: 9 },
        presetId: '24h',
        presets: PRESETS,
        customFrom: '',
        customUntil: '',
        nowSec: NOW + 0.7,
      })
    ).toEqual({ since: NOW - 86400, until: null });
  });

  it('all means unbounded', () => {
    expect(
      resolveLinkWindow({
        follow: false,
        nodeWindow: { since: 5, until: 9 },
        presetId: 'all',
        presets: PRESETS,
        customFrom: '',
        customUntil: '',
        nowSec: NOW,
      })
    ).toEqual({ since: null, until: null });
  });

  it('custom range parses both bounds', () => {
    const from = '2026-01-02T03:04';
    const w = resolveLinkWindow({
      follow: false,
      nodeWindow: { since: null, until: null },
      presetId: 'custom',
      presets: PRESETS,
      customFrom: from,
      customUntil: '',
      nowSec: NOW,
    });
    expect(w).toEqual({ since: Math.floor(new Date(from).getTime() / 1000), until: null });
  });

  it('localDateTimeToEpochSec handles empty and invalid', () => {
    expect(localDateTimeToEpochSec('')).toBeNull();
    expect(localDateTimeToEpochSec('nope')).toBeNull();
  });

  it('isRelativeLinkAge', () => {
    expect(isRelativeLinkAge(false, '24h', PRESETS)).toBe(true);
    expect(isRelativeLinkAge(false, 'all', PRESETS)).toBe(false);
    expect(isRelativeLinkAge(false, 'custom', PRESETS)).toBe(false);
    expect(isRelativeLinkAge(true, '24h', PRESETS)).toBe(false);
  });
});
