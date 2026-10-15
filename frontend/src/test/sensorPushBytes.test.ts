import { describe, expect, it } from 'vitest';

import { thresholdBytes } from '../utils/sensorPush';

describe('thresholdBytes', () => {
  const supported = { temperature: 4, humidity: 4, voltage: 4, 'digital input': 3 };

  it('sums entry sizes', () => {
    expect(
      thresholdBytes(
        [
          { channel: 1, type_name: 'temperature', min_delta: 0.5 },
          { channel: 2, type_name: 'voltage', min_delta: 0.1 },
        ],
        supported
      )
    ).toBe(8);
  });

  it('counts unknown types as zero', () => {
    expect(thresholdBytes([{ channel: 1, type_name: 'gps', min_delta: 1 }], supported)).toBe(0);
  });
});
