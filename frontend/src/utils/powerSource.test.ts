import { describe, expect, it } from 'vitest';
import {
  classifyPowerSource,
  isDtisName,
  parseHiddenPowerSources,
  resolvePowerSource,
  serializeHiddenPowerSources,
  survivesOutage,
} from './powerSource';

describe('classifyPowerSource', () => {
  it('reads each icon', () => {
    expect(classifyPowerSource('Rpt ⚡')).toBe('Mains');
    expect(classifyPowerSource('Rpt \u{1F50C}')).toBe('Mains');
    expect(classifyPowerSource('Rpt \u{1F50B}')).toBe('Battery');
    expect(classifyPowerSource('Rpt ☀️')).toBe('Solar');
    expect(classifyPowerSource('Rpt \u{1F31E}')).toBe('Solar');
    expect(classifyPowerSource('Rpt \u{1F506}')).toBe('Solar');
  });

  it('matches the word solar case-insensitively', () => {
    expect(classifyPowerSource('Hilltop SOLAR')).toBe('Solar');
  });

  it('combines solar and battery, and solar beats mains', () => {
    expect(classifyPowerSource('☀\u{1F50B} Rpt')).toBe('SolarBattery');
    expect(classifyPowerSource('☀⚡ Rpt')).toBe('Solar');
  });

  it('returns Unknown without a marker or name', () => {
    expect(classifyPowerSource('Plain name')).toBe('Unknown');
    expect(classifyPowerSource(null)).toBe('Unknown');
    expect(classifyPowerSource(undefined)).toBe('Unknown');
  });
});

describe('DTIS nodes', () => {
  it('detects the "DTIS |" name prefix', () => {
    expect(isDtisName('DTIS | NL AMS | 1018WS')).toBe(true);
    expect(isDtisName('dtis|NL RTM')).toBe(true);
    expect(isDtisName('  DTIS  | x')).toBe(true);
    expect(isDtisName('DTIS NL AMS')).toBe(false);
    expect(isDtisName('My DTIS | node')).toBe(false);
    expect(isDtisName(null)).toBe(false);
  });

  it('classifies DTIS as Solar + battery, over any icon', () => {
    expect(classifyPowerSource('DTIS | NL AMS | 1018WS')).toBe('SolarBattery');
    expect(classifyPowerSource('DTIS | NL AMS ⚡')).toBe('SolarBattery');
  });
});

describe('resolvePowerSource', () => {
  it('uses the manual override when set', () => {
    expect(resolvePowerSource({ name: 'Rpt ⚡', power_source: 'battery' })).toBe('Battery');
    expect(resolvePowerSource({ name: 'DTIS | NL AMS', power_source: 'mains' })).toBe('Mains');
    expect(resolvePowerSource({ name: 'Rpt ☀', power_source: 'unknown' })).toBe('Unknown');
    expect(resolvePowerSource({ name: 'Rpt', power_source: 'solar_battery' })).toBe('SolarBattery');
  });

  it('falls back to the name when unset or unrecognised', () => {
    expect(resolvePowerSource({ name: 'Rpt ⚡', power_source: null })).toBe('Mains');
    expect(resolvePowerSource({ name: 'Rpt ⚡' })).toBe('Mains');
    expect(resolvePowerSource({ name: 'DTIS | NL AMS', power_source: 'nuclear' })).toBe(
      'SolarBattery'
    );
    expect(resolvePowerSource({ name: 'Rpt', power_source: 'toString' })).toBe('Unknown');
  });
});

describe('survivesOutage', () => {
  it('only self-supplied sources survive', () => {
    expect(survivesOutage('Battery')).toBe(true);
    expect(survivesOutage('Solar')).toBe(true);
    expect(survivesOutage('SolarBattery')).toBe(true);
    expect(survivesOutage('Mains')).toBe(false);
    expect(survivesOutage('Unknown')).toBe(false);
  });
});

describe('hidden power sources persistence', () => {
  it('round-trips and drops unknown entries', () => {
    const raw = serializeHiddenPowerSources(new Set(['Mains', 'Unknown'] as const));
    expect(parseHiddenPowerSources(raw)).toEqual(new Set(['Mains', 'Unknown']));
    expect(parseHiddenPowerSources('["Mains","Nuclear",3]')).toEqual(new Set(['Mains']));
    expect(parseHiddenPowerSources('not json')).toEqual(new Set());
    expect(parseHiddenPowerSources(null)).toEqual(new Set());
  });
});
