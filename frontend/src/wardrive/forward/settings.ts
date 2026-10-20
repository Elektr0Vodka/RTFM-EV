// The driver's forwarding choices, kept in this browser only: which broker is
// on for which radio, and the radio-signed tokens. None of it is sent to
// RTFM-EV. (An older page also kept an on8ar account here; it is dropped.)

const KEY = 'rtfm-wardrive-brokers';

export interface BrokerSettings {
  /** destId (`<broker>@<KEY>`) -> switched on */
  enabled: Record<string, boolean>;
  /** `<audience>@<KEY>` -> token */
  tokens: Record<string, string>;
}

const defaults = (): BrokerSettings => ({ enabled: {}, tokens: {} });

export function loadBrokerSettings(): BrokerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const settings = {
      enabled: typeof parsed.enabled === 'object' && parsed.enabled ? parsed.enabled : {},
      tokens: typeof parsed.tokens === 'object' && parsed.tokens ? parsed.tokens : {},
    };
    // A stored on8ar password goes now, not at the next save.
    if ('on8ar' in parsed) saveBrokerSettings(settings);
    return settings;
  } catch {
    return defaults();
  }
}

export function saveBrokerSettings(settings: BrokerSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the switches then last until the page is closed.
  }
}
