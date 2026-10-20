// RTFM-EV's own drive id. Every row a drive writes is tagged with it in the
// queue (beside the message, never inside it), so RTFM-EV can keep drives
// apart; the collectors never see it. A drive that writes nothing for more
// than ten minutes (rx's ride gap) carries on under a new id.

/** A random UUID v4 in lower case, the shape RTFM-EV accepts. */
export function newDriveUid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The uid for rows of one drive; a new one after a gap of more than `gapMs`. */
export class DriveIds {
  private uid: string | null = null;
  private lastMs = 0;

  constructor(
    private gapMs = 600000,
    private make: () => string = newDriveUid
  ) {}

  current(nowMs: number): string {
    if (this.uid === null || nowMs - this.lastMs > this.gapMs) this.uid = this.make();
    this.lastMs = nowMs;
    return this.uid;
  }
}
