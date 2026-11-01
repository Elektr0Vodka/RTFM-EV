// Drains the queue into RTFM-EV's local copy, one radio at a time: each
// radio has its own destination `rtfm@<KEY>`, like the brokers. Only radios
// on the logged-in account are uploaded; rows of another account's radio
// (two drivers sharing a browser) wait for that account to log in here and
// go after KEEP_DAYS. A failure never loses a row: on no network or a server
// error the rows stay and the next tick retries; on 401 uploads pause until
// the driver logs in again. 403 (the radio is no longer on the account, or
// the account is disabled) keeps the rows too and asks the page to read the
// account again, so a removed radio's rows wait like another account's. A
// batch the server refuses as such (400/422) is set aside so it does not
// block the queue for ever; it stays in the queue for the brokers. 404, 408
// and 429 are retried like a server error.
import { WardriveApiError, wardriveApi } from './api';
import type { ObsMessage, TrackMessage } from './messages';
import type { Queue, QueueKind } from './queue';

/** RTFM-EV's local copy of one radio's rows. */
export const localDest = (radioKey: string) => `rtfm@${radioKey}`;
/** Rows every destination has stay in the browser this long, then go; so do
 * rows of another account's radio, uploaded or not. */
export const KEEP_DAYS = 7;
const MAX_BATCHES_PER_TICK = 20;
/** Not found (a cached page meeting a server without the module), timeout and
 * rate limit (a proxy) say "not now", not "never": keep the rows. */
const RETRY_LATER = new Set([404, 408, 429]);
/** Pruning walks the queue, so it runs at most this often. */
const PRUNE_EVERY_MS = 3600000;
const KINDS: QueueKind[] = ['obs', 'track'];

export interface UploadStatus {
  state: 'idle' | 'uploading' | 'offline' | 'logged-out' | 'error';
  /** Rows of the account's radios (all radios while logged out) still to go. */
  pendingObs: number;
  pendingTracks: number;
  setAside: number;
  /** Receptions of radios on another account, waiting for it to log in here. */
  otherAccounts: number;
  lastError?: string;
  /** Whether this tick reached RTFM-EV: null when there was nothing to send,
   * which says nothing about the server. */
  reached: boolean | null;
}

type Outcome = 'empty' | 'sent' | 'stop';

export class Uploader {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private setAside = 0;
  private state: UploadStatus['state'] = 'idle';
  private lastError: string | undefined;
  private lastPruneAt: number | null = null;
  private reached: boolean | null = null;

  constructor(
    private queue: Queue,
    private api: Pick<typeof wardriveApi, 'upload'> = wardriveApi,
    private opts = { batch: 200, intervalMs: 10000 },
    /** Every destination a row of this radio is owed to: the local copy and
     * each broker switched on for the radio. */
    private destsFor: (radioKey: string) => string[] = (key) => [localDest(key)],
    /** The logged-in account's radio keys; null when nobody is logged in. */
    private accountRadios: () => readonly string[] | null = () => null,
    /** Asked after a 403: the account changed (radio removed, disabled). */
    private refreshAccount: () => void = () => {}
  ) {}

  /** Own radios with rows, and the other radios with rows. Null own: logged out. */
  private async split(): Promise<{ own: string[] | null; others: string[] }> {
    const inQueue = new Set<string>();
    for (const kind of KINDS) for (const key of await this.queue.radios(kind)) inQueue.add(key);
    const account = this.accountRadios();
    if (account === null) return { own: null, others: [...inQueue] };
    const mine = new Set(account.map((k) => k.toUpperCase()));
    const all = [...inQueue];
    return {
      own: all.filter((k) => mine.has(k.toUpperCase())),
      others: all.filter((k) => !mine.has(k.toUpperCase())),
    };
  }

  private async sendOne(kind: QueueKind, radioKey: string): Promise<Outcome> {
    const dest = localDest(radioKey);
    const rows = await this.queue.batchForRadio(dest, kind, radioKey, this.opts.batch, true);
    if (rows.length === 0) return 'empty';
    const messages = rows.map((r) => r.message);
    const lastId = rows[rows.length - 1].id;
    const driveId = rows[0].driveId;
    try {
      await this.api.upload({
        radio_key: radioKey,
        // One drive per batch; rows from before drives go without (RTFM-EV
        // then places them by the 10-minute gap rule).
        ...(driveId ? { drive_uid: driveId } : {}),
        obs: kind === 'obs' ? (messages as ObsMessage[]) : [],
        tracks: kind === 'track' ? (messages as TrackMessage[]) : [],
      });
    } catch (e) {
      const status = e instanceof WardriveApiError ? e.status : 0;
      this.reached = status !== 0;
      this.lastError = e instanceof Error ? e.message : String(e);
      if (status === 0) this.state = 'offline';
      else if (status === 401) this.state = 'logged-out';
      else if (status === 403) {
        this.state = 'error';
        this.refreshAccount();
      } else if (status >= 500 || RETRY_LATER.has(status)) this.state = 'error';
      else {
        // Refused as such: retrying sends the same refusal for ever.
        this.setAside += rows.length;
        this.state = 'error';
        await this.queue.ack(dest, kind, lastId);
      }
      return 'stop';
    }
    this.reached = true;
    await this.queue.ack(dest, kind, lastId);
    return 'sent';
  }

  /** One pass: obs first, then tracks, a batch at a time per radio of the
   * account, until those are sent or something fails. */
  async tick(): Promise<UploadStatus> {
    if (!this.running) {
      this.running = true;
      try {
        this.state = 'uploading';
        this.reached = null;
        const { own } = await this.split();
        let stopped = false;
        if (own === null) {
          // Nobody to upload as: the rows wait for a login.
          this.state = (await this.count(await this.allRadios())) > 0 ? 'logged-out' : 'idle';
          stopped = true;
        }
        for (const kind of KINDS) {
          let batches = 0;
          for (const key of own ?? []) {
            while (!stopped && batches < MAX_BATCHES_PER_TICK) {
              const outcome = await this.sendOne(kind, key);
              if (outcome === 'empty') break;
              batches++;
              if (outcome === 'stop') stopped = true;
            }
          }
          if (stopped) break;
        }
        if (!stopped) {
          this.state = 'idle';
          this.lastError = undefined;
        }
        const now = Date.now();
        if (this.lastPruneAt === null || now - this.lastPruneAt >= PRUNE_EVERY_MS) {
          this.lastPruneAt = now;
          // Logged out, nobody's rows count as another account's.
          const mine = own === null ? null : this.accountRadios();
          const mineUpper = new Set((mine ?? []).map((k) => k.toUpperCase()));
          await this.queue.prune(
            KEEP_DAYS,
            this.destsFor,
            now,
            (key) => mine !== null && !mineUpper.has(key.toUpperCase())
          );
        }
      } finally {
        this.running = false;
      }
    }
    return this.status();
  }

  private async allRadios(): Promise<string[]> {
    const { own, others } = await this.split();
    return [...(own ?? []), ...others];
  }

  /** Rows of `radios` not yet in the local copy. */
  private async count(radios: string[], kind?: QueueKind): Promise<number> {
    let total = 0;
    for (const k of kind ? [kind] : KINDS) {
      for (const key of radios) total += await this.queue.countForRadio(localDest(key), k, key);
    }
    return total;
  }

  async status(): Promise<UploadStatus> {
    const { own, others } = await this.split();
    const counted = own ?? others;
    return {
      state: this.state,
      pendingObs: await this.count(counted, 'obs'),
      pendingTracks: await this.count(counted, 'track'),
      setAside: this.setAside,
      otherAccounts: own === null ? 0 : await this.count(others, 'obs'),
      reached: this.reached,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  start(onStatus: (s: UploadStatus) => void): void {
    if (this.timer) return;
    const run = () => void this.tick().then(onStatus);
    run();
    this.timer = setInterval(run, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
