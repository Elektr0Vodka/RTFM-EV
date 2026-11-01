import { describe, expect, it } from 'vitest';

import { pointDetails } from '../../../wardrive/coverage/details';
import { point } from './fixtures';

// English values of the keys used, enough to read the rows.
const EN: Record<string, string> = {
  wardrive_popup_heard: 'Heard',
  wardrive_popup_driver: 'Driver',
  wardrive_popup_radio: 'Radio',
  wardrive_popup_drive: 'Drive',
  wardrive_popup_signal: 'Signal',
  wardrive_popup_packet: 'Packet',
  wardrive_popup_route_flood: 'flood',
  wardrive_popup_route_direct: 'direct',
  wardrive_popup_hops: 'Hops',
  wardrive_popup_position: 'Position',
  wardrive_popup_hash: 'Hash',
  wardrive_popup_published: 'Published',
  wardrive_popup_uploaded: 'Uploaded',
  wardrive_cov_popup_channel: 'Channel',
  wardrive_map_unknown: 'unknown',
  wardrive_page_type_group_text: 'GroupText',
};
const t = ((key: string, vars?: Record<string, unknown>) =>
  key === 'wardrive_popup_bytes' ? `${vars?.count} bytes` : (EN[key] ?? key)) as never;

describe('reception card rows', () => {
  it('lists every stored field', () => {
    const rows = pointDetails(
      point({
        drive_name: 'Ochtend',
        len: 30,
        pub_at: '2026-10-20T10:00:01.000Z',
        uploaded_at: 1792404100,
        src: 'phone',
      }),
      t,
      'decimal'
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Heard',
      'Driver',
      'Radio',
      'Drive',
      'Signal',
      'Channel',
      'Packet',
      'Hops',
      'Position',
      'Hash',
      'Published',
      'Uploaded',
    ]);
    const value = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(value('Radio')).toBe('car (AA)');
    expect(value('Drive')).toBe('Ochtend');
    expect(value('Signal')).toBe('-85 dBm, SNR 5 dB');
    expect(value('Channel')).toBe('#test');
    expect(value('Packet')).toBe('GroupText, flood, 30 bytes');
    expect(value('Position')).toMatch(/52\.1.*5\.1.*± 4 m \(phone\)/);
  });

  it('leaves out what was not stored', () => {
    const rows = pointDetails(
      point({ channel: null, drive_id: null, drive_name: null, pub_at: null, uploaded_at: null }),
      t,
      'decimal'
    );
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Drive');
    expect(labels).not.toContain('Channel');
    expect(labels).not.toContain('Published');
  });
});
