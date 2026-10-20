// The driver's companion radio: its identity, what it hears, and signing.
import type { DirectoryNode } from '../names';
import {
  CMD_GET_CONTACTS,
  CMD_GET_STATS,
  RESP_STATS,
  CMD_SIGN_DATA,
  CMD_SIGN_FINISH,
  CMD_SIGN_START,
  RESP_CONTACT,
  RESP_END_OF_CONTACTS,
  RESP_ERR,
  RESP_OK,
  RESP_SIGNATURE,
  RESP_SIGN_START,
  SIGN_CHUNK,
  appStartFrame,
  parseContact,
  parseRxLog,
  parseSelfInfo,
} from './protocol';
import type { RadioTransport } from './transport';

const APP_NAME = 'rtfm-ev-wardrive';
const START_TIMEOUT_MS = 6000;
const SIGN_TIMEOUT_MS = 8000;
const CONTACTS_TIMEOUT_MS = 8000;
const STATS_TIMEOUT_MS = 4000;
const STATS_QUIET_MS = 5 * 60 * 1000;
const TRANSMIT_TIMEOUT_MS = 3000;
/** RESP_CODE_SENT: a directed packet was queued for the air. */
const RESP_SENT = 6;

export interface RadioReception {
  snr: number;
  rssi: number;
  raw: Uint8Array;
}

export class Companion {
  // Signing and reading the contact table both hold a conversation with the
  // radio, so they take turns.
  private signing: Promise<unknown> = Promise.resolve();
  // Set when a sign step timed out: its answer may still come. The radio
  // answers in order, so once the next signing's start is answered all late
  // replies are behind us; until then an error frame is not taken as ours.
  private lateReplies = false;
  private statsQuietUntil = 0;

  constructor(readonly transport: RadioTransport) {}

  /** APP_START, resolving with the radio's own public key and name. */
  start(): Promise<{ publicKey: string; name: string; sf: number | null }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('The radio did not answer'));
      }, START_TIMEOUT_MS);
      const off = this.transport.onFrame((frame) => {
        const info = parseSelfInfo(frame);
        if (!info) return;
        clearTimeout(timer);
        off();
        resolve(info);
      });
      this.transport.send(appStartFrame(APP_NAME)).catch((e) => {
        clearTimeout(timer);
        off();
        reject(e);
      });
    });
  }

  onReception(cb: (r: RadioReception) => void): () => void {
    return this.transport.onFrame((frame) => {
      const r = parseRxLog(frame);
      if (r) cb(r);
    });
  }

  /** The radio's own contacts (names and advertised positions). A local
   * exchange with the companion, nothing goes over the air. Resolves with
   * what arrived when the end does not come in time. */
  contacts(timeoutMs = CONTACTS_TIMEOUT_MS): Promise<DirectoryNode[]> {
    const run = this.signing.then(() => this.contactsNow(timeoutMs));
    this.signing = run.catch(() => undefined);
    return run;
  }

  private contactsNow(timeoutMs: number): Promise<DirectoryNode[]> {
    return new Promise((resolve) => {
      const found: DirectoryNode[] = [];
      const finish = () => {
        clearTimeout(timer);
        off();
        resolve(found);
      };
      const timer = setTimeout(finish, timeoutMs);
      const off = this.transport.onFrame((frame) => {
        if (frame[0] === RESP_CONTACT) {
          const c = parseContact(frame);
          if (c) found.push(c);
        } else if (frame[0] === RESP_END_OF_CONTACTS) {
          finish();
        }
      });
      this.transport.send(new Uint8Array([CMD_GET_CONTACTS])).catch(finish);
    });
  }

  /** A stats reply (`CMD_GET_STATS`: 0 core, 1 radio), null when the radio
   * does not answer in time (older firmware). A local request to the
   * companion; nothing goes over the air. Runs in the one-at-a-time chain. */
  stats(type: 0 | 1, timeoutMs = STATS_TIMEOUT_MS): Promise<Uint8Array | null> {
    // A radio that did not answer (older firmware) is not asked again for a
    // while: each wait would hold up signing behind it.
    if (Date.now() < this.statsQuietUntil) return Promise.resolve(null);
    const run = this.signing.then(() => this.statsNow(type, timeoutMs));
    this.signing = run.catch(() => undefined);
    return run;
  }

  private statsNow(type: 0 | 1, timeoutMs: number): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const finish = (frame: Uint8Array | null) => {
        clearTimeout(timer);
        off();
        resolve(frame);
      };
      const timer = setTimeout(() => {
        this.statsQuietUntil = Date.now() + STATS_QUIET_MS;
        finish(null);
      }, timeoutMs);
      const off = this.transport.onFrame((frame) => {
        if (frame[0] === RESP_STATS && frame[1] === type) finish(frame);
      });
      this.transport.send(new Uint8Array([CMD_GET_STATS, type])).catch(() => finish(null));
    });
  }

  /** A command that makes the radio transmit (only Auto-discover sends
   * these). In the one-at-a-time chain, so its OK cannot be taken for a sign
   * step's. `sent`: the radio answered OK (`'ok'`) or SENT (`'sent'`), or did
   * not answer in time (it may have gone out); false on ERR or a link error. */
  transmit(
    frame: Uint8Array,
    accept: 'ok' | 'sent',
    timeoutMs = TRANSMIT_TIMEOUT_MS
  ): Promise<{ sent: boolean; reply: Uint8Array | null }> {
    const run = this.signing.then(() => this.transmitNow(frame, accept, timeoutMs));
    this.signing = run.catch(() => undefined);
    return run;
  }

  private transmitNow(
    frame: Uint8Array,
    accept: 'ok' | 'sent',
    timeoutMs: number
  ): Promise<{ sent: boolean; reply: Uint8Array | null }> {
    const want = accept === 'ok' ? RESP_OK : RESP_SENT;
    return new Promise((resolve) => {
      const finish = (r: { sent: boolean; reply: Uint8Array | null }) => {
        clearTimeout(timer);
        off();
        resolve(r);
      };
      const timer = setTimeout(() => finish({ sent: true, reply: null }), timeoutMs);
      const off = this.transport.onFrame((reply) => {
        if (reply[0] === want) finish({ sent: true, reply });
        else if (reply[0] === RESP_ERR) finish({ sent: false, reply: null });
      });
      this.transport.send(frame).catch(() => finish({ sent: false, reply: null }));
    });
  }

  /** One local command and the first reply `accept` reads (the contact read
   * and write of a directed ask), null on a timeout. In the chain. */
  request<T>(
    frame: Uint8Array,
    accept: (reply: Uint8Array) => T | null,
    timeoutMs: number
  ): Promise<T | null> {
    const run = this.signing.then(
      () =>
        new Promise<T | null>((resolve) => {
          const finish = (v: T | null) => {
            clearTimeout(timer);
            off();
            resolve(v);
          };
          const timer = setTimeout(() => finish(null), timeoutMs);
          const off = this.transport.onFrame((reply) => {
            const v = accept(reply);
            if (v !== null) finish(v);
          });
          this.transport.send(frame).catch(() => finish(null));
        })
    );
    this.signing = run.catch(() => undefined);
    return run;
  }

  /** Every frame from the radio (the answers to directed asks are pushes). */
  onPush(cb: (frame: Uint8Array) => void): () => void {
    return this.transport.onFrame(cb);
  }

  /** The radio's Ed25519 signature over `bytes`. The radio has one sign
   * buffer, so signings run one at a time. */
  sign(bytes: Uint8Array): Promise<Uint8Array> {
    const run = this.signing.then(() => this.signNow(bytes));
    this.signing = run.catch(() => undefined);
    return run;
  }

  private exchange(frame: Uint8Array, accept: number[], ignoreErrors = false): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        this.lateReplies = true;
        reject(new Error('The radio did not answer the sign request'));
      }, SIGN_TIMEOUT_MS);
      const off = this.transport.onFrame((reply) => {
        if (reply[0] === RESP_ERR && !ignoreErrors) {
          clearTimeout(timer);
          off();
          reject(new Error(`The radio refused to sign (error ${reply[1]})`));
          return;
        }
        if (!accept.includes(reply[0])) return;
        clearTimeout(timer);
        off();
        resolve(reply);
      });
      this.transport.send(frame).catch((e) => {
        clearTimeout(timer);
        off();
        reject(e);
      });
    });
  }

  private async signNow(bytes: Uint8Array): Promise<Uint8Array> {
    const started = await this.exchange(
      new Uint8Array([CMD_SIGN_START]),
      [RESP_SIGN_START],
      this.lateReplies
    );
    this.lateReplies = false;
    const view = new DataView(started.buffer, started.byteOffset, started.byteLength);
    const maxLen = view.getUint32(2, true);
    if (bytes.length > maxLen) {
      throw new Error(`Too long for the radio to sign: ${bytes.length} bytes, limit ${maxLen}`);
    }
    for (let i = 0; i < bytes.length; i += SIGN_CHUNK) {
      const part = bytes.subarray(i, i + SIGN_CHUNK);
      const frame = new Uint8Array(1 + part.length);
      frame[0] = CMD_SIGN_DATA;
      frame.set(part, 1);
      await this.exchange(frame, [RESP_OK]);
    }
    const done = await this.exchange(new Uint8Array([CMD_SIGN_FINISH]), [RESP_SIGNATURE]);
    if (done.length < 65) throw new Error('The radio returned a short signature');
    return done.slice(1, 65);
  }
}
