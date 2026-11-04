import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  MalformedClockSettings,
  parseClockAheadMinutes,
} from '../components/settings/MalformedClockSettings';

describe('parseClockAheadMinutes', () => {
  it('accepts whole minutes in range', () => {
    expect(parseClockAheadMinutes('0')).toBe(0);
    expect(parseClockAheadMinutes(' 60 ')).toBe(60);
    expect(parseClockAheadMinutes('10080')).toBe(10080);
  });

  it('refuses anything else', () => {
    expect(parseClockAheadMinutes('10081')).toBeNull();
    expect(parseClockAheadMinutes('-1')).toBeNull();
    expect(parseClockAheadMinutes('1.5')).toBeNull();
    expect(parseClockAheadMinutes('')).toBeNull();
  });
});

describe('MalformedClockSettings', () => {
  it('shows the default and saves a new limit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MalformedClockSettings appSettings={{}} onSaveAppSettings={onSave} />);

    const input = screen.getByLabelText('Minutes ahead');
    expect(input).toHaveValue(60);
    const save = screen.getByRole('button', { name: 'Save clock limit' });
    expect(save).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, '15');
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ malformed_clock_ahead_minutes: 15 });
  });

  it('keeps save disabled for an out-of-range value', async () => {
    const onSave = vi.fn();
    render(
      <MalformedClockSettings
        appSettings={{ malformed_clock_ahead_minutes: 30 }}
        onSaveAppSettings={onSave}
      />
    );
    const input = screen.getByLabelText('Minutes ahead');
    await userEvent.clear(input);
    await userEvent.type(input, '99999');
    expect(screen.getByRole('button', { name: 'Save clock limit' })).toBeDisabled();
  });
});
