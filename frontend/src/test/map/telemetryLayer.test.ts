import { describe, it, expect } from 'vitest';
import {
  buildTelemetryFeatures,
  batteryLevelBucket,
  ageStr,
  STALE_SEC,
} from '../../map/layers/telemetryLayer';
import { CONTACT_TYPE_CLIENT, type Contact, type LatestTelemetry } from '../../types';

const now = 1_000_000;
const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: 52,
  lon: 5,
  last_seen: now,
  on_radio: true,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

describe('batteryLevelBucket', () => {
  it('buckets battery volts to 0..4 (full -> 4, empty -> 0)', () => {
    expect(batteryLevelBucket(4.2)).toBe(4);
    expect(batteryLevelBucket(3.1)).toBe(0);
    expect(batteryLevelBucket(3.7)).toBeGreaterThanOrEqual(1);
    expect(batteryLevelBucket(3.7)).toBeLessThanOrEqual(3);
  });
});

describe('ageStr', () => {
  it('formats compact ages', () => {
    expect(ageStr(10)).toBe('now');
    expect(ageStr(300)).toBe('5m');
    expect(ageStr(3 * 3600)).toBe('3h');
    expect(ageStr(2 * 86400)).toBe('2d');
  });
});

describe('buildTelemetryFeatures', () => {
  const latest: Record<string, LatestTelemetry> = {
    aa: { timestamp: now - 60, battery_volts: 4.0, temperature: 21.5, source: 'repeater' },
    bb: { timestamp: now - 60, battery_volts: null, temperature: 9, source: 'contact' },
    old: {
      timestamp: now - STALE_SEC - 10,
      battery_volts: 3.5,
      temperature: null,
      source: 'repeater',
    },
    nodata: { timestamp: now - 60, battery_volts: null, temperature: null, source: 'contact' },
  };

  it('joins telemetry, flags stale, and drops nodes without coords or telemetry', () => {
    const fc = buildTelemetryFeatures(
      [
        contact({ public_key: 'aa' }),
        contact({ public_key: 'bb' }),
        contact({ public_key: 'old' }),
        contact({ public_key: 'nodata' }),
        contact({ public_key: 'zz' }), // no latest entry
        contact({ public_key: 'nocoord', lat: null }),
      ],
      latest,
      now
    );
    const byId = Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties]));

    expect(byId.aa.battLevel).toBeGreaterThanOrEqual(0);
    expect(byId.aa.label).toContain('22°'); // rounded temp
    expect(byId.aa.stale).toBe(false);

    expect(byId.bb.battLevel).toBe(-1); // temperature-only node

    expect(byId.old.stale).toBe(true);

    expect(byId.nodata).toBeUndefined(); // neither battery nor temp
    expect(byId.zz).toBeUndefined(); // no telemetry reading
    expect(byId.nocoord).toBeUndefined(); // no coordinates
  });
});
