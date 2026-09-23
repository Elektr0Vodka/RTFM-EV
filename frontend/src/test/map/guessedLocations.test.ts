import { describe, it, expect } from 'vitest';
import {
  ESTIMATED_LORA_RANGE_KM,
  GUESSED_LOCATION_STALE_SECONDS,
  buildRepeaterAnchorIndex,
  anchorsForPaths,
  filterConsistentAnchors,
  weightedCentre,
  guessSeed,
  offsetGuessedPosition,
  computeGuessedLocations,
  type GuessAnchor,
} from '../../map/guessedLocations';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  type Contact,
  type ContactAdvertPath,
} from '../../types';

const now = 1_000_000; // seconds

const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: now,
  on_radio: true,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

const advertPath = (over: Partial<ContactAdvertPath>): ContactAdvertPath => ({
  path: '',
  path_len: 1,
  next_hop: null,
  first_seen: 0,
  last_seen: 0,
  heard_count: 1,
  ...over,
});

describe('buildRepeaterAnchorIndex', () => {
  const repeater = contact({
    public_key: 'aabbccdd11223344',
    type: CONTACT_TYPE_REPEATER,
    lat: 52.0,
    lon: 5.0,
  });

  it('indexes a located repeater under both its 2- and 3-byte prefixes', () => {
    const index = buildRepeaterAnchorIndex([repeater]);
    expect(index.get('aabb')).toEqual({ public_key: repeater.public_key, lat: 52.0, lon: 5.0 });
    expect(index.get('aabbcc')).toEqual({ public_key: repeater.public_key, lat: 52.0, lon: 5.0 });
    // No 1-byte entry is ever produced (nothing reads it, but confirm the width set).
    expect(index.get('aa')).toBeUndefined();
  });

  it('ignores non-repeater contacts', () => {
    const client = contact({
      public_key: 'aabbccdd11223344',
      type: CONTACT_TYPE_CLIENT,
      lat: 52.0,
      lon: 5.0,
    });
    expect(buildRepeaterAnchorIndex([client]).size).toBe(0);
  });

  it('ignores a repeater with no known location', () => {
    const unlocated = contact({
      public_key: 'aabbccdd11223344',
      type: CONTACT_TYPE_REPEATER,
      lat: null,
      lon: null,
    });
    expect(buildRepeaterAnchorIndex([unlocated]).size).toBe(0);
  });

  it('falls back to a manual location when advertised coordinates are unset', () => {
    const manual = contact({
      public_key: 'aabbccdd11223344',
      type: CONTACT_TYPE_REPEATER,
      lat: null,
      lon: null,
      manual_lat: 51.0,
      manual_lon: 4.0,
    });
    const index = buildRepeaterAnchorIndex([manual]);
    expect(index.get('aabb')).toEqual({ public_key: manual.public_key, lat: 51.0, lon: 4.0 });
  });

  it('the first repeater wins a prefix collision', () => {
    const r1 = contact({
      public_key: 'aabb000000000000',
      type: CONTACT_TYPE_REPEATER,
      lat: 1,
      lon: 1,
    });
    const r2 = contact({
      public_key: 'aabb111111111111',
      type: CONTACT_TYPE_REPEATER,
      lat: 2,
      lon: 2,
    });
    const index = buildRepeaterAnchorIndex([r1, r2]);
    expect(index.get('aabb')).toEqual({ public_key: r1.public_key, lat: 1, lon: 1 });
  });
});

describe('anchorsForPaths', () => {
  const anchor2: GuessAnchor = { public_key: 'r2byte00', lat: 52.0, lon: 5.0 };
  const anchor3: GuessAnchor = { public_key: 'r3byte00', lat: 52.1, lon: 5.1 };
  const index = new Map<string, GuessAnchor>([
    ['ab12', anchor2],
    ['ab1234', anchor3],
  ]);

  it('resolves a 2-byte next_hop to its anchor', () => {
    const anchors = anchorsForPaths([advertPath({ next_hop: 'AB12' })], index);
    expect(anchors).toEqual([anchor2]);
  });

  it('resolves a 3-byte next_hop to its anchor', () => {
    const anchors = anchorsForPaths([advertPath({ next_hop: 'ab1234' })], index);
    expect(anchors).toEqual([anchor3]);
  });

  it('skips a 1-byte next_hop (excluded width)', () => {
    const oneByteIndex = new Map<string, GuessAnchor>([['ab', anchor2]]);
    const anchors = anchorsForPaths([advertPath({ next_hop: 'ab' })], oneByteIndex);
    expect(anchors).toEqual([]);
  });

  it('skips a direct path with no next_hop', () => {
    expect(anchorsForPaths([advertPath({ next_hop: null })], index)).toEqual([]);
  });

  it('skips a hop that matches no located repeater', () => {
    expect(anchorsForPaths([advertPath({ next_hop: 'ffff' })], index)).toEqual([]);
  });

  it('deduplicates by repeater pubkey across several paths', () => {
    const anchors = anchorsForPaths(
      [
        advertPath({ next_hop: 'ab12' }),
        advertPath({ next_hop: 'ab12' }),
        advertPath({ next_hop: 'ab1234' }),
      ],
      index
    );
    expect(anchors).toEqual([anchor2, anchor3]);
  });
});

describe('filterConsistentAnchors', () => {
  // A and B are ~11 km apart (within 2x a 15 km range estimate). C is far away.
  const a: GuessAnchor = { public_key: 'a', lat: 52.0, lon: 5.0 };
  const b: GuessAnchor = { public_key: 'b', lat: 52.1, lon: 5.0 };
  const c: GuessAnchor = { public_key: 'c', lat: 0.0, lon: 100.0 };

  it('passes 0 or 1 anchors through unchanged', () => {
    expect(filterConsistentAnchors([])).toEqual([]);
    expect(filterConsistentAnchors([a])).toEqual([a]);
  });

  it('keeps anchors that have a neighbour within 2x the range', () => {
    const result = filterConsistentAnchors([a, b], ESTIMATED_LORA_RANGE_KM);
    expect(result).toEqual([a, b]);
  });

  it('drops an isolated anchor farther than 2x the range from every other anchor', () => {
    const result = filterConsistentAnchors([a, b, c], ESTIMATED_LORA_RANGE_KM);
    expect(result).toEqual([a, b]);
  });

  it('drops every anchor when none are mutually consistent', () => {
    const farAway: GuessAnchor = { public_key: 'd', lat: -33.0, lon: 151.0 };
    const result = filterConsistentAnchors([c, farAway], ESTIMATED_LORA_RANGE_KM);
    expect(result).toEqual([]);
  });
});

describe('weightedCentre', () => {
  it('divides by the sum of applied weights, not the anchor count (fixes the meshcore-open bug)', () => {
    const a: GuessAnchor = { public_key: 'a', lat: 0, lon: 0 };
    const b: GuessAnchor = { public_key: 'b', lat: 2, lon: 4 };
    // weights: a=1, b=0.5, sum=1.5. Correct centre: (0*1+2*0.5)/1.5, (0*1+4*0.5)/1.5.
    const centre = weightedCentre([a, b]);
    expect(centre.lat).toBeCloseTo(2 / 3, 10);
    expect(centre.lon).toBeCloseTo(4 / 3, 10);
    // meshcore-open's buggy version (divide by anchors.length = 2) would give 0.5 and 1.
    expect(centre.lat).not.toBeCloseTo(0.5, 5);
    expect(centre.lon).not.toBeCloseTo(1, 5);
  });

  it('returns the single anchor unchanged for one anchor', () => {
    const a: GuessAnchor = { public_key: 'a', lat: 10, lon: 20 };
    const centre = weightedCentre([a]);
    expect(centre).toEqual({ lat: 10, lon: 20 });
  });

  it('biases toward the first (freshest) anchor over a third, less than a pure average would', () => {
    const a: GuessAnchor = { public_key: 'a', lat: 0, lon: 0 };
    const b: GuessAnchor = { public_key: 'b', lat: 3, lon: 0 };
    const c: GuessAnchor = { public_key: 'c', lat: 3, lon: 0 };
    const centre = weightedCentre([a, b, c]);
    const plainAverage = (0 + 3 + 3) / 3;
    expect(centre.lat).toBeLessThan(plainAverage);
  });
});

describe('guessSeed / offsetGuessedPosition', () => {
  it('is deterministic for the same public key', () => {
    const key = 'aabbccddeeff00112233';
    expect(guessSeed(key)).toBe(guessSeed(key));
    const anchor = { lat: 52.0, lon: 5.0 };
    expect(offsetGuessedPosition(anchor, key, 330)).toEqual(
      offsetGuessedPosition(anchor, key, 330)
    );
  });

  it('produces different angles for different public keys', () => {
    const anchor = { lat: 52.0, lon: 5.0 };
    const p1 = offsetGuessedPosition(anchor, 'aa11223344556677', 330);
    const p2 = offsetGuessedPosition(anchor, 'ff99887766554433', 330);
    expect(p1).not.toEqual(p2);
  });

  it('offsets by roughly the requested radius', () => {
    const anchor = { lat: 0, lon: 0 };
    const p = offsetGuessedPosition(anchor, 'aa11223344556677', 330);
    const dLatM = (p.lat - anchor.lat) * 111_320;
    const dLonM = (p.lon - anchor.lon) * 111_320; // cos(0) = 1 at the equator
    const distM = Math.hypot(dLatM, dLonM);
    expect(distM).toBeCloseTo(330, 0);
  });
});

describe('computeGuessedLocations', () => {
  const repeaterNear = contact({
    public_key: 'aabb00000000000000000000000000000000000000000000000000000000000000',
    type: CONTACT_TYPE_REPEATER,
    lat: 52.0,
    lon: 5.0,
  });
  const repeaterFar2b = contact({
    public_key: 'ccdd00000000000000000000000000000000000000000000000000000000000000',
    type: CONTACT_TYPE_REPEATER,
    lat: 52.05,
    lon: 5.0,
  }); // ~5.5km from repeaterNear: mutually consistent within 2x15km.

  it('guesses a single-anchor position offset from the anchor by 330m', () => {
    const unlocated = contact({ public_key: 'target1', lat: null, lon: null, last_seen: now });
    const summaries = [
      { public_key: unlocated.public_key, paths: [advertPath({ next_hop: 'aabb' })] },
    ];
    const guesses = computeGuessedLocations([repeaterNear, unlocated], summaries, now);
    expect(guesses).toHaveLength(1);
    const g = guesses[0];
    expect(g.public_key).toBe(unlocated.public_key);
    expect(g.highConfidence).toBe(false);
    expect(g.anchors).toEqual([{ public_key: repeaterNear.public_key, lat: 52.0, lon: 5.0 }]);
    const distKm = Math.hypot(
      (g.lat - 52.0) * 111.32,
      (g.lon - 5.0) * 111.32 * Math.cos((52 * Math.PI) / 180)
    );
    expect(distKm).toBeCloseTo(0.33, 1);
  });

  it('combines two consistent anchors with a weighted centre and marks high confidence', () => {
    const unlocated = contact({ public_key: 'target2', lat: null, lon: null, last_seen: now });
    const summaries = [
      {
        public_key: unlocated.public_key,
        paths: [advertPath({ next_hop: 'aabb' }), advertPath({ next_hop: 'ccdd' })],
      },
    ];
    const guesses = computeGuessedLocations(
      [repeaterNear, repeaterFar2b, unlocated],
      summaries,
      now
    );
    expect(guesses).toHaveLength(1);
    expect(guesses[0].highConfidence).toBe(true);
    expect(guesses[0].anchors).toHaveLength(2);
  });

  it('excludes a contact that already has a known location', () => {
    const located = contact({ public_key: 'target3', lat: 10, lon: 10, last_seen: now });
    const summaries = [
      { public_key: located.public_key, paths: [advertPath({ next_hop: 'aabb' })] },
    ];
    expect(computeGuessedLocations([repeaterNear, located], summaries, now)).toEqual([]);
  });

  it('excludes a contact not heard within the last 24h', () => {
    const stale = contact({
      public_key: 'target4',
      lat: null,
      lon: null,
      last_seen: now - GUESSED_LOCATION_STALE_SECONDS - 1,
    });
    const summaries = [{ public_key: stale.public_key, paths: [advertPath({ next_hop: 'aabb' })] }];
    expect(computeGuessedLocations([repeaterNear, stale], summaries, now)).toEqual([]);
  });

  it('excludes a contact with only 1-byte hops in its known paths', () => {
    const unlocated = contact({ public_key: 'target5', lat: null, lon: null, last_seen: now });
    const summaries = [
      { public_key: unlocated.public_key, paths: [advertPath({ next_hop: 'aa' })] },
    ];
    expect(computeGuessedLocations([repeaterNear, unlocated], summaries, now)).toEqual([]);
  });

  it('excludes a contact never heard directly (never seen, no last_seen)', () => {
    const neverSeen = contact({ public_key: 'target6', lat: null, lon: null, last_seen: null });
    const summaries = [
      { public_key: neverSeen.public_key, paths: [advertPath({ next_hop: 'aabb' })] },
    ];
    expect(computeGuessedLocations([repeaterNear, neverSeen], summaries, now)).toEqual([]);
  });
});
