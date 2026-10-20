// What the radio heard, for the HUD, the live log and the live map: this page
// load's receptions plus the receptions this browser stored in the queue
// (decoded again when loaded). Display only, kept in memory; the queue, not
// this log, holds what is stored and sent on.
import type { Sender } from './decode/reception';

export interface LiveEntry {
  id: number;
  /** When it was heard, ms since the epoch. */
  at: number;
  rssi: number | null;
  snr: number | null;
  payloadType: number | null;
  /** The firmware payload type name (sound cues), '?' when the frame did not parse. */
  typeName: string;
  /** Direct (path set by the sender) or flooded; null when the frame did not parse. */
  direct: boolean | null;
  hops: number | null;
  /** Where it was heard, when there was a usable fix. */
  lat: number | null;
  lon: number | null;
  /** Stored for upload and forwarding (driving with a usable fix). */
  kept: boolean;
  /** The decoded packet type ('Unknown' when the decoder could not read it). */
  packetType: string;
  /** The sender (or the relay that passed it on) was heard directly. */
  heardDirect: boolean;
  sender: Sender;
  channel: string | null;
  text: string | null;
  /** Loaded from this browser's queue, not heard during this page load. */
  stored: boolean;
}

/** Most receptions kept of this page load, and again of the stored ones. */
export const STORE_MAX = 5000;

export class LiveLog {
  private live: LiveEntry[] = [];
  private history: LiveEntry[] = [];
  private nextId = 1;

  push(e: Omit<LiveEntry, 'id'>): LiveEntry {
    const entry = { ...e, id: this.nextId++ };
    this.live.unshift(entry);
    if (this.live.length > STORE_MAX) this.live.length = STORE_MAX;
    return entry;
  }

  /** Stored receptions, newest first, placed after this page load's. */
  addHistory(entries: Omit<LiveEntry, 'id'>[]): void {
    const room = STORE_MAX - this.history.length;
    for (const e of entries.slice(0, Math.max(0, room))) {
      this.history.push({ ...e, id: this.nextId++ });
    }
  }

  clearHistory(): void {
    this.history = [];
  }

  /** Newest first: this page load's, then the stored ones. */
  entries(): LiveEntry[] {
    return this.history.length ? [...this.live, ...this.history] : [...this.live];
  }

  clear(): void {
    this.live = [];
    this.history = [];
  }
}
