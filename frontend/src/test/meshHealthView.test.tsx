import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeshHealthView } from '../components/MeshHealthView';

const RESPONSE = {
  start_ts: 0,
  end_ts: 3600,
  window_hours: 1,
  total_contacts: 1,
  high_alert_count: 0,
  medium_alert_count: 0,
  high_advert_threshold: 8,
  medium_advert_threshold: 2,
  alerts: [],
  contacts: [
    {
      public_key: 'ab'.repeat(32),
      name: 'Node A',
      advert_count: 4,
      direct_count: 3,
      flood_count: 1,
      first_seen: 100,
      last_seen: 200,
      lat: null,
      lon: null,
      min_path_len: 0,
      hash_mode: null,
    },
  ],
};

const REQUEST_TRAFFIC = {
  start_ts: 0,
  end_ts: 3600,
  totals: {
    requests: 5,
    anon_requests: 1,
    responses: 2,
    flood_requests: 3,
    direct_requests: 2,
  },
  series: [
    { bucket_ts: 0, flood: 2, direct: 1, responses: 1 },
    { bucket_ts: 1800, flood: 1, direct: 1, responses: 1 },
  ],
  pairs: [{ src_hash: '11', dest_hash: '22', requests: 4, flood: 2, direct: 2, last_ts: 200 }],
};

describe('MeshHealthView Adverts tab (default)', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  });

  it('renders Direct, Flood and Total column headers', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: /Direct/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Flood/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Total/ })).toBeInTheDocument();
  });

  it('renders the direct and flood counts for the contact row', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    const row = screen.getByText('Node A').closest('tr') as HTMLTableRowElement;
    expect(row).not.toBeNull();
    // Direct = 3, Flood = 1, Total = 4 all appear in this contact's row.
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
  });
});

describe('MeshHealthView Requests tab', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('request-traffic')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(REQUEST_TRAFFIC),
        } as Response);
      }
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  });

  it('switches to the Requests panel and renders traffic stats and the pair table', async () => {
    render(<MeshHealthView config={null} />);
    // The Adverts panel loads first.
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));

    // Responses-heard tile is unique to the Requests panel.
    await waitFor(() => expect(screen.getByText('Responses heard')).toBeInTheDocument());
    // The src -> dest pair is rendered as raw hex.
    expect(screen.getByText(/11\s*→\s*22/)).toBeInTheDocument();
    // The Adverts contacts table is no longer mounted.
    expect(screen.queryByText('Node A')).not.toBeInTheDocument();
  });
});
