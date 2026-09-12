import { describe, it, expect } from 'vitest';
import { normalizeRoleColors, DEFAULT_NODE_ROLE_COLORS } from '../../map/layers/nodeRoleColors';
import { strokeColorExpr } from '../../map/layers/nodesLayer';
import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_REPEATER } from '../../types';

describe('normalizeRoleColors', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(normalizeRoleColors(null)).toEqual(DEFAULT_NODE_ROLE_COLORS);
    expect(normalizeRoleColors(undefined)).toEqual(DEFAULT_NODE_ROLE_COLORS);
    expect(normalizeRoleColors({})).toEqual(DEFAULT_NODE_ROLE_COLORS);
  });

  it('merges valid saved colours over the defaults', () => {
    const out = normalizeRoleColors({ [CONTACT_TYPE_CLIENT]: '#ff0000' });
    expect(out[CONTACT_TYPE_CLIENT]).toBe('#ff0000');
    expect(out[CONTACT_TYPE_REPEATER]).toBe(DEFAULT_NODE_ROLE_COLORS[CONTACT_TYPE_REPEATER]);
  });

  it('ignores invalid hex values and unknown roles', () => {
    const out = normalizeRoleColors({
      [CONTACT_TYPE_CLIENT]: 'red',
      [CONTACT_TYPE_REPEATER]: '#12',
      '99': '#abcdef',
    });
    expect(out).toEqual(DEFAULT_NODE_ROLE_COLORS);
    expect((out as Record<string, string>)['99']).toBeUndefined();
  });
});

describe('strokeColorExpr with custom colours', () => {
  it('emits a match expression using the provided per-role colours', () => {
    const expr = strokeColorExpr({ [CONTACT_TYPE_CLIENT]: '#ff0000' }) as unknown as unknown[];
    expect(expr[0]).toBe('match');
    // ['match', ['get','type'], 1, '#ff0000', <default>]
    expect(expr).toContain('#ff0000');
    expect(expr[2]).toBe(CONTACT_TYPE_CLIENT);
    expect(expr[3]).toBe('#ff0000');
  });
});
