import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TempRadioState } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getRadioPresets: vi.fn(),
    getFanoutConfigs: vi.fn(),
    startTempRadio: vi.fn(),
    restoreTempRadio: vi.fn(),
    updateRadioConfig: vi.fn(),
    getScanLists: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));

import { ChatHeader } from '../components/ChatHeader';
import { TempRadioBanner } from '../components/TempRadioBanner';
import { TempRadioModal } from '../components/TempRadioModal';
import {
  INACTIVE_TEMP_RADIO,
  getCurrentRadioStamp,
  setTempRadioState,
  setTempRadioSupported,
} from '../utils/tempRadio';
import { makeChannelChatHeaderProps, makeContactChatHeaderProps } from './helpers/chatHeaderProps';

const NORMAL = { freq: 869.618, bw: 62.5, sf: 7, cr: 8 };

function activeState(overrides: Partial<TempRadioState> = {}): TempRadioState {
  return {
    ...INACTIVE_TEMP_RADIO,
    active: true,
    original: NORMAL,
    temp: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
    started_at: 1_000,
    expires_at: Date.now() / 1000 + 600,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getRadioPresets.mockResolvedValue({
    entries: [],
    info_message: '',
    synced_at: null,
    source_url: '',
  });
  mocks.api.getFanoutConfigs.mockResolvedValue([
    {
      id: 'mqtt-1',
      type: 'mqtt_community',
      name: 'Community MQTT',
      enabled: true,
      config: {},
      scope: {},
      sort_order: 0,
      created_at: 0,
    },
  ]);
  mocks.api.startTempRadio.mockResolvedValue(activeState());
  mocks.api.restoreTempRadio.mockResolvedValue(INACTIVE_TEMP_RADIO);
  mocks.api.updateRadioConfig.mockResolvedValue({});
  mocks.api.getScanLists.mockResolvedValue([]);
  act(() => setTempRadioState(INACTIVE_TEMP_RADIO));
});

function renderModal() {
  return render(<TempRadioModal open onOpenChange={() => {}} normal={NORMAL} />);
}

async function setField(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

describe('ChatHeader temporary radio button', () => {
  it('shows in a channel header', () => {
    render(<ChatHeader {...makeChannelChatHeaderProps({ radioConnected: true })} />);
    expect(screen.getByRole('button', { name: /temporary radio settings/i })).toBeEnabled();
  });

  it('shows in a DM header', () => {
    render(<ChatHeader {...makeContactChatHeaderProps({ radioConnected: true })} />);
    expect(screen.getByRole('button', { name: /temporary radio settings/i })).toBeEnabled();
  });

  it('is disabled when the radio is not connected', () => {
    render(<ChatHeader {...makeChannelChatHeaderProps({ radioConnected: false })} />);
    expect(screen.getByRole('button', { name: /temporary radio settings/i })).toBeDisabled();
  });
});

describe('TempRadioModal', () => {
  it('starts a 30 minute session with nothing kept running by default', async () => {
    renderModal();
    await setField(/spreading factor/i, '8');
    await userEvent.click(screen.getByRole('button', { name: /^switch$/i }));
    await waitFor(() => expect(mocks.api.startTempRadio).toHaveBeenCalledTimes(1));
    expect(mocks.api.startTempRadio).toHaveBeenCalledWith({
      radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
      duration_secs: 1800,
      region: null,
      opt_ins: {
        adverts: false,
        team_beacon: false,
        telemetry: false,
        client_repeat: false,
        polls: false,
        fanout_ids: [],
      },
    });
  });

  it('multiplies hours and passes region and opt-ins', async () => {
    renderModal();
    await setField(/spreading factor/i, '8');
    await setField(/^duration$/i, '2');
    await userEvent.selectOptions(screen.getByLabelText(/duration unit/i), 'hours');
    await setField(/region/i, 'be');
    await userEvent.click(screen.getByLabelText(/automatic adverts/i));
    await userEvent.click(await screen.findByLabelText(/community mqtt/i));
    await userEvent.click(screen.getByRole('button', { name: /^switch$/i }));
    await waitFor(() => expect(mocks.api.startTempRadio).toHaveBeenCalledTimes(1));
    const request = mocks.api.startTempRadio.mock.calls[0][0];
    expect(request.duration_secs).toBe(7200);
    expect(request.region).toBe('be');
    expect(request.opt_ins.adverts).toBe(true);
    expect(request.opt_ins.fanout_ids).toEqual(['mqtt-1']);
  });

  it('rejects an out-of-range spreading factor without calling the API', async () => {
    renderModal();
    await setField(/spreading factor/i, '4');
    await userEvent.click(screen.getByRole('button', { name: /^switch$/i }));
    expect(screen.getByText(/spreading factor must be 5 to 12/i)).toBeInTheDocument();
    expect(mocks.api.startTempRadio).not.toHaveBeenCalled();
  });

  it('saves as the new normal through the radio config', async () => {
    renderModal();
    await setField(/spreading factor/i, '8');
    await userEvent.click(screen.getByLabelText(/make this my new normal/i));
    await userEvent.click(screen.getByRole('button', { name: /save as new normal/i }));
    await waitFor(() => expect(mocks.api.updateRadioConfig).toHaveBeenCalledTimes(1));
    expect(mocks.api.updateRadioConfig).toHaveBeenCalledWith({
      radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
    });
    expect(mocks.api.startTempRadio).not.toHaveBeenCalled();
  });

  it('ends a running session as the new normal and updates the normal settings', async () => {
    act(() => setTempRadioState(activeState()));
    mocks.api.updateRadioConfig.mockResolvedValue({
      radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
    });
    renderModal();
    await userEvent.click(screen.getByLabelText(/make this my new normal/i));
    await userEvent.click(screen.getByRole('button', { name: /save as new normal/i }));
    await waitFor(() => expect(mocks.api.updateRadioConfig).toHaveBeenCalledTimes(1));
    expect(mocks.api.updateRadioConfig).toHaveBeenCalledWith({
      radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
      end_temp_session: true,
    });
    expect(getCurrentRadioStamp()).toEqual({ freq: 869.618, bw: 62.5, sf: 8, cr: 8 });
  });

  it('offers the polls opt-in', async () => {
    renderModal();
    await userEvent.click(screen.getByLabelText(/sensor subscriptions and neighbour polls/i));
    await userEvent.click(screen.getByRole('button', { name: /^switch$/i }));
    await waitFor(() => expect(mocks.api.startTempRadio).toHaveBeenCalledTimes(1));
    expect(mocks.api.startTempRadio.mock.calls[0][0].opt_ins.polls).toBe(true);
  });

  it('offers Restore now while a session is active', async () => {
    act(() => setTempRadioState(activeState()));
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /restore now/i }));
    await waitFor(() => expect(mocks.api.restoreTempRadio).toHaveBeenCalledTimes(1));
  });
});

describe('TempRadioBanner', () => {
  it('renders nothing without a session', () => {
    const { container } = render(<TempRadioBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the settings, time left and Restore now', async () => {
    act(() => setTempRadioState(activeState()));
    render(<TempRadioBanner />);
    expect(screen.getByText(/SF8/)).toBeInTheDocument();
    expect(screen.getByText(/left/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /restore now/i }));
    await waitFor(() => expect(mocks.api.restoreTempRadio).toHaveBeenCalledTimes(1));
  });

  it('warns when the switch back is overdue', () => {
    act(() => setTempRadioState(activeState({ restore_pending: true })));
    render(<TempRadioBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent(/overdue/i);
  });
});

describe('OpenHop', () => {
  it('turns the header button off with a reason', () => {
    act(() => setTempRadioSupported(false));
    render(<ChatHeader {...makeChannelChatHeaderProps({ radioConnected: true })} />);
    const btn = screen.getByRole('button', { name: /temporary radio settings/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/openhop/i));
    act(() => setTempRadioSupported(true));
  });
});
