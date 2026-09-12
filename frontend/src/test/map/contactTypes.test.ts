import { describe, it, expect } from 'vitest';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../types';

describe('contact type constants', () => {
  it('match the canonical AGENTS.md table', () => {
    expect(CONTACT_TYPE_CLIENT).toBe(1);
    expect(CONTACT_TYPE_REPEATER).toBe(2);
    expect(CONTACT_TYPE_ROOM).toBe(3);
    expect(CONTACT_TYPE_SENSOR).toBe(4);
  });
});
