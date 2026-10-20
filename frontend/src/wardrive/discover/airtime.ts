// LoRa time on air for the frames Auto-discover sends, and the silence a
// cycle buys afterwards, by the firmware's own numbers (core-hunter
// airtime.js): RadioLib's getTimeOnAir in integer arithmetic (explicit
// header, CRC on, CR 4/5), the preamble the firmware uses (32 symbols up to
// SF8, 16 above), the default preset's 62.5 kHz, and a 10% duty budget for
// the 869.4-869.65 MHz sub-band (ERC 70-03). The spreading factor comes from
// the radio (SELF_INFO byte 56); unknown reads as 8.

export const DUTY_BUDGET = 0.1;
export const DEFAULT_SF = 8;
export const BW_KHZ = 62.5;
/** Frame sizes on air (Packet::getRawLength = 2 + path + payload). */
export const DISCOVER_BYTES = 8;
export const TRACE_BYTES = 12;
export const TELEMETRY_REQ_BYTES = 22;
export const ANON_REQ_BYTES = 53;

/** The companion's own advert for the name it sends. The location bytes
 * always count: the floor errs long, never short. */
export function advertBytes(name: string): number {
  const nameBytes = new TextEncoder().encode(name || '').length;
  return 2 + 32 + 4 + 64 + Math.min(1 + 8 + nameBytes, 32);
}

const knownSf = (sf: number | null | undefined) =>
  typeof sf === 'number' && Number.isInteger(sf) && sf >= 5 && sf <= 12 ? sf : DEFAULT_SF;

export function frameAirtimeMs(bytes: number, sf?: number | null, bwKhz = BW_KHZ): number {
  const s = knownSf(sf);
  const symbolUs = Math.floor((10000 * 2 ** s) / (bwKhz * 10));
  const coeff1x4 = s <= 6 ? 25 : 17;
  const coeff2 = s <= 6 ? 0 : 8;
  const divisor = symbolUs >= 16000 ? 4 * (s - 2) : 4 * s;
  const bits = Math.max(0, 8 * Math.max(0, bytes || 0) + 16 - 4 * s + coeff2 + 20);
  const groups = Math.ceil(bits / divisor);
  const preamble = s <= 8 ? 32 : 16;
  const symbolsX4 = (preamble + 8) * 4 + coeff1x4 + groups * 5 * 4;
  return Math.floor((symbolUs * symbolsX4) / 4 / 1000);
}

export function cycleAirtimeMs(frameBytes: number[], sf?: number | null): number {
  return frameBytes.reduce((sum, b) => sum + frameAirtimeMs(b, sf), 0);
}

/** How long after a cycle the next may start, to stay inside the budget. */
export function minPeriodMs(frameBytes: number[], sf?: number | null): number {
  return Math.round(cycleAirtimeMs(frameBytes, sf) / DUTY_BUDGET);
}
