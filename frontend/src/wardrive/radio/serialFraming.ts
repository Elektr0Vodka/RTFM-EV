// Companion frames over USB serial: host to radio is 0x3c + uint16 LE length
// + frame, radio to host 0x3e + uint16 LE length + frame (meshcore serial_cx).
// Some radios print boot text on the same port, so the decoder skips bytes
// until a 0x3e and drops a header whose length cannot be a frame.

const HOST_TO_RADIO = 0x3c;
const RADIO_TO_HOST = 0x3e;
// Firmware frames are at most MAX_FRAME_SIZE: 172 in the DutchMeshCore build,
// 176 upstream (+4 for region transport codes). The margin is on purpose: a
// limit below what a newer firmware sends would drop its frames silently,
// while a looser one only resyncs a little later after junk bytes.
const MAX_FRAME = 300;

export function encodeSerialFrame(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + frame.length);
  out[0] = HOST_TO_RADIO;
  out[1] = frame.length & 0xff;
  out[2] = (frame.length >> 8) & 0xff;
  out.set(frame, 3);
  return out;
}

export class SerialFrameDecoder {
  private buf: number[] = [];

  /** Feed received bytes; returns every frame they complete. */
  push(chunk: Uint8Array): Uint8Array[] {
    for (const b of chunk) this.buf.push(b);
    const frames: Uint8Array[] = [];
    for (;;) {
      const start = this.buf.indexOf(RADIO_TO_HOST);
      if (start < 0) {
        this.buf = [];
        break;
      }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 3) break;
      const size = this.buf[1] | (this.buf[2] << 8);
      if (size > MAX_FRAME) {
        this.buf = this.buf.slice(1);
        continue;
      }
      if (this.buf.length < 3 + size) break;
      frames.push(new Uint8Array(this.buf.slice(3, 3 + size)));
      this.buf = this.buf.slice(3 + size);
    }
    return frames;
  }
}
