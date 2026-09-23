/**
 * Link-age window for the map's advert/traffic link layers. By default links
 * follow the map's "Heard since" node filter; the user can override that with
 * their own preset or custom From/To range.
 */

export const LINK_AGE_FOLLOW_KEY = 'remoteterm-map-link-age-follow';
export const LINK_AGE_PRESET_KEY = 'remoteterm-map-link-age-preset';
export const LINK_AGE_FROM_KEY = 'remoteterm-map-link-age-from';
export const LINK_AGE_UNTIL_KEY = 'remoteterm-map-link-age-until';
export const LINK_AGE_CUSTOM_ID = 'custom';

export interface TimeWindow {
  since: number | null;
  until: number | null;
}

export interface LinkAgePreset {
  id: string;
  seconds: number | null;
}

export const isStr = (v: unknown): v is string => typeof v === 'string';

/** `datetime-local` value to unix seconds (floored), or null when empty/invalid. */
export function localDateTimeToEpochSec(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function resolveLinkWindow(args: {
  follow: boolean;
  nodeWindow: TimeWindow;
  presetId: string;
  presets: LinkAgePreset[];
  customFrom: string;
  customUntil: string;
  nowSec: number;
}): TimeWindow {
  if (args.follow) return args.nodeWindow;
  if (args.presetId === LINK_AGE_CUSTOM_ID) {
    return {
      since: localDateTimeToEpochSec(args.customFrom),
      until: localDateTimeToEpochSec(args.customUntil),
    };
  }
  const preset = args.presets.find((p) => p.id === args.presetId);
  if (!preset || preset.seconds == null) return { since: null, until: null };
  return { since: Math.floor(args.nowSec) - preset.seconds, until: null };
}

/** True when the override is a rolling window that must follow the clock. */
export function isRelativeLinkAge(
  follow: boolean,
  presetId: string,
  presets: LinkAgePreset[]
): boolean {
  if (follow) return false;
  const preset = presets.find((p) => p.id === presetId);
  return preset != null && preset.seconds != null;
}
