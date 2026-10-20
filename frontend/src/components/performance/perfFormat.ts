// Number formatting for the Performance page. `null` is shown as "n/a" by callers.

export const NA = '–';

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return NA;
  if (ms >= 10_000) return `${(ms / 1000).toFixed(0)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export function fmtMb(mb: number | null | undefined): string {
  if (mb == null) return NA;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export function fmtPct(pct: number | null | undefined): string {
  return pct == null ? NA : `${pct.toFixed(1)}%`;
}

export function fmtCount(n: number | null | undefined): string {
  return n == null ? NA : Math.round(n).toLocaleString();
}

/** Seconds as "3d 04h 12m" / "4h 12m" / "12m 05s" / "42s". */
export function fmtDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return NA;
  const s = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

/** Loop interval: "10 s", "5 min", "6 h". */
export function fmtEvery(seconds: number | null): string {
  if (seconds == null) return NA;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}
