import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { SensorPushPane } from '../components/repeater/SensorPushPane';
import type { SensorPushState } from '../types';

vi.mock('../api', () => ({
  api: {
    getSensorPush: vi.fn(),
    saveSensorPush: vi.fn(),
    subscribeSensorPush: vi.fn(),
    unsubscribeSensorPush: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const KEY = 'a2'.repeat(32);
const state = (over: Partial<SensorPushState> = {}): SensorPushState => ({
  public_key: KEY,
  enabled: false,
  thresholds: [],
  threshold_bytes: 0,
  max_threshold_bytes: 14,
  supported_types: { temperature: 4, voltage: 4 },
  granted_until: null,
  scope_name: null,
  last_push_at: null,
  last_error: null,
  ...over,
});

describe('SensorPushPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSensorPush).mockResolvedValue(state());
  });

  it('asks for a telemetry read when no channels are known', async () => {
    render(<SensorPushPane publicKey={KEY} channels={[]} />);
    await waitFor(() => expect(screen.getByText(/Read telemetry first/)).toBeInTheDocument());
  });

  it('updates the byte counter and blocks a set over 14 bytes', async () => {
    const channels = [1, 2, 3, 4].map((c) => ({ channel: c, type_name: 'voltage' }));
    render(<SensorPushPane publicKey={KEY} channels={channels} />);
    await waitFor(() => expect(screen.getByText('0 of 14 bytes')).toBeInTheDocument());
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByText('16 of 14 bytes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save thresholds' })).toBeDisabled();
  });

  it('marks types the sensor cannot push', async () => {
    render(<SensorPushPane publicKey={KEY} channels={[{ channel: 3, type_name: 'gps' }]} />);
    await waitFor(() => expect(screen.getByText('Not supported for push')).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('saves then subscribes when switched on', async () => {
    vi.mocked(api.saveSensorPush).mockResolvedValue(state({ threshold_bytes: 4 }));
    vi.mocked(api.subscribeSensorPush).mockResolvedValue(
      state({ enabled: true, granted_until: 1_900_000_000, scope_name: 'nl' })
    );
    render(
      <SensorPushPane publicKey={KEY} channels={[{ channel: 1, type_name: 'temperature' }]} />
    );
    await waitFor(() => screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Min change/), { target: { value: '0.5' } });
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(api.saveSensorPush).toHaveBeenCalledWith(KEY, [
      { channel: 1, type_name: 'temperature', min_delta: 0.5 },
    ]);
    expect(api.subscribeSensorPush).toHaveBeenCalledWith(KEY);
    await waitFor(() => expect(screen.getByText(/Scope: nl/)).toBeInTheDocument());
  });

  it('unsubscribes when switched off', async () => {
    vi.mocked(api.getSensorPush).mockResolvedValue(
      state({
        enabled: true,
        thresholds: [{ channel: 1, type_name: 'temperature', min_delta: 0.5 }],
        threshold_bytes: 4,
      })
    );
    vi.mocked(api.unsubscribeSensorPush).mockResolvedValue(state());
    render(
      <SensorPushPane publicKey={KEY} channels={[{ channel: 1, type_name: 'temperature' }]} />
    );
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(api.unsubscribeSensorPush).toHaveBeenCalledWith(KEY);
  });

  it('explains a refusal', async () => {
    vi.mocked(api.getSensorPush).mockResolvedValue(state({ last_error: 'refused' }));
    render(
      <SensorPushPane publicKey={KEY} channels={[{ channel: 1, type_name: 'temperature' }]} />
    );
    await waitFor(() => expect(screen.getByText(/scope region/)).toBeInTheDocument());
  });

  it('re-subscribes when thresholds are saved while push is on', async () => {
    vi.mocked(api.getSensorPush).mockResolvedValue(
      state({
        enabled: true,
        thresholds: [{ channel: 1, type_name: 'temperature', min_delta: 0.5 }],
        threshold_bytes: 4,
      })
    );
    vi.mocked(api.saveSensorPush).mockResolvedValue(state({ enabled: true, threshold_bytes: 4 }));
    vi.mocked(api.subscribeSensorPush).mockResolvedValue(state({ enabled: true }));
    render(
      <SensorPushPane publicKey={KEY} channels={[{ channel: 1, type_name: 'temperature' }]} />
    );
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.change(screen.getByLabelText(/Min change/), { target: { value: '1' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save thresholds' })));
    expect(api.saveSensorPush).toHaveBeenCalledWith(KEY, [
      { channel: 1, type_name: 'temperature', min_delta: 1 },
    ]);
    expect(api.subscribeSensorPush).toHaveBeenCalledWith(KEY);
  });

  it('only saves when push is off', async () => {
    vi.mocked(api.saveSensorPush).mockResolvedValue(state({ threshold_bytes: 4 }));
    render(
      <SensorPushPane publicKey={KEY} channels={[{ channel: 1, type_name: 'temperature' }]} />
    );
    await waitFor(() => screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Min change/), { target: { value: '1' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save thresholds' })));
    expect(api.saveSensorPush).toHaveBeenCalled();
    expect(api.subscribeSensorPush).not.toHaveBeenCalled();
  });
});
