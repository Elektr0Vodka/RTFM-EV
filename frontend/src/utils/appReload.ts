/**
 * Load the app again from the server. An installed app (PWA) has no reload
 * button, and on a phone pull-to-refresh is switched off (`overscroll-behavior`
 * in styles.css), so the app has to offer it itself.
 *
 * Behind an object so tests can observe it.
 */
export const appReload = {
  now(): void {
    window.location.reload();
  },
};
