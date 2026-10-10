import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsRadioAppSection } from '../components/settings/SettingsRadioAppSection';
import type { AppSettings, TelemetrySchedule } from '../types';

const mocks = vi.hoisted(() => ({ getTelemetrySchedule: vi.fn() }));

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return {
    ...original,
    api: { ...original.api, getTelemetrySchedule: mocks.getTelemetrySchedule },
  };
});

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

function schedule(over: Partial<TelemetrySchedule> = {}): TelemetrySchedule {
  return {
    preferred_hours: 8,
    effective_hours: 8,
    options: [1, 2, 3, 4, 6, 8, 12, 24],
    tracked_count: 0,
    max_tracked: 8,
    next_run_at: null,
    routed_hourly: false,
    next_routed_run_at: null,
    schedule_minute: 37,
    schedule_minute_auto: true,
    ...over,
  };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    telemetry_interval_hours: 8,
    telemetry_routed_hourly: false,
    telemetry_schedule_minute: -1,
    discovery_blocked_types: [],
    team_beacon: { enabled: false, channel_key: '', interval_seconds: 240 },
    ...over,
  } as AppSettings;
}

describe('Settings > Radio & App: telemetry minute', () => {
  beforeEach(() => {
    mocks.getTelemetrySchedule.mockReset();
  });

  it('shows automatic with the minute this radio gets', async () => {
    mocks.getTelemetrySchedule.mockResolvedValue(schedule());
    render(<SettingsRadioAppSection appSettings={settings()} onSaveAppSettings={vi.fn()} />);

    const select = screen.getByLabelText('Minute of the hour') as HTMLSelectElement;
    expect(select.value).toBe('-1');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Automatic (:37)' })).toBeInTheDocument()
    );
    expect(screen.getAllByRole('option', { name: /^:\d\d$/ })).toHaveLength(60);
  });

  it('saves a chosen minute', async () => {
    mocks.getTelemetrySchedule.mockResolvedValue(schedule());
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsRadioAppSection appSettings={settings()} onSaveAppSettings={onSave} />);

    fireEvent.change(screen.getByLabelText('Minute of the hour'), { target: { value: '12' } });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ telemetry_schedule_minute: 12 }));
  });

  it('shows a saved minute and can go back to automatic', async () => {
    mocks.getTelemetrySchedule.mockResolvedValue(
      schedule({ schedule_minute: 12, schedule_minute_auto: false })
    );
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsRadioAppSection
        appSettings={settings({ telemetry_schedule_minute: 12 })}
        onSaveAppSettings={onSave}
      />
    );

    const select = screen.getByLabelText('Minute of the hour') as HTMLSelectElement;
    expect(select.value).toBe('12');

    fireEvent.change(select, { target: { value: '-1' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ telemetry_schedule_minute: -1 }));
  });

  it('puts the old minute back when saving fails', async () => {
    mocks.getTelemetrySchedule.mockResolvedValue(schedule());
    const onSave = vi.fn().mockRejectedValue(new Error('nope'));
    render(<SettingsRadioAppSection appSettings={settings()} onSaveAppSettings={onSave} />);

    const select = screen.getByLabelText('Minute of the hour') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '12' } });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(select.value).toBe('-1'));
  });
});
