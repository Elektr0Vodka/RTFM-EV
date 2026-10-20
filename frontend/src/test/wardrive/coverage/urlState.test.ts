import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { searchUrlState } from '../../../wardrive/coverage/urlState';

beforeEach(() => {
  window.history.replaceState(null, '', '/app/?popout=chat&mode=points&junk=1#wardrive');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('coverage state in the query string', () => {
  it('reads only the map keys', () => {
    expect(searchUrlState().read().toString()).toBe('mode=points');
  });

  it('writes the map keys and keeps the rest of the address', () => {
    searchUrlState().write(new URLSearchParams('mode=auto&z=12'));
    expect(window.location.pathname).toBe('/app/');
    expect(window.location.hash).toBe('#wardrive');
    const p = new URLSearchParams(window.location.search);
    expect(p.get('popout')).toBe('chat');
    expect(p.get('junk')).toBe('1');
    expect(p.get('mode')).toBe('auto');
    expect(p.get('z')).toBe('12');
  });

  it('builds a link that opens this page with the given state', () => {
    const link = new URL(searchUrlState().link!(new URLSearchParams('from=2026-10-01T10:00')));
    expect(link.pathname).toBe('/app/');
    expect(link.hash).toBe('#wardrive');
    expect(link.searchParams.get('from')).toBe('2026-10-01T10:00');
    expect(link.searchParams.get('mode')).toBeNull();
  });

  it('clears the map keys when the map goes', () => {
    searchUrlState().clear();
    expect(window.location.search).toBe('?popout=chat&junk=1');
    expect(window.location.hash).toBe('#wardrive');
  });
});
