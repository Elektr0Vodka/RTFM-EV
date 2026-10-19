// The driver's forwarding choices, kept in this browser only: which broker is
// on for which radio, the on8ar account, and the radio-signed tokens. None of
// it is sent to RTFM-EV.

const KEY = 'rtfm-wardrive-brokers';

export interface BrokerSettings {
  /** destId (`<broker>@<KEY>`) -> switched on */
  enabled: Record<string, boolean>;
  on8ar: { username: string; password: string } | null;
  /** `<host>@<KEY>` -> token */
  tokens: Record<string, string>;
}

const defaults = (): BrokerSettings => ({ enabled: {}, on8ar: null, tokens: {} });

export function loadBrokerSettings(): BrokerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'object' && parsed.enabled ? parsed.enabled : {},
      on8ar:
        parsed.on8ar && typeof parsed.on8ar.username === 'string'
          ? { username: parsed.on8ar.username, password: String(parsed.on8ar.password ?? '') }
          : null,
      tokens: typeof parsed.tokens === 'object' && parsed.tokens ? parsed.tokens : {},
    };
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
