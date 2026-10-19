// What the radio heard recently, for the HUD, the live log and the live map:
// display only, kept in memory for this page load. The queue, not this log,
// holds what is stored and sent on.

export interface LiveEntry {
  id: number;
  /** When it was heard, ms since the epoch. */
  at: number;
  rssi: number | null;
  snr: number | null;
  payloadType: number | null;
  typeName: string;
  /** Direct (path set by the sender) or flooded; null when the frame did not parse. */
  direct: boolean | null;
  hops: number | null;
  /** Where it was heard, when there was a usable fix. */
  lat: number | null;
  lon: number | null;
  /** Stored for upload and forwarding (driving with a usable fix). */
  kept: boolean;
}

export const LIVE_LOG_MAX = 200;

export class LiveLog {
  private items: LiveEntry[] = [];
  private nextId = 1;

  push(e: Omit<LiveEntry, 'id'>): LiveEntry {
    const entry = { ...e, id: this.nextId++ };
    this.items = [entry, ...this.items].slice(0, LIVE_LOG_MAX);
    return entry;
  }

  /** Newest first. */
  entries(): LiveEntry[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
