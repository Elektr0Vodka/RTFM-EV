import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsBackupRestore } from '../components/settings/SettingsBackupRestore';
import { api } from '../api';
import type { AppSettings, RestoreStatus } from '../types';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    backup_to_path_enabled: false,
    backup_destination_path: '',
    backup_schedule_enabled: false,
    backup_schedule_interval_hours: 24,
    backup_schedule_keep: 7,
    ...overrides,
  } as AppSettings;
}

const EMPTY: RestoreStatus = { pending: null, last_result: null };
const PENDING: RestoreStatus = {
  pending: {
    source: 'upload',
    original_name: 'old.db',
    size_bytes: 2 * 1024 * 1024,
    schema_version: 104,
    staged_at: 1_700_000_000,
  },
  last_result: null,
};

beforeEach(() => {
  vi.spyOn(api, 'listBackupFiles').mockResolvedValue({
    enabled: false,
    path: '',
    files: [],
    error: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe('SettingsBackupRestore', () => {
  it('shows a staged restore and cancels it', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(PENDING);
    const cancel = vi.spyOn(api, 'cancelRestore').mockResolvedValue(EMPTY);
    render(<SettingsBackupRestore appSettings={settings()} persist={vi.fn()} />);

    expect(await screen.findByText(/old\.db/)).toBeInTheDocument();
    expect(screen.getByText(/restart the server to apply it/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel restore/i }));
    expect(cancel).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/old\.db/)).not.toBeInTheDocument());
  });

  it('uploads a chosen file after confirmation', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    const upload = vi.spyOn(api, 'restoreFromUpload').mockResolvedValue(PENDING);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsBackupRestore appSettings={settings()} persist={vi.fn()} />);

    const file = new File(['x'], 'old.db', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByLabelText(/restore from file/i), file);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/restart the server to apply it/i)).toBeInTheDocument();
  });

  it('does not upload when the confirmation is declined', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    const upload = vi.spyOn(api, 'restoreFromUpload').mockResolvedValue(PENDING);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsBackupRestore appSettings={settings()} persist={vi.fn()} />);

    const file = new File(['x'], 'old.db');
    await userEvent.upload(screen.getByLabelText(/restore from file/i), file);

    expect(upload).not.toHaveBeenCalled();
  });

  it('lists server backups and restores one', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    vi.spyOn(api, 'listBackupFiles').mockResolvedValue({
      enabled: true,
      path: '/mnt/b',
      files: [
        {
          name: 'meshcore-auto-20260901-000000.db',
          size_bytes: 1024,
          modified_at: 1_700_000_000,
          kind: 'auto',
        },
      ],
      error: null,
    });
    const restore = vi.spyOn(api, 'restoreFromServer').mockResolvedValue(PENDING);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <SettingsBackupRestore
        appSettings={settings({ backup_to_path_enabled: true, backup_destination_path: '/mnt/b' })}
        persist={vi.fn()}
      />
    );

    expect(await screen.findByText('meshcore-auto-20260901-000000.db')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    expect(restore).toHaveBeenCalledWith('meshcore-auto-20260901-000000.db');
  });

  it('reloads the server list when refreshToken changes (after a manual save)', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    const list = vi.spyOn(api, 'listBackupFiles').mockResolvedValue({
      enabled: true,
      path: '/mnt/b',
      files: [],
      error: null,
    });
    const on = settings({ backup_to_path_enabled: true, backup_destination_path: '/mnt/b' });
    const { rerender } = render(
      <SettingsBackupRestore appSettings={on} persist={vi.fn()} refreshToken={0} />
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    rerender(<SettingsBackupRestore appSettings={on} persist={vi.fn()} refreshToken={1} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('reports the last restore and dismisses it', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue({
      pending: null,
      last_result: {
        ok: true,
        applied_at: 1_700_000_000,
        source: 'server',
        original_name: 'old.db',
        pre_restore_snapshot: '/data/meshcore-pre-restore-20260901-000000.db',
        schema_version: 104,
        error: null,
      },
    });
    const dismiss = vi.spyOn(api, 'dismissRestoreResult').mockResolvedValue(EMPTY);
    render(<SettingsBackupRestore appSettings={settings()} persist={vi.fn()} />);

    expect(await screen.findByText(/meshcore-pre-restore-20260901-000000\.db/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismiss).toHaveBeenCalled();
  });

  it('persists the automatic backup toggle', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    const persist = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsBackupRestore
        appSettings={settings({ backup_to_path_enabled: true, backup_destination_path: '/mnt/b' })}
        persist={persist}
      />
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /back up automatically/i }));
    expect(persist).toHaveBeenCalledWith({ backup_schedule_enabled: true }, expect.any(Function));
  });

  it('hides the schedule and server list when server backups are off', async () => {
    vi.spyOn(api, 'getRestoreStatus').mockResolvedValue(EMPTY);
    render(<SettingsBackupRestore appSettings={settings()} persist={vi.fn()} />);
    await screen.findByLabelText(/restore from file/i);
    expect(screen.queryByRole('checkbox', { name: /back up automatically/i })).toBeNull();
    expect(screen.queryByText(/backups on the server/i)).toBeNull();
  });
});
