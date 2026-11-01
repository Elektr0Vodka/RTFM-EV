// How the page talks to the driver's companion radio: Web Bluetooth (Nordic
// UART service, one frame per write and per notification) or USB through Web
// Serial (framed, see serialFraming.ts).
import { SerialFrameDecoder, encodeSerialFrame } from './serialFraming';

const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const SERIAL_BAUD = 115200;

export interface RadioTransport {
  kind: 'ble' | 'usb';
  connect(): Promise<void>;
  send(frame: Uint8Array): Promise<void>;
  /** Returns a function that removes the listener. */
  onFrame(cb: (frame: Uint8Array) => void): () => void;
  onClose(cb: () => void): () => void;
  disconnect(): Promise<void>;
}

export const bleSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;
export const serialSupported = () => typeof navigator !== 'undefined' && !!navigator.serial;

export class Listeners<T> {
  private cbs: ((v: T) => void)[] = [];
  add(cb: (v: T) => void): () => void {
    this.cbs.push(cb);
    return () => {
      this.cbs = this.cbs.filter((x) => x !== cb);
    };
  }
  emit(v: T) {
    for (const cb of [...this.cbs]) cb(v);
  }
}

export class BleTransport implements RadioTransport {
  kind = 'ble' as const;
  private device: WardriveBluetoothDevice | null = null;
  private writeChar: WardriveBluetoothCharacteristic | null = null;
  private frames = new Listeners<Uint8Array>();
  private closes = new Listeners<void>();

  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS_SERVICE] }],
      optionalServices: [NUS_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => this.closes.emit());
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.writeChar = await service.getCharacteristic(NUS_WRITE);
    const notify = await service.getCharacteristic(NUS_NOTIFY);
    await notify.startNotifications();
    notify.addEventListener('characteristicvaluechanged', () => {
      const v = notify.value;
      if (v) {
        this.frames.emit(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
      }
    });
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error('The radio is not connected');
    await this.writeChar.writeValue(new Uint8Array(frame));
  }

  onFrame(cb: (frame: Uint8Array) => void) {
    return this.frames.add(cb);
  }

  onClose(cb: () => void) {
    return this.closes.add(cb);
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.writeChar = null;
  }
}

export class SerialTransport implements RadioTransport {
  kind = 'usb' as const;
  private port: WardriveSerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private frames = new Listeners<Uint8Array>();
  private closes = new Listeners<void>();

  async connect(): Promise<void> {
    if (!navigator.serial) throw new Error('Web Serial is not available');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: SERIAL_BAUD });
    this.writer = this.port.writable!.getWriter();
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const decoder = new SerialFrameDecoder();
    const port = this.port;
    // Web Serial pattern: a recoverable error (framing, buffer overrun) ends
    // one reader but leaves port.readable, so read again. A pulled cable or
    // disconnect() leaves no readable and ends the loop.
    while (port && this.port === port && port.readable) {
      try {
        this.reader = port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) decoder.push(value).forEach((f) => this.frames.emit(f));
        }
      } catch {
        // Try again while the port still has a readable.
      } finally {
        try {
          this.reader?.releaseLock();
        } catch {
          // Already released.
        }
        this.reader = null;
      }
    }
    // Let the port go so the driver can connect it again without a reload.
    await this.disconnect();
    this.closes.emit();
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('The radio is not connected');
    await this.writer.write(encodeSerialFrame(frame));
  }

  onFrame(cb: (frame: Uint8Array) => void) {
    return this.frames.add(cb);
  }

  onClose(cb: () => void) {
    return this.closes.add(cb);
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    // Each step on its own: one that fails must not keep the port open.
    const steps: (() => unknown)[] = [
      () => this.reader?.cancel(),
      () => this.reader?.releaseLock(),
      () => this.writer?.releaseLock(),
      () => port?.close(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch {
        // Already released or closed.
      }
    }
    this.writer = null;
    this.reader = null;
  }
}
