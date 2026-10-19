import type { RawPacket } from '../types';

/**
 * Damaged frames from Full capture (meshcomod): frames the radio received with
 * a CRC or header error. They arrive as a WS-only `rx_bad_frame` event, live in
 * their own store (never the raw packet store the map, visualizer and stats
 * read) and are only shown in the Packet Feed behind "Show damaged frames".
 * Their bytes are never decoded.
 */
export const DAMAGED_PAYLOAD_TYPE = 'DAMAGED';

export interface RxBadFrame {
  id: number;
  observation_id: number;
  timestamp: number;
  /** Frame bytes as received, hex. */
  data: string;
  /** 1 CRC error, 2 header damaged, 3 other read error. */
  status: number;
  snr: number | null;
  rssi: number | null;
}

const STATUS_LABELS: Record<number, string> = {
  1: 'CRC error',
  2: 'header damaged',
  3: 'read error',
};

export function isDamaged(packet: Pick<RawPacket, 'damaged_status'>): boolean {
  return packet.damaged_status != null;
}

export function damagedSummary(status: number): string {
  return `Damaged frame (${STATUS_LABELS[status] ?? 'read error'})`;
}

export function rxBadFrameToRawPacket(frame: RxBadFrame): RawPacket {
  return {
    id: frame.id,
    observation_id: frame.observation_id,
    timestamp: frame.timestamp,
    data: frame.data,
    payload_type: DAMAGED_PAYLOAD_TYPE,
    snr: frame.snr,
    rssi: frame.rssi,
    decrypted: false,
    decrypted_info: null,
    damaged_status: frame.status,
  };
}

/** The feed's packets plus the damaged frames when the switch is on. */
export function withDamagedFrames(
  packets: RawPacket[],
  damaged: RawPacket[],
  show: boolean
): RawPacket[] {
  return show && damaged.length > 0 ? [...packets, ...damaged] : packets;
}
