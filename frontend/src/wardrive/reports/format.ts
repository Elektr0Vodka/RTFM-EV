// Small formatters for drives and reports. Text with words goes through t();
// these only shape numbers and dates.
import type { TFn } from '../../i18n';
import type { WardriveDrive } from './types';

/** "1 h 5 min", "12 min", "59 s". */
export function formatDuration(seconds: number, t: TFn): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('wardrive_report_seconds', { n: s });
  const minutes = Math.round(s / 60);
  if (minutes < 60) return t('wardrive_report_minutes', { n: minutes });
  return t('wardrive_report_hours_minutes', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** A 0..1 share as "62 %"; "-" when there is none. */
export function formatShare(share: number | null): string {
  return share === null ? '-' : `${Math.round(share * 100)} %`;
}

export function formatDbm(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)} dBm`;
}

export function formatDb(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(1)} dB`;
}

export function formatWhen(ts: number | null, locale: string): string {
  if (ts === null) return '-';
  return new Date(ts * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A drive's name, or its start date when it has none. */
export function driveLabel(drive: WardriveDrive, locale: string): string {
  return drive.name || formatWhen(drive.start_ts, locale);
}

/** A shown node id: "~Name" for a guessed name, the name, else the id (6 hex at most). */
export function nodeLabel(node: { id: string; name: string | null; guess?: boolean }): string {
  if (node.name) return `${node.guess ? '~' : ''}${node.name}`;
  return node.id.length > 6 ? node.id.slice(0, 6) : node.id;
}
