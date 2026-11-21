import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HaImportBanner, HA_IMPORT_BANNER_KEY } from '../components/HaImportBanner';
import { api } from '../api';
import type { HaImportStatus } from '../types';

const BASE: HaImportStatus = {
  installed: [{ slug: 'e8c7f026_mc_remoteterm', name: 'RemoteTerm for MeshCore' }],
  backups: [],
  database_empty: true,
};

beforeEach(() => {
  try {
    localStorage.removeItem(HA_IMPORT_BANNER_KEY);
  } catch {
    /* storage blocked */
  }
});
afterEach(() => vi.restoreAllMocks());

describe('HaImportBanner', () => {
  it('stays hidden outside add-on mode and never calls the API', async () => {
    const spy = vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(BASE);
    const { container } = render(<HaImportBanner haAddon={false} onOpen={vi.fn()} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows when the database is empty and RemoteTerm is found', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(BASE);
    const onOpen = vi.fn();
    render(<HaImportBanner haAddon onOpen={onOpen} />);
    await userEvent.click(await screen.findByRole('button', { name: /import/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('stays hidden when the database already has data', async () => {
    const spy = vi
      .spyOn(api, 'getHaImportStatus')
      .mockResolvedValue({ ...BASE, database_empty: false });
    const { container } = render(<HaImportBanner haAddon onOpen={vi.fn()} />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when nothing from RemoteTerm is found', async () => {
    const spy = vi.spyOn(api, 'getHaImportStatus').mockResolvedValue({ ...BASE, installed: [] });
    const { container } = render(<HaImportBanner haAddon onOpen={vi.fn()} />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays dismissed', async () => {
    vi.spyOn(api, 'getHaImportStatus').mockResolvedValue(BASE);
    const { unmount } = render(<HaImportBanner haAddon onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    unmount();

    const { container } = render(<HaImportBanner haAddon onOpen={vi.fn()} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
