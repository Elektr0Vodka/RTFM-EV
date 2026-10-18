import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const renderTraceCard = vi.fn();
vi.mock('../../share/cards/traceRouteRender', () => ({
  renderTraceCard: (...args: unknown[]) => renderTraceCard(...args),
}));
vi.mock('../../share/shareBrand', () => ({
  loadShareBrand: vi.fn().mockResolvedValue({ name: 'RTFM-EV', icon: null }),
}));

import { TracePane } from '../../components/TracePane';
import { useTraceShareBuild } from '../../share/cards/useTraceShare';
import type { CardText } from '../../share/cardChrome';
import type { Contact, RadioConfig, RadioTraceNode, RadioTraceResponse } from '../../types';
import { CONTACT_TYPE_REPEATER } from '../../types';

function repeater(
  key: string,
  name: string,
  lat: number | null = null,
  lon: number | null = null
): Contact {
  return {
    public_key: key,
    name,
    type: CONTACT_TYPE_REPEATER,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat,
    lon,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

const config = {
  public_key: 'ff'.repeat(32),
  name: 'Base Radio',
  lat: 52,
  lon: 5,
  tx_power: 17,
  max_tx_power: 22,
  radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
  path_hash_mode: 0,
  path_hash_mode_supported: true,
} as RadioConfig;

const alpha = repeater('11'.repeat(32), 'Relay Alpha', 52.1, 5);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  renderTraceCard.mockResolvedValue({ png: new Blob(['p'], { type: 'image/png' }) });
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
});

describe('TracePane share', () => {
  it('shows Share only once a result is there, and it opens the share dialog', async () => {
    const onRunTracePath = vi.fn(async (): Promise<RadioTraceResponse> => ({
      path_len: 1,
      timeout_seconds: 4,
      nodes: [
        {
          role: 'repeater',
          public_key: alpha.public_key,
          name: alpha.name,
          observed_hash: '11',
          snr: 7.5,
        },
        {
          role: 'local',
          public_key: config.public_key,
          name: config.name,
          observed_hash: null,
          snr: 4,
        },
      ],
    }));
    render(<TracePane config={config} contacts={[alpha]} onRunTracePath={onRunTracePath} />);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^add repeater relay alpha/i }));
    fireEvent.click(screen.getByRole('button', { name: /send trace/i }));
    const share = await screen.findByRole('button', { name: 'Share' });
    fireEvent.click(share);
    expect(await screen.findByText('Share as image')).toBeInTheDocument();
    await waitFor(() => expect(renderTraceCard).toHaveBeenCalled());
  });
});

describe('useTraceShareBuild', () => {
  const nodes: RadioTraceNode[] = [
    {
      role: 'local',
      public_key: config.public_key,
      name: 'Base Radio',
      observed_hash: null,
      snr: null,
    },
    {
      role: 'repeater',
      public_key: alpha.public_key,
      name: 'Relay Alpha',
      observed_hash: '11',
      snr: 7.5,
    },
    { role: 'custom', public_key: null, name: null, observed_hash: 'ab', snr: -11 },
    {
      role: 'local',
      public_key: config.public_key,
      name: 'Base Radio',
      observed_hash: null,
      snr: -12.5,
    },
  ];

  it('builds the card text from the trace', async () => {
    const { result } = renderHook(() =>
      useTraceShareBuild(nodes, Date.UTC(2026, 9, 18, 19, 14), [alpha], config, 'Base Radio')
    );
    const res = await result.current!({ hidePosition: false, noMap: false, flags: {} });
    const text = renderTraceCard.mock.calls[0][1] as CardText;
    expect(text.title).toBe('Trace to AB');
    expect(text.kicker.startsWith('Trace route, ')).toBe(true);
    const labels = text.figures.map((f) => f.label);
    expect(labels).toEqual(['hops', 'weakest SNR', 'path length']);
    expect(text.figures[0].value).toBe('2');
    expect(text.figures[1].value).toBe('-12.5 dB');
    expect(res.filenameBase).toMatch(/^rtfm-ev-trace-2026-10-1[89]-\d{4}$/);
  });

  it('names no hop in the title when the position is hidden', async () => {
    const { result } = renderHook(() =>
      useTraceShareBuild(nodes, Date.UTC(2026, 9, 18, 19, 14), [alpha], config, 'Base Radio')
    );
    const res = await result.current!({ hidePosition: true, noMap: false, flags: {} });
    const text = renderTraceCard.mock.calls[renderTraceCard.mock.calls.length - 1][1] as CardText;
    expect(text.title).toBe('Trace route');
    expect(res.alt).not.toContain('AB');
  });

  it('returns null without nodes', () => {
    const { result } = renderHook(() => useTraceShareBuild([], 0, [], config, 'Base Radio'));
    expect(result.current).toBeNull();
  });
});
