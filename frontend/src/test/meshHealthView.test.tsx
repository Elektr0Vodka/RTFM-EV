import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('MeshHealthView direct/flood columns', () => {
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
