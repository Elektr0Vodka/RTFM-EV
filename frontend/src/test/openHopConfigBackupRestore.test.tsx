import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBackupRestoreCard } from '../components/settings/openhop/config/ConfigBackupRestoreCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

function stubObjectUrl() {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  } as unknown as typeof URL);
}

describe('ConfigBackupRestoreCard', () => {
  it('exports a redacted backup by default', async () => {
    const spy = vi
      .spyOn(api, 'getOpenHopConfigExport')
      .mockResolvedValue({ success: true, data: { meta: {}, config: { repeater: {} } } });
    stubObjectUrl();
    render(<ConfigBackupRestoreCard />);
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    vi.unstubAllGlobals();
  });

  it('passes include-secrets when the checkbox is ticked', async () => {
    const spy = vi
      .spyOn(api, 'getOpenHopConfigExport')
      .mockResolvedValue({ success: true, data: { config: {} } });
    stubObjectUrl();
    render(<ConfigBackupRestoreCard />);
    await userEvent.click(screen.getByLabelText(/include secrets/i));
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
    vi.unstubAllGlobals();
  });
});
