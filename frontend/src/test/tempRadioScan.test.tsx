import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RadioScanList } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getScanLists: vi.fn(),
    createScanList: vi.fn(),
    updateScanList: vi.fn(),
    deleteScanList: vi.fn(),
    runScanList: vi.fn(),
    stopScan: vi.fn(),
    getFanoutConfigs: vi.fn(),
    restoreTempRadio: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));

import { TempRadioBanner } from '../components/TempRadioBanner';
import { TempRadioScanTab } from '../components/TempRadioScanTab';
import {
  IDLE_SCAN,
  INACTIVE_TEMP_RADIO,
  setScanState,
  setTempRadioState,
} from '../utils/tempRadio';

const NORMAL = { freq: 869.618, bw: 62.5, sf: 7, cr: 8 };
const NO_OPT_INS = {
  adverts: false,
  team_beacon: false,
  telemetry: false,
  client_repeat: false,
  polls: false,
  fanout_ids: [],
};

const SAVED: RadioScanList = {
  id: 4,
  name: 'Border',
  entries: [
    { radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 }, region: '#be', dwell_secs: 60 },
    { radio: { freq: 869.525, bw: 250, sf: 11, cr: 5 }, region: null, dwell_secs: 30 },
  ],
  rounds: 0,
  normal_between_secs: 0,
  hold_on_activity_secs: 0,
  opt_ins: NO_OPT_INS,
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getScanLists.mockResolvedValue([SAVED]);
  mocks.api.getFanoutConfigs.mockResolvedValue([]);
  mocks.api.createScanList.mockImplementation(async (req) => ({
    ...req,
    id: 9,
    created_at: 1,
    updated_at: 1,
  }));
  mocks.api.deleteScanList.mockResolvedValue({ deleted: true });
  mocks.api.runScanList.mockResolvedValue({
    ...IDLE_SCAN,
    running: true,
    list_id: 4,
    list_name: 'Border',
  });
  mocks.api.stopScan.mockResolvedValue(IDLE_SCAN);
  act(() => {
    setScanState(IDLE_SCAN);
    setTempRadioState(INACTIVE_TEMP_RADIO);
  });
});

async function setField(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

describe('TempRadioScanTab', () => {
  it('lists saved scan lists and runs one', async () => {
    render(<TempRadioScanTab open normal={NORMAL} />);
    expect(await screen.findByText('Border')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /run border/i }));
    await waitFor(() => expect(mocks.api.runScanList).toHaveBeenCalledWith(4));
  });

  it('creates a list with one entry', async () => {
    mocks.api.getScanLists.mockResolvedValue([]);
    render(<TempRadioScanTab open normal={NORMAL} />);
    await userEvent.click(await screen.findByRole('button', { name: /new scan list/i }));
    await setField('List name', 'Weekend');
    await setField('Entry 1 spreading factor', '9');
    await setField('Entry 1 seconds on these settings', '45');
    await setField('Rounds (0 = until stopped)', '3');
    await userEvent.click(screen.getByRole('button', { name: /save scan list/i }));
    await waitFor(() => expect(mocks.api.createScanList).toHaveBeenCalledTimes(1));
    expect(mocks.api.createScanList).toHaveBeenCalledWith({
      name: 'Weekend',
      entries: [{ radio: { freq: 869.618, bw: 62.5, sf: 9, cr: 8 }, region: null, dwell_secs: 45 }],
      rounds: 3,
      normal_between_secs: 0,
      hold_on_activity_secs: 0,
      opt_ins: NO_OPT_INS,
    });
  });

  it('refuses a list with an invalid entry', async () => {
    mocks.api.getScanLists.mockResolvedValue([]);
    render(<TempRadioScanTab open normal={NORMAL} />);
    await userEvent.click(await screen.findByRole('button', { name: /new scan list/i }));
    await setField('List name', 'Bad');
    await setField('Entry 1 spreading factor', '13');
    await userEvent.click(screen.getByRole('button', { name: /save scan list/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.api.createScanList).not.toHaveBeenCalled();
  });

  it('deletes a list', async () => {
    render(<TempRadioScanTab open normal={NORMAL} />);
    await userEvent.click(await screen.findByRole('button', { name: /delete border/i }));
    await waitFor(() => expect(mocks.api.deleteScanList).toHaveBeenCalledWith(4));
  });

  it('stops a running scan', async () => {
    act(() => setScanState({ ...IDLE_SCAN, running: true, list_id: 4, list_name: 'Border' }));
    render(<TempRadioScanTab open normal={NORMAL} />);
    await userEvent.click(await screen.findByRole('button', { name: /stop scan/i }));
    await waitFor(() => expect(mocks.api.stopScan).toHaveBeenCalledTimes(1));
  });
});

describe('TempRadioBanner during a scan', () => {
  it('shows the list, the entry and Stop', async () => {
    act(() =>
      setScanState({
        ...IDLE_SCAN,
        running: true,
        list_id: 4,
        list_name: 'Border',
        entry_index: 1,
        entry_count: 2,
        round: 1,
        rounds: 0,
        entry_ends_at: Date.now() / 1000 + 30,
      })
    );
    render(<TempRadioBanner />);
    expect(screen.getByText(/border/i)).toHaveTextContent(/2 of 2/);
    await userEvent.click(screen.getByRole('button', { name: /stop scan/i }));
    await waitFor(() => expect(mocks.api.stopScan).toHaveBeenCalledTimes(1));
  });
});
