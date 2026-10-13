import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showPageNotification } from '../utils/pageNotification';

const OPTIONS = { body: 'hello room', icon: './favicon-256x256.png', tag: 'meshcore-message-42' };

type NotificationInstance = { onclick: (() => void) | null; close: ReturnType<typeof vi.fn> };

function stubNotification(implementation: (this: Record<string, unknown>) => void) {
  const NotificationMock = vi.fn().mockImplementation(implementation);
  Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationMock });
  return NotificationMock;
}

/** What nearly all mobile browsers do: the constructor is not allowed. */
function stubMobileNotification() {
  return stubNotification(function () {
    throw new TypeError('Illegal constructor');
  });
}

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

describe('showPageNotification', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(window, 'focus').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stubServiceWorker(undefined);
  });

  it('shows a page notification that opens the hash on click', () => {
    const showNotification = vi.fn();
    stubServiceWorker({ getRegistration: vi.fn(async () => ({ showNotification })) });
    const NotificationMock = stubNotification(function () {
      this.close = vi.fn();
      this.onclick = null;
    });

    showPageNotification('New message in #flightless', OPTIONS, '#channel/abcd/%23flightless');

    expect(NotificationMock).toHaveBeenCalledWith('New message in #flightless', OPTIONS);
    const instance = NotificationMock.mock.instances[0] as unknown as NotificationInstance;
    instance.onclick?.();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#channel/abcd/%23flightless`,
      '_self'
    );
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(instance.close).toHaveBeenCalledTimes(1);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('focuses without navigating when there is no hash to open', () => {
    const NotificationMock = stubNotification(function () {
      this.close = vi.fn();
      this.onclick = null;
    });

    showPageNotification('New message from Alice', OPTIONS, null);

    const instance = NotificationMock.mock.instances[0] as unknown as NotificationInstance;
    instance.onclick?.();
    expect(window.open).not.toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('leaves a notification without a click target alone', () => {
    const NotificationMock = stubNotification(function () {
      this.close = vi.fn();
      this.onclick = null;
    });

    showPageNotification('Preview', OPTIONS);

    const instance = NotificationMock.mock.instances[0] as unknown as NotificationInstance;
    expect(instance.onclick).toBeNull();
  });

  it('goes through the service worker where the page may not show one', async () => {
    stubMobileNotification();
    const showNotification = vi.fn(async () => {});
    stubServiceWorker({ getRegistration: vi.fn(async () => ({ showNotification })) });

    showPageNotification('New message in #flightless', OPTIONS, '#channel/abcd/%23flightless');

    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
    // The click is handled by notificationclick in public/sw.js, which reads url_hash.
    expect(showNotification).toHaveBeenCalledWith('New message in #flightless', {
      ...OPTIONS,
      data: { url_hash: '#channel/abcd/%23flightless' },
    });
  });

  it('does not throw without a service worker either', async () => {
    stubMobileNotification();
    stubServiceWorker(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => showPageNotification('New message in #flightless', OPTIONS, null)).not.toThrow();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not throw when the service worker refuses', async () => {
    stubMobileNotification();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubServiceWorker({
      getRegistration: vi.fn(async () => ({
        showNotification: vi.fn(async () => {
          throw new Error('No notification permission');
        }),
      })),
    });

    expect(() => showPageNotification('New message in #flightless', OPTIONS, null)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });
});
