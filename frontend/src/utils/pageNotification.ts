/**
 * Show a notification from the page (not a Web Push one).
 *
 * `new Notification()` throws a TypeError in nearly all mobile browsers: there
 * only a service worker may show one. So when the constructor refuses, the
 * notification goes through the registered worker, and its click is handled by
 * `notificationclick` in `public/sw.js`, which reads `data.url_hash`.
 *
 * `urlHash`: a hash to open on click, `''` for the app without one, `null` to
 * only bring the app forward. Left out: no click handling at all.
 */
export function showPageNotification(
  title: string,
  options: NotificationOptions,
  urlHash?: string | null
): void {
  try {
    const notification = new window.Notification(title, options);
    if (urlHash !== undefined) {
      notification.onclick = () => {
        if (urlHash !== null) {
          window.open(`${window.location.origin}${window.location.pathname}${urlHash}`, '_self');
        }
        window.focus();
        notification.close();
      };
    }
    return;
  } catch {
    // Not allowed from a page here: fall through to the service worker.
  }
  void showThroughServiceWorker(title, options, urlHash ?? '');
}

async function showThroughServiceWorker(
  title: string,
  options: NotificationOptions,
  urlHash: string
): Promise<void> {
  try {
    // No service worker on plain HTTP: nothing can be shown then.
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.showNotification(title, { ...options, data: { url_hash: urlHash } });
  } catch (err) {
    console.warn('Notification could not be shown:', err);
  }
}
