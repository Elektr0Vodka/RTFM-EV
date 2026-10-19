import { afterEach, describe, expect, it, vi } from 'vitest';

import { SerialTransport } from '../../wardrive/radio/transport';

const FRAME = [0x88, 0x10, 0xa6, 0x15, 0x00, 0x01];

/** A Web Serial port whose first readable errors (a framing error, say) and
 * whose second carries one frame and ends; after that it has no readable. */
function fakePort() {
  let opens = 0;
  let reads = 0;
  const closed = vi.fn();
  const port = {
    async open() {
      opens++;
    },
    async close() {
      closed();
    },
    get readable() {
      reads++;
      if (reads === 1) {
        return new ReadableStream<Uint8Array>({
          start(c) {
            c.error(new Error('framing error'));
          },
        });
      }
      if (reads === 2) {
        return new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array([0x3e, FRAME.length, 0, ...FRAME]));
            c.close();
          },
        });
      }
      return null;
    },
    writable: new WritableStream<Uint8Array>(),
  };
  return { port, closed, opens: () => opens };
}

afterEach(() => {
  delete (navigator as { serial?: unknown }).serial;
});

describe('SerialTransport', () => {
  it('keeps reading after a recoverable read error and closes the port when it ends', async () => {
    const { port, closed } = fakePort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port },
    });
    const t = new SerialTransport();
    const frames: number[][] = [];
    t.onFrame((f) => frames.push(Array.from(f)));
    const ended = new Promise<void>((r) => t.onClose(r));
    await t.connect();
    await ended;
    expect(frames).toEqual([FRAME]);
    expect(closed).toHaveBeenCalled();
  });
});
