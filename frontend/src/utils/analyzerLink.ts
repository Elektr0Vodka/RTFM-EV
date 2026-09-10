import type { AnalyzerSite } from '../types';

/**
 * Build an external analyzer lookup URL by substituting a placeholder in a
 * user-configured template. Returns null when the template is unsafe or
 * malformed (not http(s), or missing the placeholder), so callers never hand
 * an unexpected scheme (e.g. `javascript:`) to `window.open`.
 *
 * Defense in depth: the backend validates templates at save time, but a stored
 * value could predate a validation rule, so the frontend re-checks at use time.
 */
export function buildAnalyzerLookupUrl(
  template: string,
  placeholder: '{pubkey}' | '{hash}',
  value: string
): string | null {
  const trimmed = template.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (!trimmed.includes(placeholder)) return null;
  if (!value) return null;
  return trimmed.split(placeholder).join(encodeURIComponent(value));
}

/** Build a node-lookup URL for a full pubkey, or null if the template is unusable. */
export function buildNodeLookupUrl(site: AnalyzerSite, pubkey: string): string | null {
  return buildAnalyzerLookupUrl(site.node_url_template, '{pubkey}', pubkey);
}

/**
 * Build a packet-lookup URL for a packet hash, or null when the site has no
 * packet template configured or the template is unusable.
 */
export function buildPacketLookupUrl(site: AnalyzerSite, hash: string): string | null {
  if (!site.packet_url_template) return null;
  return buildAnalyzerLookupUrl(site.packet_url_template, '{hash}', hash);
}
