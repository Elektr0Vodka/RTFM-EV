// What to do when the session of a reverse proxy in front of this app has run
// out (Authelia, oauth2-proxy, ...). The app has no sign-in page of its own, so
// without this it keeps showing stale data and every request fails silently.
//
// A 401, or a 403 that this backend did not send itself, means the session is
// gone: go to the sign-in address saved in this browser, or reload the page so
// the proxy can send the browser to its own sign-in page.
//
// The inline prefetch script in index.html runs before any module exists and
// repeats the storage keys, the checks and the quiet period below. Keep the two
// in step.

const AUTH_REDIRECT_URL_KEY = 'remoteterm-auth-redirect-url';
const LAST_ATTEMPT_KEY = 'remoteterm-auth-redirect-at';
/** No second automatic redirect within this time, so a reload that did not
 * bring the session back cannot turn into a reload loop. */
const QUIET_PERIOD_MS = 60_000;

/** The two navigations, behind an object so tests can observe them. */
export const authNavigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  reload(): void {
    window.location.reload();
  },
};

export function getAuthRedirectUrl(): string {
  try {
    return localStorage.getItem(AUTH_REDIRECT_URL_KEY) ?? '';
  } catch {
    return '';
  }
}

function isSafeRedirectUrl(url: string): boolean {
  if (url.startsWith('/')) return !url.startsWith('//');
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Save the sign-in address; an empty value clears it. Only a path on this site
 * or an http(s) address is accepted, so a stored value can never run script on
 * redirect. Returns false, and stores nothing, for anything else.
 */
export function setAuthRedirectUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed !== '' && !isSafeRedirectUrl(trimmed)) return false;
  try {
    if (trimmed === '') {
      localStorage.removeItem(AUTH_REDIRECT_URL_KEY);
    } else {
      localStorage.setItem(AUTH_REDIRECT_URL_KEY, trimmed);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a failed response means the proxy session is gone. This backend
 * answers some requests with 403 and a FastAPI `detail` body (private key
 * export while disabled); that is a refusal of one action, not a lost session.
 */
export function isAuthFailure(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return !(typeof parsed === 'object' && parsed !== null && 'detail' in parsed);
  } catch {
    return true;
  }
}

// Several requests and the WebSocket can fail at the same moment.
let redirecting = false;

function redirectedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(LAST_ATTEMPT_KEY));
    return Number.isFinite(last) && last > 0 && Date.now() - last < QUIET_PERIOD_MS;
  } catch {
    return false;
  }
}

export function triggerAuthRedirect(): void {
  if (redirecting || redirectedRecently()) return;
  redirecting = true;
  try {
    sessionStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // Without sessionStorage the in-memory flag still stops a burst.
  }
  const target = safeRedirectTarget(getAuthRedirectUrl());
  if (target) {
    authNavigation.assign(target);
  } else {
    authNavigation.reload();
  }
}

/**
 * The address to navigate to, or null when there is none or it is not usable.
 *
 * Checked at the moment of use, not only when it is saved: what is in storage
 * may not have come through the settings field. The result is rebuilt from the
 * parsed parts behind a literal `http://` or `https://`, so no other scheme
 * (`javascript:`, `data:`) can reach the navigation whatever was stored. The
 * query and the fragment, which the parser passes on as written, are
 * percent-encoded once more.
 */
function safeRedirectTarget(stored: string): string | null {
  const trimmed = stored.trim();
  if (trimmed === '' || !isSafeRedirectUrl(trimmed)) return null;
  let rest: string;
  let protocol: string;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    protocol = parsed.protocol;
    rest =
      parsed.host + parsed.pathname + encodeUrlPart(parsed.search) + encodeUrlPart(parsed.hash);
  } catch {
    return null;
  }
  if (protocol === 'https:') return 'https://' + rest;
  if (protocol === 'http:') return 'http://' + rest;
  return null;
}

/**
 * Percent-encode a query or fragment as the URL parser serialised it. Escapes
 * that are already there stay as they are (`%2F` does not become `%252F`);
 * what is added are the characters `encodeURI` covers plus the single quote,
 * so the part holds no quote or angle bracket in any position.
 */
function encodeUrlPart(part: string): string {
  return encodeURI(part).replace(/%25/g, '%').replace(/'/g, '%27');
}

/** Redirect when a failed response means the session is gone. */
export function reportHttpFailure(status: number, body: string): void {
  if (isAuthFailure(status, body)) triggerAuthRedirect();
}

/**
 * Ask the health endpoint whether the session is still accepted. Used when the
 * WebSocket keeps failing: a browser does not expose the HTTP status of a
 * refused handshake, so a lost session and a stopped server look the same.
 */
export async function probeAuthSession(): Promise<void> {
  try {
    const response = await fetch('./api/health', { cache: 'no-store' });
    if (!response.ok) reportHttpFailure(response.status, await response.text());
  } catch {
    // The server cannot be reached at all: not a session problem.
  }
}

export function resetAuthRedirectForTests(options: { keepLastAttempt?: boolean } = {}): void {
  redirecting = false;
  if (!options.keepLastAttempt) {
    try {
      sessionStorage.removeItem(LAST_ATTEMPT_KEY);
    } catch {
      // nothing to clear
    }
  }
}
