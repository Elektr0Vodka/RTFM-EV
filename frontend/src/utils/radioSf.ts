import type { ContactRadioSighting, RadioStamp, TempRadioState } from '../types';
import { stampsEqual } from './tempRadio';

/** "869.618 MHz, 62.5 kHz, SF8, CR8" for tooltips and the banner. */
export function formatRadioStamp(stamp: RadioStamp): string {
  const freq = Number(stamp.freq.toFixed(3));
  const bw = Number(stamp.bw.toFixed(3));
  return `${freq} MHz, ${bw} kHz, SF${stamp.sf}, CR${stamp.cr}`;
}

export interface RadioFieldValues {
  freq: string;
  bw: string;
  sf: string;
  cr: string;
}

export type RadioFieldError =
  'temp_radio_error_freq' | 'temp_radio_error_bw' | 'temp_radio_error_sf' | 'temp_radio_error_cr';

/** Parse the four inputs with the firmware's limits; returns an i18n error key when invalid. */
export function parseRadioFields(
  values: RadioFieldValues
): { stamp: RadioStamp; error: null } | { stamp: null; error: RadioFieldError } {
  const freq = Number.parseFloat(values.freq);
  const bw = Number.parseFloat(values.bw);
  const sf = Number(values.sf);
  const cr = Number(values.cr);
  if (!Number.isFinite(freq) || freq < 150 || freq > 2500) {
    return { stamp: null, error: 'temp_radio_error_freq' };
  }
  if (!Number.isFinite(bw) || bw < 7 || bw > 500) {
    return { stamp: null, error: 'temp_radio_error_bw' };
  }
  if (!Number.isInteger(sf) || sf < 5 || sf > 12) {
    return { stamp: null, error: 'temp_radio_error_sf' };
  }
  if (!Number.isInteger(cr) || cr < 5 || cr > 8) {
    return { stamp: null, error: 'temp_radio_error_cr' };
  }
  return { stamp: { freq, bw, sf, cr }, error: null };
}

/**
 * The settings that count as normal: the stored original while a temporary
 * session runs, else the radio's current settings.
 */
export function normalStamp(
  state: TempRadioState,
  current: RadioStamp | null | undefined
): RadioStamp | null {
  if (state.active && state.original) return state.original;
  return current ?? null;
}

/** True when a stamp exists and differs from normal (null normal: unknown, no pill). */
export function isNonNormal(
  stamp: RadioStamp | null | undefined,
  normal: RadioStamp | null
): boolean {
  if (!stamp || !normal) return false;
  return !stampsEqual(stamp, normal);
}

/**
 * Pill labels for a set of settings: `SF8`, plus the frequency when two of the
 * shown sets share an SF (`SF8 869.618`).
 */
export function pillLabels(stamps: RadioStamp[]): string[] {
  const sfCounts = new Map<number, number>();
  for (const stamp of stamps) sfCounts.set(stamp.sf, (sfCounts.get(stamp.sf) ?? 0) + 1);
  return stamps.map((stamp) =>
    (sfCounts.get(stamp.sf) ?? 0) > 1
      ? `SF${stamp.sf} ${Number(stamp.freq.toFixed(3))}`
      : `SF${stamp.sf}`
  );
}

/**
 * The settings sets a contact pill row shows: every distinct sighting when at
 * least one differs from normal, else none.
 */
export function contactPillStamps(
  sightings: ContactRadioSighting[],
  normal: RadioStamp | null
): RadioStamp[] {
  if (!normal || sightings.length === 0) return [];
  const distinct: RadioStamp[] = [];
  for (const s of sightings) {
    const stamp = { freq: s.freq, bw: s.bw, sf: s.sf, cr: s.cr };
    if (!distinct.some((d) => stampsEqual(d, stamp))) distinct.push(stamp);
  }
  return distinct.some((stamp) => !stampsEqual(stamp, normal)) ? distinct : [];
}

/** Packet filter buckets: one per SF, plus Unknown for rows from before stamps existed. */
export const SF_FILTER_BUCKETS = [
  'SF5',
  'SF6',
  'SF7',
  'SF8',
  'SF9',
  'SF10',
  'SF11',
  'SF12',
  'Unknown',
] as const;

export function packetSfBucket(stamp: RadioStamp | null | undefined): string {
  return stamp ? `SF${stamp.sf}` : 'Unknown';
}

/** SF filter bucket of a row: its SF, or 0 for rows without a stamp ("Unknown"). */
export function sfBucket(stamp: RadioStamp | null | undefined): number {
  return stamp?.sf ?? 0;
}

/** A contact is hidden by the SF filter only when every SF it was heard on is hidden. */
export function contactHiddenBySf(
  sightings: ContactRadioSighting[],
  hiddenSfs: ReadonlySet<number>
): boolean {
  if (hiddenSfs.size === 0) return false;
  if (sightings.length === 0) return hiddenSfs.has(0);
  return sightings.every((s) => hiddenSfs.has(s.sf));
}
