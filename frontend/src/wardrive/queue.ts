// The browser-side queue: every obs and track is written here before any
// network attempt and stays until every destination it is owed has it. Each
// destination (RTFM-EV's local copy, each broker) drains at its own pace with
// its own watermark: the id of the last row it acknowledged.
import type { ObsMessage, TrackMessage } from './messages';

export type QueueKind = 'obs' | 'track';
export type QueueMessage = ObsMessage | TrackMessage;

export interface QueueRow<M extends QueueMessage = QueueMessage> {
  id: number;
  radioKey: string;
  message: M;
}

interface StoredRow {
  id?: number;
  radioKey: string;
  message: QueueMessage;
  addedAt: number;
}

const DAY_MS = 86400000;
const STORES: Record<QueueKind, string> = { obs: 'obs', track: 'tracks' };
const MARKS = 'marks';
const RADIO_INDEX = 'radio_id';
const DB_VERSION = 2;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class Queue {
  constructor(private db: IDBDatabase) {}

  close(): void {
    this.db.close();
  }

  private async add(kind: QueueKind, radioKey: string, message: QueueMessage, addedAt: number) {
    const tx = this.db.transaction(STORES[kind], 'readwrite');
    const id = await req(tx.objectStore(STORES[kind]).add({ radioKey, message, addedAt }));
    await done(tx);
    return Number(id);
  }

  addObs(radioKey: string, obs: ObsMessage, addedAt = Date.now()): Promise<number> {
    return this.add('obs', radioKey, obs, addedAt);
  }

  addTrack(radioKey: string, track: TrackMessage, addedAt = Date.now()): Promise<number> {
    return this.add('track', radioKey, track, addedAt);
  }

  private async mark(dest: string, kind: QueueKind): Promise<number> {
    const tx = this.db.transaction(MARKS, 'readonly');
    const row = (await req(tx.objectStore(MARKS).get(`${dest}:${kind}`))) as
      { key: string; id: number } | undefined;
    return row?.id ?? 0;
  }

  /** Rows after `dest`'s watermark, oldest first, all of one radio (the
   * radio of the first row): an upload or a broker topic is per radio. */
  async batch(dest: string, kind: QueueKind, limit: number): Promise<QueueRow[]> {
    const after = await this.mark(dest, kind);
    const tx = this.db.transaction(STORES[kind], 'readonly');
    const store = tx.objectStore(STORES[kind]);
    const rows: QueueRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(IDBKeyRange.lowerBound(after, true));
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const value = cursor.value as StoredRow;
        if (rows.length > 0 && value.radioKey !== rows[0].radioKey) return resolve();
        rows.push({ id: Number(cursor.key), radioKey: value.radioKey, message: value.message });
        if (rows.length >= limit) return resolve();
        cursor.continue();
      };
    });
    return rows;
  }

  /** Moves `dest`'s watermark to `lastId`; never backwards. */
  async ack(dest: string, kind: QueueKind, lastId: number): Promise<void> {
    const current = await this.mark(dest, kind);
    if (lastId <= current) return;
    const tx = this.db.transaction(MARKS, 'readwrite');
    tx.objectStore(MARKS).put({ key: `${dest}:${kind}`, id: lastId });
    await done(tx);
  }

  async pending(dest: string): Promise<{ obs: number; tracks: number }> {
    const count = async (kind: QueueKind) => {
      const after = await this.mark(dest, kind);
      const tx = this.db.transaction(STORES[kind], 'readonly');
      return req(tx.objectStore(STORES[kind]).count(IDBKeyRange.lowerBound(after, true)));
    };
    return { obs: await count('obs'), tracks: await count('track') };
  }

  /** Rows of one radio after `dest`'s watermark, oldest first. A broker
   * destination is per radio (`<broker>@<KEY>`): a collector only accepts the
   * radio that signed in, so other radios' rows are not its business. */
  async batchForRadio(
    dest: string,
    kind: QueueKind,
    radioKey: string,
    limit: number
  ): Promise<QueueRow[]> {
    const range = await this.radioRange(dest, kind, radioKey);
    const tx = this.db.transaction(STORES[kind], 'readonly');
    const index = tx.objectStore(STORES[kind]).index(RADIO_INDEX);
    const rows: QueueRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursorReq = index.openCursor(range);
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const value = cursor.value as StoredRow;
        rows.push({ id: Number(cursor.primaryKey), radioKey, message: value.message });
        if (rows.length >= limit) return resolve();
        cursor.continue();
      };
    });
    return rows;
  }

  /** Stored receptions of these radios added before `untilMs`, newest first,
   * at most `limit`: what the page shows of earlier drives on this browser. */
  async obsBefore(
    radioKeys: string[],
    untilMs: number,
    limit: number
  ): Promise<{ radioKey: string; message: ObsMessage; addedAt: number }[]> {
    const found: { id: number; radioKey: string; message: ObsMessage; addedAt: number }[] = [];
    for (const radioKey of radioKeys) {
      const tx = this.db.transaction(STORES.obs, 'readonly');
      const index = tx.objectStore(STORES.obs).index(RADIO_INDEX);
      const range = IDBKeyRange.bound([radioKey, -Infinity], [radioKey, Infinity]);
      let taken = 0;
      await new Promise<void>((resolve, reject) => {
        const cursorReq = index.openCursor(range, 'prev');
        cursorReq.onerror = () => reject(cursorReq.error);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || taken >= limit) return resolve();
          const value = cursor.value as StoredRow;
          if (value.addedAt < untilMs) {
            found.push({
              id: Number(cursor.primaryKey),
              radioKey,
              message: value.message as ObsMessage,
              addedAt: value.addedAt,
            });
            taken++;
          }
          cursor.continue();
        };
      });
    }
    return found
      .sort((a, b) => b.addedAt - a.addedAt || b.id - a.id)
      .slice(0, limit)
      .map(({ radioKey, message, addedAt }) => ({ radioKey, message, addedAt }));
  }

  /** Index range: one radio's rows after `dest`'s watermark. */
  private async radioRange(dest: string, kind: QueueKind, radioKey: string) {
    const after = await this.mark(dest, kind);
    return IDBKeyRange.bound([radioKey, after], [radioKey, Infinity], true, false);
  }

  /** How many rows of one radio wait for `dest`, counted on the index. */
  async countForRadio(dest: string, kind: QueueKind, radioKey: string): Promise<number> {
    const range = await this.radioRange(dest, kind, radioKey);
    const tx = this.db.transaction(STORES[kind], 'readonly');
    return req(tx.objectStore(STORES[kind]).index(RADIO_INDEX).count(range));
  }

  /** The newest row id of a kind, 0 when there is none. */
  async lastId(kind: QueueKind): Promise<number> {
    const tx = this.db.transaction(STORES[kind], 'readonly');
    const cursor = await req(tx.objectStore(STORES[kind]).openKeyCursor(null, 'prev'));
    return cursor ? Number(cursor.key) : 0;
  }

  /** The radios that have rows of `kind`, in key order. Walks the radio
   * index one radio at a time, jumping past each radio's rows. */
  async radios(kind: QueueKind): Promise<string[]> {
    const tx = this.db.transaction(STORES[kind], 'readonly');
    const index = tx.objectStore(STORES[kind]).index(RADIO_INDEX);
    const keys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursorReq = index.openKeyCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const radioKey = (cursor.key as [string, number])[0];
        keys.push(radioKey);
        cursor.continue([radioKey, Infinity]);
      };
    });
    return keys;
  }

  /** Deletes rows added more than `keepDays` ago that every destination
   * `destsFor(row radio)` names has acknowledged, and old rows of a radio
   * `dropWhenOld` names whether acknowledged or not. Rows are added in time
   * order, so the walk stops at the first row young enough to keep. Returns
   * how many went. */
  async prune(
    keepDays: number,
    destsFor: (radioKey: string) => string[],
    nowMs = Date.now(),
    dropWhenOld: (radioKey: string) => boolean = () => false
  ): Promise<number> {
    let removed = 0;
    const cutoff = nowMs - keepDays * DAY_MS;
    const markTx = this.db.transaction(MARKS, 'readonly');
    const allMarks = (await req(markTx.objectStore(MARKS).getAll())) as {
      key: string;
      id: number;
    }[];
    const marks = new Map(allMarks.map((m) => [m.key, m.id]));
    for (const kind of ['obs', 'track'] as QueueKind[]) {
      const tx = this.db.transaction(STORES[kind], 'readwrite');
      const store = tx.objectStore(STORES[kind]);
      await new Promise<void>((resolve, reject) => {
        const cursorReq = store.openCursor();
        cursorReq.onerror = () => reject(cursorReq.error);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return resolve();
          const value = cursor.value as StoredRow;
          if (value.addedAt >= cutoff) return resolve();
          const id = Number(cursor.key);
          const dests = destsFor(value.radioKey);
          const ackedByAll =
            dests.length > 0 && dests.every((d) => (marks.get(`${d}:${kind}`) ?? 0) >= id);
          if (ackedByAll || dropWhenOld(value.radioKey)) {
            cursor.delete();
            removed++;
          }
          cursor.continue();
        };
      });
      await done(tx);
    }
    return removed;
  }
}

/** Asks the browser to keep the queue under storage pressure; without it the
 * browser may clear a drive that is not uploaded yet. Asked on Start driving,
 * a tap, which some browsers want before they agree. A refusal changes nothing. */
export function keepQueue(): void {
  const storage = (navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } })
    .storage;
  void storage?.persist?.().catch(() => undefined);
}

export function openQueue(name = 'rtfm-wardrive'): Promise<Queue> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const store of Object.values(STORES)) {
        const os = db.objectStoreNames.contains(store)
          ? open.transaction!.objectStore(store)
          : db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
        // Version 2: per-radio reads and counts without walking other radios.
        if (!os.indexNames.contains(RADIO_INDEX)) os.createIndex(RADIO_INDEX, ['radioKey', 'id']);
      }
      if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(new Queue(open.result));
    open.onerror = () => reject(open.error);
  });
}
