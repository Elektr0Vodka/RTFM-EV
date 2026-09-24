import { describe, it, expect } from 'vitest';
import { findMgrsReferences } from '../utils/mgrsText';
import { tokenizeMessageText } from '../utils/chatEntities';

// Same reference vectors as tests/test_mgrs.py (from mgrs@2.2.0 toPoint).
describe('findMgrsReferences', () => {
  it('finds a spaced reference inside text', () => {
    const [ref] = findMgrsReferences('meet at 31U FT 45332 73249 at noon');
    expect(ref.raw).toBe('31U FT 45332 73249');
    expect(ref.start).toBe(8);
    expect(ref.lat).toBeCloseTo(52.09070099579618, 9);
    expect(ref.lon).toBeCloseTo(5.121397980233555, 9);
    expect(ref.precisionM).toBe(1);
  });

  it('finds compact references and reports their precision', () => {
    const [ref] = findMgrsReferences('31UFT45337324');
    expect(ref.precisionM).toBe(10);
    expect(ref.lat).toBeCloseTo(52.090659908375144, 9);
  });

  it.each([
    ['31u ft 4533 7324', 'lower case'],
    ['10cab12345', 'hex-like'],
    ['31U FT 4533 73249', 'unequal halves'],
    ['31UFT4533732', 'odd digit count'],
    ['131UFT45337324', 'zone glued to a digit'],
    ['61UFT45337324', 'zone out of range'],
    ['31YFT45337324', 'polar band'],
  ])('rejects %s (%s)', (text) => {
    expect(findMgrsReferences(text)).toEqual([]);
  });
});

describe('tokenizeMessageText with MGRS', () => {
  it('turns an MGRS reference into a coordinate token when coordinates are parsed', () => {
    const tokens = tokenizeMessageText('at 31U FT 45332 73249!', {
      parsePubkeys: false,
      parseCoordinates: true,
      linkifyUrls: false,
    });
    expect(tokens.map((t) => t.kind)).toEqual(['text', 'coordinate', 'text']);
    const coord = tokens[1] as Extract<(typeof tokens)[number], { kind: 'coordinate' }>;
    expect(coord.mgrs).toBe(true);
    expect(coord.raw).toBe('31U FT 45332 73249');
  });

  it('leaves MGRS as text when coordinate parsing is off', () => {
    const tokens = tokenizeMessageText('at 31U FT 45332 73249', {
      parsePubkeys: false,
      parseCoordinates: false,
      linkifyUrls: false,
    });
    expect(tokens).toEqual([{ kind: 'text', value: 'at 31U FT 45332 73249' }]);
  });
});
