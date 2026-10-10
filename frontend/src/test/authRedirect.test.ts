import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authNavigation,
  getAuthRedirectUrl,
  isAuthFailure,
  probeAuthSession,
  reportHttpFailure,
  resetAuthRedirectForTests,
  setAuthRedirectUrl,
  triggerAuthRedirect,
} from '../utils/authRedirect';

describe('authRedirect', () => {
  let assign: ReturnType<typeof vi.spyOn>;
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetAuthRedirectForTests();
    assign = vi.spyOn(authNavigation, 'assign').mockImplementation(() => {});
    reload = vi.spyOn(authNavigation, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('the stored sign-in address', () => {
    it('is empty until one is saved', () => {
      expect(getAuthRedirectUrl()).toBe('');
    });

    it('accepts a path on this site and an http(s) address', () => {
      expect(setAuthRedirectUrl('/login')).toBe(true);
      expect(getAuthRedirectUrl()).toBe('/login');
      expect(setAuthRedirectUrl(' https://auth.example.com/ ')).toBe(true);
      expect(getAuthRedirectUrl()).toBe('https://auth.example.com/');
    });

    it('refuses anything that is not a path or an http(s) address', () => {
      expect(setAuthRedirectUrl('/login')).toBe(true);
      expect(setAuthRedirectUrl('javascript:alert(1)')).toBe(false);
      expect(setAuthRedirectUrl('//evil.example.com')).toBe(false);
      expect(setAuthRedirectUrl('data:text/html,x')).toBe(false);
      expect(getAuthRedirectUrl()).toBe('/login');
    });

    it('is cleared by an empty value', () => {
      setAuthRedirectUrl('/login');
      expect(setAuthRedirectUrl('  ')).toBe(true);
      expect(getAuthRedirectUrl()).toBe('');
    });
  });

  describe('isAuthFailure', () => {
    it('treats every 401 as a lost session', () => {
      expect(isAuthFailure(401, '{"detail":"Unauthorized"}')).toBe(true);
      expect(isAuthFailure(401, '<html>login</html>')).toBe(true);
    });

    it('treats a 403 from a proxy as a lost session', () => {
      expect(isAuthFailure(403, '<html>Forbidden</html>')).toBe(true);
      expect(isAuthFailure(403, '')).toBe(true);
    });

    it('leaves a 403 this server sent itself alone', () => {
      // The backend refuses some actions with 403 and a FastAPI `detail` body
      // (private key export while disabled). That is an answer, not a session.
      expect(isAuthFailure(403, '{"detail":"Private key export is disabled"}')).toBe(false);
    });

    it('ignores other statuses', () => {
      expect(isAuthFailure(404, '')).toBe(false);
      expect(isAuthFailure(422, '{"detail":"x"}')).toBe(false);
      expect(isAuthFailure(500, '')).toBe(false);
    });
  });

  describe('triggerAuthRedirect', () => {
    it('reloads the page when no address is saved', () => {
      triggerAuthRedirect();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });

    it('goes to the saved path on this site', () => {
      setAuthRedirectUrl('/login?next=1#top');
      triggerAuthRedirect();
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/login?next=1#top`);
      expect(reload).not.toHaveBeenCalled();
    });

    it('goes to the saved http(s) address', () => {
      setAuthRedirectUrl('https://auth.example.com/start?rd=app');
      triggerAuthRedirect();
      expect(assign).toHaveBeenCalledWith('https://auth.example.com/start?rd=app');
    });

    // The value is checked again at the moment it is used: what is in storage
    // may not have come through the settings field.
    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example.com/login',
      'vbscript:msgbox(1)',
    ])('reloads when storage holds %s', (stored) => {
      localStorage.setItem('remoteterm-auth-redirect-url', stored);
      triggerAuthRedirect();
      expect(assign).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('acts once for a burst of failures', () => {
      triggerAuthRedirect();
      triggerAuthRedirect();
      triggerAuthRedirect();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload again right after a reload that did not help', () => {
      // After the reload the page starts over. If the session is still refused
      // the app must not reload in a loop.
      triggerAuthRedirect();
      resetAuthRedirectForTests({ keepLastAttempt: true });
      triggerAuthRedirect();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('acts again once the quiet period is over', () => {
      vi.useFakeTimers();
      try {
        triggerAuthRedirect();
        resetAuthRedirectForTests({ keepLastAttempt: true });
        vi.advanceTimersByTime(61_000);
        triggerAuthRedirect();
        expect(reload).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reportHttpFailure', () => {
    it('redirects on a lost session only', () => {
      reportHttpFailure(422, '{"detail":"No response"}');
      reportHttpFailure(403, '{"detail":"Private key export is disabled"}');
      expect(reload).not.toHaveBeenCalled();
      reportHttpFailure(401, '');
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('probeAuthSession', () => {
    it('redirects when the health endpoint answers 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 401 }))
      );
      await probeAuthSession();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the server is down or healthy', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await probeAuthSession();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
      await probeAuthSession();
      expect(reload).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
