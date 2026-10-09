import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  // setup.ts raises this from Testing Library's 1 s. A wait that needs an
  // asynchronous render (a lazy component, a fetched list) settles within a
  // few hundred ms on an idle machine, and was measured past 1 s under the
  // full parallel suite. Dropping the setting brings those failures back.
  it('gives waitFor and findBy* 5 s by default', () => {
    expect(getConfig().asyncUtilTimeout).toBe(5000);
  });
});
