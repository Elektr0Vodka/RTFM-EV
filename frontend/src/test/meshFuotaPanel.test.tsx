import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeshFuotaPanel } from '../components/MeshFuotaPanel';
import type { Contact } from '../types';

const WINDOW = { key: '24h', label: '24h', hours: 24, autoRefresh: false };

const CAMPAIGN = {
  campaign: 'deadbeef',
  first_seen: 1700000000,
  last_seen: 1700000600,
  build: 5,
  target: 1,
  patch_size: 14336,
  manifest_len: 196,
  source_prefix: '1122334455667788',
  offers: 2,
  requests: 1,
  data: 0,
  fragments_heard: [],
  senders: [{ sender: 'ab', count: 3, best_rssi: -60, best_snr: 7.5, kinds: ['offer', 'request'] }],
  providers_asked: ['ab'],
  airtime_ms: 1264,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    start_ts: 1699913600,
    end_ts: 1700000000,
    visibility_limit_bytes: 173,
    totals: { offers: 2, requests: 1, data: 0, retracts: 0, senders: 1, airtime_ms: 1264 },
    campaigns: [CAMPAIGN],
    retracts: [],
    ...overrides,
  };
}

function mockFetch(body: unknown) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
  ) as unknown as typeof fetch;
}

function contact(publicKey: string, name: string): Contact {
  return { public_key: publicKey, name } as Contact;
}

describe('MeshFuotaPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders campaigns and tiles', async () => {
    mockFetch(response());
    render(<MeshFuotaPanel selectedWindow={WINDOW} refreshKey={0} contacts={[]} />);

    const row = await screen.findByTestId('fuota-campaign-deadbeef');
    expect(row).toHaveTextContent('deadbeef');
    expect(row).toHaveTextContent('5');
    expect(screen.getByTestId('fuota-tile-offers')).toHaveTextContent('2');
    // raw_packets stores identical repeats once: counts and airtime are lower bounds.
    expect(screen.getByText(/identical repeats are stored once/)).toBeInTheDocument();
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain(
      './api/packets/fuota-traffic?start_ts='
    );
  });

  it('shows a dash for fields of a campaign without offer', async () => {
    mockFetch(
      response({
        campaigns: [{ ...CAMPAIGN, build: null, target: null, patch_size: null, offers: 0 }],
      })
    );
    render(<MeshFuotaPanel selectedWindow={WINDOW} refreshKey={0} contacts={[]} />);

    expect(await screen.findByTestId('fuota-build-deadbeef')).toHaveTextContent(/^-$/);
    expect(screen.getByTestId('fuota-patch-deadbeef')).toHaveTextContent(/^-$/);
  });

  it('lists every contact matching the sender byte', async () => {
    mockFetch(response());
    render(
      <MeshFuotaPanel
        selectedWindow={WINDOW}
        refreshKey={0}
        contacts={[
          contact('ab' + '11'.repeat(31), 'Repeater One'),
          contact('AB' + '22'.repeat(31), 'Repeater Two'),
          contact('cd' + '33'.repeat(31), 'Other Node'),
        ]}
      />
    );

    const cell = await screen.findByTestId('fuota-senders-deadbeef');
    expect(cell).toHaveTextContent('Repeater One');
    expect(cell).toHaveTextContent('Repeater Two');
    expect(cell).not.toHaveTextContent('Other Node');
  });

  it('shows the empty state with the visibility note', async () => {
    mockFetch(
      response({
        campaigns: [],
        totals: { offers: 0, requests: 0, data: 0, retracts: 0, senders: 0, airtime_ms: null },
      })
    );
    render(<MeshFuotaPanel selectedWindow={WINDOW} refreshKey={0} contacts={[]} />);

    await waitFor(() =>
      expect(
        screen.getByText(/No firmware-update traffic heard in this window/)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/173-byte/)).toBeInTheDocument();
    expect(screen.getByTestId('fuota-tile-airtime')).toHaveTextContent('-');
  });
});
