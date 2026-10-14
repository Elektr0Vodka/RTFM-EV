/**
 * The text command line of a repeater or room server over USB (Web Serial).
 *
 * The firmware reads a line ending in "\r", echoes it, and answers with
 * "  -> <reply>\r\n" (examples/simple_repeater/main.cpp). A reply can hold
 * "\n" inside it (the region tree, the filter tables); it ends at "\r\n".
 *
 * This is a transport only: which commands to send and what the replies mean
 * is decided by the server (app/services/fleet_device_cli.py). As a second
 * guard it refuses every command that is not one the server plans: no
 * "erase", no "reboot", nothing that makes the device transmit.
 */

/** The part of the Web Serial SerialPort this needs. */
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

export interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

export type WebSerialStatus = 'ok' | 'no_api' | 'insecure';

/** Whether this browser can open a USB serial port here. */
export function webSerialStatus(
  nav: Navigator = navigator,
  secure: boolean = typeof window !== 'undefined' && window.isSecureContext
): WebSerialStatus {
  if (!('serial' in nav) || !(nav as Navigator & { serial?: unknown }).serial) return 'no_api';
  if (!secure) return 'insecure';
  return 'ok';
}

export function webSerial(): SerialLike | null {
  if (webSerialStatus() !== 'ok') return null;
  return (navigator as Navigator & { serial: SerialLike }).serial;
}

// The same rule as command_allowed in app/services/fleet_device_cli.py.
const ALLOWED = ['ver', 'board', 'get', 'set', 'filter', 'region'];
const REGION_SUBCOMMANDS = ['', 'home', 'default', 'save'];
const FILTER_SUBCOMMANDS = ['', 'hops', 'rate', 'channel', 'hash', 'malformed', 'on', 'off'];
const REFUSED_SET_KEYS = ['freq'];
// The firmware reads a command line into 160 bytes.
const MAX_COMMAND_LENGTH = 159;

export function commandAllowed(command: string): boolean {
  if (!command || command !== command.trim() || command.length > MAX_COMMAND_LENGTH) return false;
  if (/[\r\n\0]/.test(command)) return false;
  const words = command.split(' ');
  const head = words[0];
  if (!ALLOWED.includes(head)) return false;
  const sub = words[1] ?? '';
  if (head === 'region') return REGION_SUBCOMMANDS.includes(sub);
  if (head === 'filter') {
    if (!FILTER_SUBCOMMANDS.includes(sub)) return false;
    if (sub === 'channel') return ['list', 'add', 'remove'].includes(words[2] ?? '');
    return true;
  }
  if (head === 'get' || head === 'set') {
    if (!sub) return false;
    return !(head === 'set' && REFUSED_SET_KEYS.includes(sub));
  }
  return words.length === 1;
}

export class CommandRefusedError extends Error {
  constructor(command: string) {
    super(`This command is not sent over the cable: ${command.split(' ')[0]}`);
    this.name = 'CommandRefusedError';
  }
}

const MARKER = '  -> ';

export class SerialCli {
  private readonly timeoutMs: number;
  private readonly gapMs: number;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = '';
  private wake: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private reading = false;

  constructor(
    private readonly port: SerialPortLike,
    // 5 s per reply and 100 ms between commands, as the toolbox's console uses.
    options: { timeoutMs?: number; gapMs?: number } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.gapMs = options.gapMs ?? 100;
  }

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate });
    if (!this.port.readable || !this.port.writable) throw new Error('The port cannot be used');
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.reading = true;
    void this.readLoop();
  }

  async close(): Promise<void> {
    this.reading = false;
    try {
      await this.reader?.cancel();
    } catch {
      // already closed
    }
    try {
      this.reader?.releaseLock();
    } catch {
      // already released
    }
    try {
      await this.writer?.close();
    } catch {
      // already closed
    }
    try {
      this.writer?.releaseLock();
    } catch {
      // already released
    }
    this.reader = null;
    this.writer = null;
    await this.port.close();
  }

  /** Send one command; its reply, or null when the device did not answer in time. */
  send(command: string): Promise<string | null> {
    if (!commandAllowed(command)) return Promise.reject(new CommandRefusedError(command));
    const run = this.queue.then(() => this.exchange(command));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    while (this.reading && this.reader) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await this.reader.read();
      } catch {
        break;
      }
      if (chunk.done) break;
      this.buffer += decoder.decode(chunk.value, { stream: true });
      this.wake?.();
    }
    this.reading = false;
    this.wake?.();
  }

  /** The reply in the buffer for ``command``, consuming it, or null when not complete yet. */
  private takeReply(command: string): string | null {
    // The firmware echoes every character of the line, then "\n". The reply is
    // only looked for after that echo, so a late answer to an earlier command
    // that timed out is never taken for this one.
    const echo = this.buffer.indexOf(`${command}\r`);
    if (echo === -1) return null;
    const marker = this.buffer.indexOf(MARKER, echo + command.length + 1);
    if (marker === -1) return null;
    const end = this.buffer.indexOf('\r\n', marker + MARKER.length);
    if (end === -1) return null;
    const reply = this.buffer.slice(marker + MARKER.length, end);
    this.buffer = this.buffer.slice(end + 2);
    return reply;
  }

  private async exchange(command: string): Promise<string | null> {
    if (!this.writer) throw new Error('The port is not open');
    // Whatever came before this command (boot text, a late reply) is not its answer.
    this.buffer = '';
    await this.writer.write(new TextEncoder().encode(`${command}\r`));
    const deadline = Date.now() + this.timeoutMs;
    let reply: string | null = null;
    while (reply === null && this.reading) {
      reply = this.takeReply(command);
      if (reply !== null) break;
      const left = deadline - Date.now();
      if (left <= 0) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, left);
        function done() {
          clearTimeout(timer);
          resolve();
        }
        this.wake = done;
      });
      this.wake = null;
    }
    if (reply === null) this.buffer = '';
    if (this.gapMs > 0) await new Promise((resolve) => setTimeout(resolve, this.gapMs));
    return reply;
  }
}
