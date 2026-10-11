/**
 * Decides, once per browser, whether this is a fresh install that gets the
 * offer of the guided walkthrough (see buddyTour.ts).
 *
 * Must stay the FIRST import of main.tsx and import nothing itself: "fresh"
 * means the app has stored nothing in this browser yet, and other modules
 * write their defaults to localStorage as they load. A browser that already
 * holds app data when this first runs is an existing user and is never asked.
 */
export const BUDDY_TOUR_KEY = 'rtfm-buddy-tour';

/** Keys that can exist before the app ever ran (written by index.html's login redirect). */
const NOT_APP_DATA = new Set(['remoteterm-auth-redirect-url']);

/** Record `offer` for a browser without app data and `existing` for any other, once. */
export function markBuddyTourInstall(storage: Storage): void {
  if (storage.getItem(BUDDY_TOUR_KEY) !== null) return;
  let fresh = true;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null && !NOT_APP_DATA.has(key)) {
      fresh = false;
      break;
    }
  }
  storage.setItem(BUDDY_TOUR_KEY, JSON.stringify({ status: fresh ? 'offer' : 'existing' }));
}

try {
  markBuddyTourInstall(localStorage);
} catch {
  // localStorage may be unavailable: no offer then; the guide button still works.
}
