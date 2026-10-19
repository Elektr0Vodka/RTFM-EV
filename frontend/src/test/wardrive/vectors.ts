// Reference vectors produced by running core-hunter's app/src/wardrive.js
// unmodified (github.com/Elektr0Vodka/core-hunter, master, 2026-10-19): the
// obs/track shape the DutchMeshCore collectors receive from the mesh-hunter
// RX page. The wardrive page must produce exactly these.

export const FRAME_VECTORS = [
  {
    raw: '1502a1b2c0ffee00112233445566',
    hash: '6cff0822e645114e',
    walk: {
      routeType: 1,
      payloadType: 5,
      pathLen: 2,
      hops: ['a1', 'b2'],
      payloadStart: 4,
    },
  },
  {
    raw: '0a00deadbeef0102',
    hash: '02c306ce0e4b623e',
    walk: {
      routeType: 2,
      payloadType: 2,
      pathLen: 0,
      hops: [],
      payloadStart: 2,
    },
  },
  {
    raw: '100102030401aa00112233445566778899',
    hash: '6d3914a48f68bdaf',
    walk: {
      routeType: 0,
      payloadType: 4,
      pathLen: 1,
      hops: ['aa'],
      payloadStart: 7,
    },
  },
  {
    raw: '2603101112aabbccdd00000000ee',
    hash: '550eacba993b08b4',
    walk: {
      routeType: 2,
      payloadType: 9,
      pathLen: 3,
      hops: ['10', '11', '12'],
      payloadStart: 5,
    },
  },
  {
    raw: '1542a1a2b1b20102030405',
    hash: 'a6c80973d6f553b8',
    walk: {
      routeType: 1,
      payloadType: 5,
      pathLen: 66,
      hops: ['a1a2', 'b1b2'],
      payloadStart: 6,
    },
  },
  {
    raw: '15',
    hash: null,
    walk: null,
  },
] as const;

// buildObs({ raw: FRAME_VECTORS[0].raw, rx_at: '2026-10-19T10:00:00.000Z', rssi: -92,
//   snr: 6.5, lat: 52.1234567, lon: 5.7654321, acc_m: 4.25 },
//   { originId: 'AB' x 32, pubAt: '2026-10-19T10:00:01.000Z' })
export const OBS_VECTOR = {
  v: 1,
  origin_id: 'ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB',
  rx_at: '2026-10-19T10:00:00.000Z',
  pub_at: '2026-10-19T10:00:01.000Z',
  hash: '6cff0822e645114e',
  raw: '1502a1b2c0ffee00112233445566',
  len: 14,
  packet_type: 5,
  route: 'F',
  payload_len: 10,
  path: ['a1', 'b2'],
  RSSI: -92,
  SNR: 6.5,
  pos: {
    lat: 52.123457,
    lon: 5.765432,
    accuracy: 4.3,
    src: 'phone',
  },
};

// The same with acc_m and rssi undefined and no pubAt.
export const OBS_NOACC_VECTOR = {
  v: 1,
  origin_id: 'ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB',
  rx_at: '2026-10-19T10:00:00.000Z',
  hash: '6cff0822e645114e',
  raw: '1502a1b2c0ffee00112233445566',
  len: 14,
  packet_type: 5,
  route: 'F',
  payload_len: 10,
  path: ['a1', 'b2'],
  SNR: 6.5,
  pos: {
    lat: 52.123457,
    lon: 5.765432,
    src: 'phone',
  },
};

// buildTrack({ originId: 'AB' x 32, t0: 'a', t1: 'b', lat: 52.1234567,
//   lon: 5.7654321, accM: 4.25, rxCount: 3, listening: true })
export const TRACK_VECTOR = {
  v: 1,
  origin_id: 'ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB',
  t0: 'a',
  t1: 'b',
  lat: 52.123457,
  lon: 5.765432,
  accuracy: 4.3,
  rx_count: 3,
  listening: true,
  src: 'phone',
};
