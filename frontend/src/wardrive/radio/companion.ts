// The driver's companion radio: its identity, what it hears, and signing.
import {
  CMD_SIGN_DATA,
  CMD_SIGN_FINISH,
  CMD_SIGN_START,
  RESP_ERR,
  RESP_OK,
  RESP_SIGNATURE,
  RESP_SIGN_START,
  SIGN_CHUNK,
  appStartFrame,
  parseRxLog,
  parseSelfInfo,
} from './protocol';
import type { RadioTransport } from './transport';

const APP_NAME = 'rtfm-ev-wardrive';
const START_TIMEOUT_MS = 6000;
const SIGN_TIMEOUT_MS = 8000;

export interface RadioReception {
  snr: number;
  rssi: number;
  raw: Uint8Array;
}

export class Companion {
  private signing: Promise<unknown> = Promise.resolve();
  // Set when a sign step timed out: its answer may still come. The radio
  // answers in order, so once the next signing's start is answered all late
  // replies are behind us; until then an error frame is not taken as ours.
  private lateReplies = false;

  constructor(readonly transport: RadioTransport) {}

  /** APP_START, resolving with the radio's own public key and name. */
  start(): Promise<{ publicKey: string; name: string }> {
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
