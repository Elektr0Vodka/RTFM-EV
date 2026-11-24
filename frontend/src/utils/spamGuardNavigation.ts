/**
 * Ask the Spam Guard page to open at a tab. The page is one route
 * (`#spam-guard`) and the URL hash drives the app's routing, so the tab
 * travels here instead: the caller requests it and navigates to the page;
 * `SpamGuardView` takes it when it mounts, or right away when it is open.
 */
export const SPAM_GUARD_TAB_EVENT = 'rtfm-spam-guard-tab';

let pending: string | null = null;

export function requestSpamGuardTab(tab: string): void {
  pending = tab;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SPAM_GUARD_TAB_EVENT));
}

/** The requested tab, once; null when none is waiting. */
export function takeSpamGuardTab(): string | null {
  const tab = pending;
  pending = null;
  return tab;
}
