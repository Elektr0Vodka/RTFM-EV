// The last broker list RTFM-EV served, kept in this browser so the page
// forwards to the same brokers when it starts without a connection to
// RTFM-EV. It can hold an owner-entered broker password: the page needs it to
// connect, as it does when the list comes straight from the server.
import { parseBrokers, type Broker } from './brokers';

const KEY = 'rtfm-wardrive-served-brokers';

export function loadServedBrokers(): Broker[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseBrokers(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveServedBrokers(list: Broker[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the list is asked for again on the next start.
  }
}
