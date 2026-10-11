// Where this page runs in multi-radio mode (plan 30).
//
// index.html loads ./radio-context.js before the bundle. In single-radio mode
// that file is a no-op. The multi-radio gateway serves its own version, which
// sets window.__RTFM_GATEWAY__, so the radio id is known synchronously before
// any module reads browser storage.

export interface GatewayRadio {
  /** Storage identity of the radio. Never reused, survives a key change. */
  id: number;
  name: string;
  /** The <key> in /r/<key>/. */
  urlKey: string;
}

export interface GatewayContext {
  /** 'workspace': one radio's app under /r/<key>/. 'radios': the radios page at /gateway/. */
  page: 'workspace' | 'radios';
  /** Relative URL of the gateway root page, with a trailing slash. */
  base: string;
  radio: GatewayRadio | null;
}

declare global {
  interface Window {
    __RTFM_GATEWAY__?: unknown;
  }
}

/**
 * Browser storage keys that hold one radio's data (conversation ids, contact
 * keys, radio identity ids). Everything else is a browser preference and is
 * shared by all radios.
 */
const PER_RADIO_LOCAL_KEYS = [
  'remoteterm-last-viewed-conversation',
  'remoteterm-sidebar-seen-items',
  'remoteterm-recent-traces',
  'remoteterm-recent-trace-nodes',
  'remoteterm-local-label',
  'meshcore_browser_notifications_enabled_by_conversation',
  'meshcore_mention_sound_muted_by_conversation',
];
const PER_RADIO_SESSION_KEYS = ['meshcore_radio_identity_prompt_dismissed'];
const PER_RADIO_KEYS = new Set([...PER_RADIO_LOCAL_KEYS, ...PER_RADIO_SESSION_KEYS]);

const MIGRATED_MARKER = 'r1:remoteterm-radio-keys-migrated';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRadio(value: unknown): GatewayRadio | null {
  if (!isRecord(value)) return null;
  const { id, name, urlKey } = value;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (typeof name !== 'string' || typeof urlKey !== 'string') return null;
  return { id, name, urlKey };
}

/** The gateway context, or null in single-radio mode. */
export function getGatewayContext(): GatewayContext | null {
  if (typeof window === 'undefined') return null;
  const raw = window.__RTFM_GATEWAY__;
  if (!isRecord(raw) || typeof raw.base !== 'string') return null;
  if (raw.page === 'radios') return { page: 'radios', base: raw.base, radio: null };
  if (raw.page !== 'workspace') return null;
  const radio = parseRadio(raw.radio);
  return radio ? { page: 'workspace', base: raw.base, radio } : null;
}

function workspaceRadioId(): number | null {
  const context = getGatewayContext();
  return context?.page === 'workspace' && context.radio ? context.radio.id : null;
}

/** The storage key to use for `key`: prefixed with the radio id when it is per radio. */
export function radioKey(key: string): string {
  const id = workspaceRadioId();
  return id !== null && PER_RADIO_KEYS.has(key) ? `r${id}:${key}` : key;
}

/**
 * Notification tags are shared by every page of one origin, so two radios
 * would replace each other's notifications without a prefix.
 */
export function radioTag(tag: string): string {
  const id = workspaceRadioId();
  return id !== null ? `r${id}:${tag}` : tag;
}

/**
 * Radio 1 is the radio an existing install already had. Copy its per-radio
 * values to their prefixed keys once. The originals stay, so the app still
 * finds them when multi-radio mode is switched off again.
 */
export function migrateLegacyRadioKeys(): void {
  if (workspaceRadioId() !== 1) return;
  try {
    if (localStorage.getItem(MIGRATED_MARKER) !== null) return;
    for (const key of PER_RADIO_LOCAL_KEYS) {
      const prefixed = `r1:${key}`;
      const legacy = localStorage.getItem(key);
      if (legacy !== null && localStorage.getItem(prefixed) === null) {
        localStorage.setItem(prefixed, legacy);
      }
    }
    localStorage.setItem(MIGRATED_MARKER, '1');
  } catch {
    // Storage unavailable (private mode, quota): nothing to migrate.
  }
}
