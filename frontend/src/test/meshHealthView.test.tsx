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

  it('opens a node detail page when a contact name is clicked', async () => {
    const onOpenNode = vi.fn();
    render(<MeshHealthView config={null} onOpenNode={onOpenNode} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Node A' }));
    expect(onOpenNode).toHaveBeenCalledWith('ab'.repeat(32), 'Node A');
  });

  it('renders the page-size dropdown and persists a change server-side', async () => {
    const onSaveAppSettings = vi.fn();
    render(<MeshHealthView config={null} pageSize={50} onSaveAppSettings={onSaveAppSettings} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    const select = screen.getByLabelText('Show max rows') as HTMLSelectElement;
    expect(select.value).toBe('50');
    // Options include the sizes plus "All" (value 0).
    expect(within(select).getByRole('option', { name: 'All' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '25' } });
    expect(onSaveAppSettings).toHaveBeenCalledWith({ mesh_health_page_size: 25 });

    fireEvent.change(select, { target: { value: '0' } });
    expect(onSaveAppSettings).toHaveBeenCalledWith({ mesh_health_page_size: 0 });
  });
});

describe('MeshHealthView Adverts contacts search + layout order', () => {
  const TWO_CONTACTS = {
    ...RESPONSE,
    total_contacts: 2,
    contacts: [
      RESPONSE.contacts[0],
      { ...RESPONSE.contacts[0], public_key: 'cd'.repeat(32), name: 'Node B' },
    ],
  };

  const WITH_ALERT = {
    ...RESPONSE,
    high_alert_count: 1,
    alerts: [
      {
        level: 'HIGH',
        public_key: 'ab'.repeat(32),
        name: 'Node A',
        advert_count: 9,
        adverts_per_hour: 18,
      },
    ],
  };

  function mockMeshHealth(body: unknown) {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  }

  it('filters the advertised-contacts table by the search box', async () => {
    mockMeshHealth(TWO_CONTACTS);
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    expect(screen.getByText('Node B')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search name or key...'), {
      target: { value: 'Node B' },
    });

    expect(screen.queryByText('Node A')).not.toBeInTheDocument();
    expect(screen.getByText('Node B')).toBeInTheDocument();
  });

  it('shows a no-matches message when the search matches nothing', async () => {
    mockMeshHealth(TWO_CONTACTS);
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Search name or key...'), {
      target: { value: 'zzz-nothing' },
    });

    expect(screen.getByText(/No advertised contacts match/)).toBeInTheDocument();
  });

  it('renders the advertised-contacts table above the flooding-advert alerts', async () => {
    mockMeshHealth(WITH_ALERT);
    render(<MeshHealthView config={null} />);
    const tableHeading = await screen.findByText(/All Advertised Contacts Heard/);
    const alertHeading = await screen.findByText(/Flooding Adverts Too Frequently/);
    // The contacts table must appear before the alerts in the DOM so a long
    // alert list never pushes it off-screen.
    expect(
      tableHeading.compareDocumentPosition(alertHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe('MeshHealthView flood-driven warning highlight', () => {
  // direct 2, flood 9, total 11: flood alone exceeds the HIGH threshold (8).
  const FLOOD_HEAVY = {
    ...RESPONSE,
    high_alert_count: 1,
    contacts: [
      {
        public_key: 'cd'.repeat(32),
        name: 'Flooder',
        advert_count: 11,
        direct_count: 2,
        flood_count: 9,
        first_seen: 100,
        last_seen: 200,
        lat: null,
        lon: null,
        min_path_len: 1,
        hash_mode: null,
      },
    ],
  };

  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FLOOD_HEAVY) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  });

  it('annotates the alert heading with the selected time window', async () => {
    const withAlert = {
      ...FLOOD_HEAVY,
      alerts: [
        {
          level: 'HIGH',
          public_key: 'cd'.repeat(32),
          name: 'Flooder',
          advert_count: 9,
          adverts_per_hour: 18,
        },
      ],
    };
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(withAlert) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });
    render(<MeshHealthView config={null} />);
    // The HIGH alert heading renders (default Mesh Health window is 30m).
    const heading = await screen.findByText(/Flooding Adverts Too Frequently/);
    const headerBar = heading.parentElement as HTMLElement;
    // The active window is shown right next to the heading.
    expect(within(headerBar).getByText(/last 30m/i)).toBeInTheDocument();
  });

  it('highlights the flood count, not the total, when flood exceeds the threshold', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Flooder')).toBeInTheDocument());
    const row = screen.getByText('Flooder').closest('tr') as HTMLTableRowElement;
    // Flood (9) carries the HIGH-alert color; Total (11) stays muted.
    expect(within(row).getByText('9').className).toContain('text-destructive');
    expect(within(row).getByText('11').className).not.toContain('text-destructive');
  });

  it('does not highlight a direct-heavy contact whose flood count is low', async () => {
    // direct 20, flood 1, total 21: total is huge but flood is under threshold.
    const directHeavy = {
      ...RESPONSE,
      contacts: [
        {
          ...FLOOD_HEAVY.contacts[0],
          name: 'Chatty',
          advert_count: 21,
          direct_count: 20,
          flood_count: 1,
          min_path_len: 0,
        },
      ],
    };
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(directHeavy) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    });
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Chatty')).toBeInTheDocument());
    const row = screen.getByText('Chatty').closest('tr') as HTMLTableRowElement;
    // Flood = 1 (muted), Total = 21 (muted): no warning color anywhere in the row.
    expect(within(row).getByText('1').className).not.toContain('text-destructive');
    expect(within(row).getByText('1').className).not.toContain('text-yellow');
    expect(within(row).getByText('21').className).not.toContain('text-destructive');
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

describe('MeshHealthView Prefix Collisions tab', () => {
  const matrixWith = (idx: number, val: number) => {
    const a = new Array(256).fill(0);
    a[idx] = val;
    return a;
  };
  const PREFIX_COLLISIONS = {
    widths: [
      {
        width: 1,
        total_nodes: 3,
        distinct_prefixes: 1,
        colliding_prefixes: 1,
        colliding_nodes: 2,
        matrix: matrixWith(0xaa, 2),
        groups: [
          {
            prefix: 'aa',
            count: 2,
            max_distance_km: 5,
            located_count: 2,
            assessment: 'local',
            nodes: [
              { name: 'Alpha', public_key: 'aa11' + '0'.repeat(60), lat: 51.0, lon: 5.0 },
              { name: 'Bravo', public_key: 'aa22' + '0'.repeat(60), lat: 51.0, lon: 5.07 },
            ],
          },
        ],
      },
      {
        width: 2,
        total_nodes: 3,
        distinct_prefixes: 2,
        colliding_prefixes: 0,
        colliding_nodes: 0,
        matrix: new Array(256).fill(0),
        groups: [],
      },
      {
        width: 3,
        total_nodes: 3,
        distinct_prefixes: 3,
        colliding_prefixes: 0,
        colliding_nodes: 0,
        matrix: new Array(256).fill(0),
        groups: [],
      },
    ],
  };

  const RELAY_RECEPTION = {
    start_ts: 0,
    end_ts: 1,
    receptions: 3,
    packets: [
      {
        payload_hash: 'ab'.repeat(32),
        payload_type: 'GROUP_TEXT',
        route_type: 'Flood',
        first_seen: 1_700_000_000,
        last_seen: 1_700_000_010,
        copies: 3,
        relays: [
          {
            last_hop_hex: 'bb',
            count: 2,
            best_snr: 6.5,
            last_snr: 5.5,
            best_rssi: -90,
            last_rssi: -95,
            last_seen: 1_700_000_010,
            resolved_pubkey: 'bb'.repeat(32),
            resolved_name: 'Relay Bee',
            candidates: 1,
          },
          {
            last_hop_hex: 'aa',
            count: 1,
            best_snr: 1,
            last_snr: 1,
            best_rssi: -100,
            last_rssi: -100,
            last_seen: 1_700_000_000,
            resolved_pubkey: null,
            resolved_name: null,
            candidates: 2,
          },
        ],
        preview: 'hello mesh',
        message_id: 7,
      },
    ],
    relays: [
      {
        last_hop_hex: 'bb',
        receptions: 2,
        packets: 1,
        best_snr: 6.5,
        avg_snr: 6,
        last_snr: 5.5,
        best_rssi: -90,
        last_seen: 1_700_000_010,
        resolved_pubkey: 'bb'.repeat(32),
        resolved_name: 'Relay Bee',
        candidates: 1,
      },
      {
        last_hop_hex: 'aa',
        receptions: 1,
        packets: 1,
        best_snr: 1,
        avg_snr: 1,
        last_snr: 1,
        best_rssi: -100,
        last_seen: 1_700_000_000,
        resolved_pubkey: null,
        resolved_name: null,
        candidates: 2,
      },
    ],
  };

  beforeEach(() => {
    // A prior test persists its tab to localStorage; clear it so this suite
    // starts deterministically on the Adverts tab.
    localStorage.clear();
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('relay-reception')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(RELAY_RECEPTION),
        } as Response);
      }
      if (String(url).includes('prefix-collisions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(PREFIX_COLLISIONS),
        } as Response);
      }
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  });

  it('shows collisions for the default 1-byte width and switches widths', async () => {
    render(<MeshHealthView config={null} />);
    // Adverts loads first.
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Prefix Collisions' }));

    // 1-byte group renders the shared prefix header; node rows are collapsed.
    await waitFor(() => expect(screen.getByText('aa')).toBeInTheDocument());
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    // The distance/assessment pill is shown on the collapsed header.
    expect(screen.getByText(/Local/)).toBeInTheDocument();
    expect(screen.getByText(/5 km apart/)).toBeInTheDocument();

    // Expanding the group reveals both colliding node names + full public keys.
    fireEvent.click(screen.getByText('aa'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('aa11' + '0'.repeat(60))).toBeInTheDocument();
    // Coordinates render next to a node.
    expect(screen.getByText('(51.00, 5.00)')).toBeInTheDocument();

    // Switching to 2 bytes shows the empty state (no collisions at that width).
    fireEvent.click(screen.getByRole('button', { name: '2 bytes' }));
    await waitFor(() =>
      expect(screen.getByText('No prefix collisions at this width.')).toBeInTheDocument()
    );
  });

  it('does not render the time-range selector on this tab', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    // Sanity: the 7d range button exists on the Adverts tab.
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Prefix Collisions' }));
    await waitFor(() => expect(screen.getByText('aa')).toBeInTheDocument());
    // The time-range selector (and its 7d button) is gone on this tab.
    expect(screen.queryByRole('button', { name: '7d' })).not.toBeInTheDocument();
  });

  it('opens a node detail page when a colliding node is clicked', async () => {
    const onOpenNode = vi.fn();
    render(<MeshHealthView config={null} onOpenNode={onOpenNode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prefix Collisions' }));
    await waitFor(() => expect(screen.getByText('aa')).toBeInTheDocument());

    // Expand the group, then click the node name.
    fireEvent.click(screen.getByText('aa'));
    fireEvent.click(screen.getByText('Alpha'));
    expect(onOpenNode).toHaveBeenCalledWith('aa11' + '0'.repeat(60), 'Alpha');
  });

  it('filters the list to a first byte when a matrix cell is clicked', async () => {
    render(<MeshHealthView config={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prefix Collisions' }));
    await waitFor(() => expect(screen.getByText('aa')).toBeInTheDocument());

    // Click the matrix cell for a first byte with no collisions (00) -> the
    // colliding "aa" group is filtered out and the per-cell empty state shows.
    fireEvent.click(screen.getByRole('button', { name: '00: 0' }));
    await waitFor(() =>
      expect(screen.getByText(/No prefix collisions in cell 00/)).toBeInTheDocument()
    );
    expect(screen.queryByText('aa')).not.toBeInTheDocument();
  });

  it('switches to the Relay reception panel and renders the pivot and summary', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Relay reception' }));

    await waitFor(() => expect(screen.getByText('Packets via 2+ relays')).toBeInTheDocument());
    const pivot = screen.getByTestId('relay-reception-pivot');
    // Resolved relay renders by name; the colliding one as raw hex with a marker.
    expect(within(pivot).getByText('Relay Bee')).toBeInTheDocument();
    expect(within(pivot).getByText('aa ?')).toBeInTheDocument();
    // Best SNR with the copy multiplier, and the decrypted preview.
    expect(within(pivot).getByText('+6.5 dB ×2')).toBeInTheDocument();
    expect(within(pivot).getByText(/hello mesh/)).toBeInTheDocument();
    const summary = screen.getByTestId('relay-reception-summary');
    expect(within(summary).getByText('+6.0 dB')).toBeInTheDocument();
  });
});
