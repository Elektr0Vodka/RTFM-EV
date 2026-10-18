import { describe, expect, it } from 'vitest';
import { shareFilename } from '../../share/filename';

describe('shareFilename', () => {
  it('names the file after the card kind and local time', () => {
    expect(shareFilename('trace', new Date(2026, 9, 18, 9, 5))).toBe(
      'rtfm-ev-trace-2026-10-18-0905'
    );
  });
});
