import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AntennaTestRunCreate,
  AntennaTestRunDetail,
  AntennaTestRunSummary,
  Contact,
  RadioConfig,
} from '../types';
import { CONTACT_TYPE_REPEATER } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getRepeaterAdvertPaths: vi.fn(),
    listAntennaTests: vi.fn(),
    getAntennaTest: vi.fn(),
    saveAntennaTest: vi.fn(),
    deleteAntennaTest: vi.fn(),
    requestTrace: vi.fn(),
  },
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, api: mocks.api };
});

import { ApiError } from '../api';
import { TracePane } from '../components/TracePane';

const DIRECT = 'aa'.repeat(32);
const FAR = 'bb'.repeat(32);

function repeater(publicKey: string, name: string): Contact {
  return {
    public_key: publicKey,
    name,
    type: CONTACT_TYPE_REPEATER,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  } as Contact;
}

const config = {
  public_key: 'ff'.repeat(32),
  name: 'Base Radio',
  lat: 0,
  lon: 0,
  tx_power: 17,
  max_tx_power: 22,
  radio: { freq: 869.525, bw: 62.5, sf: 8, cr: 8 },
  path_hash_mode: 0,
  path_hash_mode_supported: true,
} as RadioConfig;

function advertPath(pathLen: number) {
  return {
    path: '',
    path_len: pathLen,
    next_hop: null,
    first_seen: 1,
    last_seen: 2,
    heard_count: 1,
  };
}

function detailFrom(id: number, run: AntennaTestRunCreate): AntennaTestRunDetail {
  return {
    id,
    antenna: run.antenna,
    notes: run.notes,
    radio_public_key: run.radio_public_key,
    radio_name: run.radio_name,
    traces_per_node: run.traces_per_node,
    started_at: run.started_at,
    finished_at: run.finished_at,
    summary: {
      nodes: 1,
      nodes_replied: 1,
      attempts: 2,
      replies: 1,
      reply_rate: 0.5,
      remote_snr_avg: 6,
      local_snr_avg: -1.5,
    },
    nodes: [
      {
        public_key: DIRECT,
        name: 'Direct Relay',
        distance_km: null,
        attempts: 2,
        replies: 1,
        reply_rate: 0.5,
        remote_snr: { avg: 6, min: 6, max: 6 },
        local_snr: { avg: -1.5, min: -1.5, max: -1.5 },
      },
    ],
  };
}

function renderPane() {
  return render(
    <TracePane
      config={config}
      onRunTracePath={vi.fn()}
      contacts={[repeater(DIRECT, 'Direct Relay'), repeater(FAR, 'Far Relay')]}
    />
  );
}

async function openAntennaTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Antenna test' }));
  await screen.findByText('Nodes (1 selected)');
}

describe('Trace page antenna test', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(mocks.api).forEach((fn) => fn.mockReset());
    mocks.api.getRepeaterAdvertPaths.mockResolvedValue([
      { public_key: DIRECT, paths: [advertPath(0)] },
      { public_key: FAR, paths: [advertPath(2)] },
    ]);
    mocks.api.listAntennaTests.mockResolvedValue([] as AntennaTestRunSummary[]);
  });

  it('pre-selects the direct-heard repeater and runs, saves and shows the report', async () => {
    mocks.api.requestTrace
      .mockResolvedValueOnce({ remote_snr: 6, local_snr: -1.5, path_len: 1 })
      .mockRejectedValueOnce(new ApiError('No trace response heard', 422));
    mocks.api.saveAntennaTest.mockImplementation(async (run: AntennaTestRunCreate) =>
      detailFrom(7, run)
    );

    renderPane();
    await openAntennaTab();

    expect(screen.getByRole('checkbox', { name: /Direct Relay/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Far Relay/ })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Antenna'), { target: { value: 'Stock whip' } });
    fireEvent.change(screen.getByLabelText('Traces per node'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Pause between traces (s)'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));

    await waitFor(() => expect(mocks.api.saveAntennaTest).toHaveBeenCalledTimes(1));
    expect(mocks.api.requestTrace).toHaveBeenCalledTimes(2);
    expect(mocks.api.requestTrace).toHaveBeenCalledWith(DIRECT);

    const saved = mocks.api.saveAntennaTest.mock.calls[0][0] as AntennaTestRunCreate;
    expect(saved.antenna).toBe('Stock whip');
    expect(saved.traces_per_node).toBe(2);
    expect(saved.radio_name).toBe('Base Radio');
    expect(saved.results).toEqual([
      {
        public_key: DIRECT,
        name: 'Direct Relay',
        distance_km: null,
        attempts: [
          { replied: true, remote_snr: 6, local_snr: -1.5 },
          { replied: false, remote_snr: null, local_snr: null },
        ],
      },
    ]);

    const report = await screen.findByRole('region', { name: 'Report: Stock whip' });
    expect(within(report).getByText('1/2')).toBeInTheDocument();
    expect(within(report).getByText('50%')).toBeInTheDocument();
  });

  it('does not start without an antenna name', async () => {
    renderPane();
    await openAntennaTab();
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    await waitFor(() => expect(mocks.api.listAntennaTests).toHaveBeenCalled());
    expect(mocks.api.requestTrace).not.toHaveBeenCalled();
  });

  it('stops on a radio error and offers to save what ran', async () => {
    mocks.api.requestTrace.mockRejectedValueOnce(new ApiError('Radio not connected', 503));

    renderPane();
    await openAntennaTab();
    fireEvent.change(screen.getByLabelText('Antenna'), { target: { value: 'Whip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));

    expect(await screen.findByText('Run stopped: Radio not connected')).toBeInTheDocument();
    // Nothing was traced, so there is nothing to save.
    expect(screen.getByRole('button', { name: 'Save what ran' })).toBeDisabled();
    expect(mocks.api.saveAntennaTest).not.toHaveBeenCalled();
  });

  it('keeps the path trace tab as the default', () => {
    renderPane();
    expect(screen.getByRole('tab', { name: 'Path trace' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(mocks.api.listAntennaTests).not.toHaveBeenCalled();
  });
});
