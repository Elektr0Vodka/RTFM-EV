import type { MapPoint } from '../../../wardrive/coverage/types';

/** A stored reception as /map/points sends it. */
export function point(over: Partial<MapPoint> = {}): MapPoint {
  return {
    rx_at: '2026-10-20T10:00:00.000Z',
    rx_ts: 1792404000,
    rssi: -85,
    snr: 5,
    lat: 52.1,
    lon: 5.1,
    accuracy: 4,
    user_id: 1,
    driver: 'anna',
    radio_key: 'AA',
    radio_name: 'car',
    packet_type: 5,
    packet_type_name: 'GroupText',
    route: 'F',
    path: [],
    hops: 1,
    sender: { kind: 'relay', id: 'c3d4', label: null, role: null },
    name: 'Toren',
    guess: true,
    channel: '#test',
    drive_id: 7,
    drive_name: null,
    hash: '00',
    pub_at: null,
    uploaded_at: null,
    len: null,
    payload_len: null,
    src: null,
    ...over,
  };
}
