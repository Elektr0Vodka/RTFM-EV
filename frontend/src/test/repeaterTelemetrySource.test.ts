import { describe, expect, it } from 'vitest';

import { telemetryPointSource } from '../components/repeater/RepeaterTelemetryHistoryPane';

describe('telemetryPointSource', () => {
  it('reads SNMP rows by their source tag', () => {
    expect(telemetryPointSource({ source: 'snmp', battery_volts: 4.3 })).toBe('snmp');
  });

  it('treats rows without a tag as RF', () => {
    expect(telemetryPointSource({ battery_volts: 4.0 })).toBe('rf');
    expect(telemetryPointSource({ source: 'other' })).toBe('rf');
  });
});
