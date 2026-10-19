// The three status dots in the top bar: the radio, the brokers switched on for
// it, and the upload to RTFM-EV.
import { useT } from '../../i18n';
import type { ForwardStatus } from '../forward/forwarder';
import type { UploadStatus } from '../uploader';

export type RadioDot = 'on' | 'lost' | 'off';
export type BrokerDot = 'all' | 'some' | 'none' | 'off';
export type UploadDot = 'ok' | 'waiting' | 'offline' | 'logged-out';

export function radioDot(connected: boolean, lost: boolean): RadioDot {
  if (connected) return 'on';
  return lost ? 'lost' : 'off';
}

export function brokerDot(
  enabledDests: string[],
  statuses: Record<string, ForwardStatus>
): BrokerDot {
  if (enabledDests.length === 0) return 'off';
  const up = enabledDests.filter((d) => statuses[d]?.state === 'connected').length;
  if (up === enabledDests.length) return 'all';
  return up > 0 ? 'some' : 'none';
}

export function uploadDot(s: UploadStatus | null, offline: boolean): UploadDot {
  if (offline || s?.state === 'offline') return 'offline';
  if (s?.state === 'logged-out') return 'logged-out';
  if (!s || s.pendingObs + s.pendingTracks > 0) return 'waiting';
  return 'ok';
}

export interface Dots {
  radio: RadioDot;
  brokers: BrokerDot;
  upload: UploadDot;
}

const GOOD = 'bg-status-connected';
const BAD = 'bg-status-disconnected';
const WARN = 'bg-amber-400 cvd:bg-warning';
const IDLE = 'bg-muted-foreground/40';

const RADIO_CLASS: Record<RadioDot, string> = { on: GOOD, lost: BAD, off: IDLE };
const BROKER_CLASS: Record<BrokerDot, string> = { all: GOOD, some: WARN, none: BAD, off: IDLE };
const UPLOAD_CLASS: Record<UploadDot, string> = {
  ok: GOOD,
  waiting: WARN,
  offline: BAD,
  'logged-out': IDLE,
};

const STATE_KEY: Record<RadioDot | BrokerDot | UploadDot, string> = {
  on: 'wardrive_page_dot_on',
  lost: 'wardrive_page_dot_lost',
  off: 'wardrive_page_dot_off',
  all: 'wardrive_page_dot_all',
  some: 'wardrive_page_dot_some',
  none: 'wardrive_page_dot_none',
  ok: 'wardrive_page_dot_ok',
  waiting: 'wardrive_page_dot_waiting',
  offline: 'wardrive_page_dot_offline',
  'logged-out': 'wardrive_page_dot_logged_out',
};

export function StatusDots({ dots }: { dots: Dots }) {
  const t = useT();
  const items: [string, string, string][] = [
    [
      'radio',
      RADIO_CLASS[dots.radio],
      t('wardrive_page_dot_radio', { state: t(STATE_KEY[dots.radio]) }),
    ],
    [
      'brokers',
      BROKER_CLASS[dots.brokers],
      t('wardrive_page_dot_brokers', { state: t(STATE_KEY[dots.brokers]) }),
    ],
    [
      'upload',
      UPLOAD_CLASS[dots.upload],
      t('wardrive_page_dot_upload', { state: t(STATE_KEY[dots.upload]) }),
    ],
  ];
  return (
    <span className="flex flex-col gap-0.5">
      {items.map(([id, cls, label]) => (
        <i
          key={id}
          role="img"
          aria-label={label}
          title={label}
          data-dot={id}
          className={`block h-1.5 w-1.5 rounded-full ${cls}`}
        />
      ))}
    </span>
  );
}
