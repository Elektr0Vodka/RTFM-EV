import { describe, expect, it } from 'vitest';

import { parseSarMarker } from '../utils/sarPayloads';

describe('parseSarMarker', () => {
  it('parses the form with a colour index and notes', () => {
    expect(parseSarMarker('S:🔥:1:52.1,5.2:smoke')).toEqual({
      lat: 52.1,
      lon: 5.2,
      label: '🔥 smoke',
      flags: 'color=1',
    });
  });

  it('parses the old form without a colour index', () => {
    expect(parseSarMarker('S:🧑:52.1,5.2')).toEqual({
      lat: 52.1,
      lon: 5.2,
      label: '🧑',
      flags: '',
    });
  });

  it('reads only the first line', () => {
    expect(parseSarMarker('S:📦:3:-33.86,151.2\nsecond line')).toMatchObject({
      lat: -33.86,
      lon: 151.2,
      label: '📦',
    });
  });

  it('ignores custom-map markers and out-of-range or unset points', () => {
    expect(parseSarMarker('S2:{"e":"🔥","m":"x","p":[1,2]}')).toBeNull();
    expect(parseSarMarker('S:🔥:1:95.0,5.0')).toBeNull();
    expect(parseSarMarker('S:🔥:1:0,0')).toBeNull();
    expect(parseSarMarker('see S:🔥:1:52.1,5.2')).toBeNull();
  });
});
