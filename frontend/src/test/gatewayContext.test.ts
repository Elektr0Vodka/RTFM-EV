import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGatewayContext, migrateLegacyRadioKeys, radioKey, radioTag } from '../gateway/context';

function setContext(value: unknown) {
  window.__RTFM_GATEWAY__ = value;
}

const workspace = (id: number) => ({
  page: 'workspace',
  base: '../../gateway/',
  radio: { id, name: `Radio ${id}`, urlKey: '0d1d00147f96' },
});

describe('gateway context', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete window.__RTFM_GATEWAY__;
  });

  it('is absent in single-radio mode', () => {
    expect(getGatewayContext()).toBeNull();
    expect(radioKey('remoteterm-last-viewed-conversation')).toBe(
      'remoteterm-last-viewed-conversation'
    );
    expect(radioTag('meshcore-message-42')).toBe('meshcore-message-42');
  });

  it('ignores a malformed value', () => {
    setContext({ page: 'workspace', base: 5 });
    expect(getGatewayContext()).toBeNull();
    setContext({ page: 'workspace', base: '../../gateway/', radio: { id: 'x' } });
    expect(getGatewayContext()).toBeNull();
    setContext('nope');
    expect(getGatewayContext()).toBeNull();
  });

  it('reads a workspace context', () => {
    setContext(workspace(2));
    expect(getGatewayContext()).toEqual({
      page: 'workspace',
      base: '../../gateway/',
      radio: { id: 2, name: 'Radio 2', urlKey: '0d1d00147f96' },
    });
  });

  it('reads the radios page context', () => {
    setContext({ page: 'radios', base: './', radio: null });
    expect(getGatewayContext()).toEqual({ page: 'radios', base: './', radio: null });
    expect(radioKey('remoteterm-local-label')).toBe('remoteterm-local-label');
  });

  it('prefixes only the keys that belong to one radio', () => {
    setContext(workspace(2));
    expect(radioKey('remoteterm-last-viewed-conversation')).toBe(
      'r2:remoteterm-last-viewed-conversation'
    );
    expect(radioKey('remoteterm-local-label')).toBe('r2:remoteterm-local-label');
    expect(radioKey('meshcore_radio_identity_prompt_dismissed')).toBe(
      'r2:meshcore_radio_identity_prompt_dismissed'
    );
    expect(radioKey('remoteterm-theme')).toBe('remoteterm-theme');
    expect(radioKey('locale')).toBe('locale');
  });

  it('prefixes every notification tag in a workspace', () => {
    setContext(workspace(3));
    expect(radioTag('meshcore-message-42')).toBe('r3:meshcore-message-42');
  });

  it('copies the old values to radio 1 once and never overwrites', () => {
    localStorage.setItem('remoteterm-local-label', 'old label');
    localStorage.setItem('remoteterm-recent-traces', '[1]');
    localStorage.setItem('r1:remoteterm-recent-traces', '[2]');
    localStorage.setItem('remoteterm-theme', 'dark');
    setContext(workspace(1));

    migrateLegacyRadioKeys();

    expect(localStorage.getItem('r1:remoteterm-local-label')).toBe('old label');
    expect(localStorage.getItem('remoteterm-local-label')).toBe('old label');
    expect(localStorage.getItem('r1:remoteterm-recent-traces')).toBe('[2]');
    expect(localStorage.getItem('r1:remoteterm-theme')).toBeNull();

    localStorage.setItem('remoteterm-sidebar-seen-items', '["later"]');
    migrateLegacyRadioKeys();
    expect(localStorage.getItem('r1:remoteterm-sidebar-seen-items')).toBeNull();
  });

  it('does not copy anything for another radio or outside a workspace', () => {
    localStorage.setItem('remoteterm-local-label', 'old label');
    setContext(workspace(2));
    migrateLegacyRadioKeys();
    expect(localStorage.getItem('r2:remoteterm-local-label')).toBeNull();

    delete window.__RTFM_GATEWAY__;
    migrateLegacyRadioKeys();
    expect(localStorage.getItem('r1:remoteterm-local-label')).toBeNull();
  });
});
