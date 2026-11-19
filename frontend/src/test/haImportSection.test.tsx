import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HaImportSection } from '../components/settings/HaImportSection';
import { api } from '../api';
import type { HaImportStatus, RestoreStatus } from '../types';

const SLUG = 'e8c7f026_mc_remoteterm';

function status(overrides: Partial<HaImportStatus> = {}): HaImportStatus {
  return {
    installed: [],
    backups: [
      {
        backup_slug: '48ff13dc',
        backup_name: 'TestHARTFM',
        created: '2026-11-19T19:19:24+00:00',
        addon_slug: SLUG,
        addon_name: 'RemoteTerm for MeshCore',
        protected: false,
      },
    ],
    database_empty: true,
    ...overrides,
  };
}

const STAGED: RestoreStatus = {
  pending: {
    source: 'ha-backup',
    original_name: 'TestHARTFM',
    size_bytes: 1024,
    schema_version: 60,
    staged_at: 1_700_000_000,
  },
  last_result: null,
};

afterEach(() => vi.restoreAllMocks());

describe('HaImportSection', () => {
  it('lists RemoteTerm backups', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(status());
    render(<HaImportSection />);
    expect(await screen.findByText('TestHARTFM')).toBeInTheDocument();
  });

  it('imports a backup and offers a restart', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(status());
    const imp = vi.spyOn(api, 'haImportFromBackup').mockResolvedValue(STAGED);
    const restart = vi.spyOn(api, 'haRestart').mockResolvedValue({ status: 'restarting' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onStaged = vi.fn();
    render(<HaImportSection onStaged={onStaged} />);

    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));
    expect(imp).toHaveBeenCalledWith('48ff13dc', SLUG);
    expect(onStaged).toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /restart the add-on/i }));
    expect(restart).toHaveBeenCalled();
  });

  it('does not import when the confirm is declined', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(status());
    const imp = vi.spyOn(api, 'haImportFromBackup').mockResolvedValue(STAGED);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<HaImportSection />);
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));
    expect(imp).not.toHaveBeenCalled();
  });

  it('disables encrypted backups with a hint', async () => {
    const s = status();
    s.backups[0].protected = true;
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(s);
    render(<HaImportSection />);
    expect(await screen.findByRole('button', { name: /^import$/i })).toBeDisabled();
    expect(screen.getByText(/encrypted/i)).toBeInTheDocument();
  });

  it('offers to make a backup only when RemoteTerm is installed', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(status());
    const { unmount } = render(<HaImportSection />);
    await screen.findByText('TestHARTFM');
    expect(screen.queryByRole('button', { name: /make a backup/i })).toBeNull();
    unmount();

    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(
      status({ installed: [{ slug: SLUG, name: 'RemoteTerm for MeshCore' }] })
    );
    const make = vi.spyOn(api, 'haMakeBackup').mockResolvedValue({ backup_slug: 'new1' });
    render(<HaImportSection />);
    const button = await screen.findByRole('button', { name: /make a backup/i });
    const loadsBefore = vi.mocked(api.getHaImportStatus).mock.calls.length;
    await userEvent.click(button);
    expect(make).toHaveBeenCalledWith(SLUG);
    await waitFor(() =>
      expect(vi.mocked(api.getHaImportStatus).mock.calls.length).toBe(loadsBefore + 1)
    );
  });

  it('shows the server error when an import is refused', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(status());
    vi.spyOn(api, 'haImportFromBackup').mockRejectedValue(new Error('This backup is encrypted.'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<HaImportSection />);
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This backup is encrypted.');
  });
});
