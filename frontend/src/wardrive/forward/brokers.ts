// Where the wardrive page can forward to. The DutchMeshCore collectors and
// their stream labels are the ones rx.mesh-hunter.eu publishes to
// (config.json, 2026-10-19): `hunter` is for hunts, `wardriver` for coverage
// drives. on8ar's EMQX takes the older `packets` format and needs the
// driver's own account; RTFM-EV ships no credential for it.

export type BrokerId = 'dmc-hunter' | 'dmc-wardriver' | 'on8ar';

export interface Broker {
  id: BrokerId;
  url: string;
  format: 'wardrive' | 'packets';
  /** Stream label in the wardrive topic (meshcore/<label>/<KEY>/...). */
  label?: string;
  /** companion: a token the radio signs; password: the driver's account. */
  auth: 'companion' | 'password';
}

export const BROKERS: Broker[] = [
  {
    id: 'dmc-hunter',
    url: 'wss://collector1.dutchmeshcore.nl:443',
    format: 'wardrive',
    label: 'hunter',
    auth: 'companion',
  },
  {
    id: 'dmc-wardriver',
    url: 'wss://collector2.dutchmeshcore.nl:443',
    format: 'wardrive',
    label: 'wardriver',
    auth: 'companion',
  },
  { id: 'on8ar', url: 'wss://emqx.on8ar.eu:8084/ws', format: 'packets', auth: 'password' },
];

/** The queue destination of a broker for one radio. */
export function destId(id: BrokerId, radioKey: string): string {
  return `${id}@${radioKey.toUpperCase()}`;
}
