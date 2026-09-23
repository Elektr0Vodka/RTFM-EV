import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ContactTelemetryPermissionsControl } from '../components/ContactTelemetryPermissionsControl';
import type { Contact } from '../types';

const { setContactTelemetryPermissions, toastError } = vi.hoisted(() => ({
  setContactTelemetryPermissions: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { setContactTelemetryPermissions },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}));

const KEY = 'AA'.repeat(32);

function createContact(overrides: Partial<Contact> = {}): Contact {
  return {
    public_key: KEY,
    name: 'Alice',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: 1700000000,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: 1699990000,
    ...overrides,
  };
}

function pressed(name: string) {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

describe('ContactTelemetryPermissionsControl', () => {
  beforeEach(() => {
    setContactTelemetryPermissions.mockReset();
    toastError.mockReset();
    setContactTelemetryPermissions.mockResolvedValue({ applied_to_radio: true });
  });

  it('reflects app-set permissions', () => {
    render(<ContactTelemetryPermissionsControl contact={createContact({ telemetry_perms: 5 })} />);
    expect(pressed('Battery')).toBe('true');
    expect(pressed('Location')).toBe('false');
    expect(pressed('Environment')).toBe('true');
  });

  it('falls back to the radio flag bits when nothing was set in the app', () => {
    // flags bit 0 = radio favourite, bits 1..3 = base/location/environment
    render(<ContactTelemetryPermissionsControl contact={createContact({ flags: 0x05 })} />);
    expect(pressed('Battery')).toBe('false');
    expect(pressed('Location')).toBe('true');
    expect(pressed('Environment')).toBe('false');
  });

  it('sends the full permission set when one toggle changes', async () => {
    render(<ContactTelemetryPermissionsControl contact={createContact({ telemetry_perms: 1 })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Location' }));

    await waitFor(() =>
      expect(setContactTelemetryPermissions).toHaveBeenCalledWith(KEY, {
        base: true,
        location: true,
        environment: false,
      })
    );
    expect(pressed('Location')).toBe('true');
  });

  it('reverts and reports an error when saving fails', async () => {
    setContactTelemetryPermissions.mockRejectedValue(new Error('boom'));
    render(<ContactTelemetryPermissionsControl contact={createContact({ telemetry_perms: 0 })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(pressed('Battery')).toBe('false');
  });
});
