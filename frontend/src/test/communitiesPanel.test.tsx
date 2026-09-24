import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunitiesPanel } from '../components/CommunitiesPanel';
import type { Community } from '../types';

const mocks = vi.hoisted(() => ({
  getCommunities: vi.fn(),
  joinCommunity: vi.fn(),
  addCommunityHashtag: vi.fn(),
  exportCommunity: vi.fn(),
  deleteCommunity: vi.fn(),
  scanQr: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getCommunities: mocks.getCommunities,
    joinCommunity: mocks.joinCommunity,
    addCommunityHashtag: mocks.addCommunityHashtag,
    exportCommunity: mocks.exportCommunity,
    deleteCommunity: mocks.deleteCommunity,
  },
}));

vi.mock('../utils/communityQr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/communityQr')>();
  return { ...actual, scanQr: mocks.scanQr };
});

vi.mock('../components/ui/sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: vi.fn() },
}));

const PAYLOAD =
  '{"v":1,"type":"meshcore_community","name":"Acme","k":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="}';

const ACME: Community = {
  id: 'b235068a' + '0'.repeat(56),
  short_id: 'b235068a',
  name: 'Acme',
  created_at: 1,
  public_channel_key: 'CD18A636C186D37D2CB79DD7B4697727',
  channels: [{ key: 'CD18A636C186D37D2CB79DD7B4697727', name: 'Acme Public', kind: 'public' }],
};

describe('CommunitiesPanel', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('joins a community from pasted JSON and shows its channels', async () => {
    const user = userEvent.setup();
    const onChannelsChanged = vi.fn();
    mocks.getCommunities.mockResolvedValue([]);
    mocks.joinCommunity.mockResolvedValue({
      community: ACME,
      already_joined: false,
      created_channels: [],
      decrypt_started: false,
      decrypt_total_packets: 0,
    });
    render(<CommunitiesPanel onChannelsChanged={onChannelsChanged} />);

    const box = await screen.findByRole('textbox', { name: 'Community code (JSON)' });
    fireEvent.change(box, { target: { value: PAYLOAD } });
    const joinButtons = screen.getAllByRole('button', { name: 'Join community' });
    await user.click(joinButtons[joinButtons.length - 1]);

    expect(mocks.joinCommunity).toHaveBeenCalledWith(PAYLOAD, true, true);
    expect(await screen.findByText('Acme Public')).toBeInTheDocument();
    expect(screen.getByText('ID b235068a')).toBeInTheDocument();
    expect(onChannelsChanged).toHaveBeenCalled();
  });

  it('fills the payload from an uploaded QR image', async () => {
    mocks.getCommunities.mockResolvedValue([]);
    mocks.scanQr.mockResolvedValue(PAYLOAD);
    render(<CommunitiesPanel onChannelsChanged={vi.fn()} />);

    const input = await screen.findByTestId('community-qr-image-input');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'qr.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Community code (JSON)' })).toHaveValue(PAYLOAD)
    );
    expect(mocks.scanQr).toHaveBeenCalledWith(file);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Community code found');
  });

  it('reports an image without a QR code', async () => {
    mocks.getCommunities.mockResolvedValue([]);
    mocks.scanQr.mockResolvedValue(null);
    render(<CommunitiesPanel onChannelsChanged={vi.fn()} />);

    const input = await screen.findByTestId('community-qr-image-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'x.png')] } });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('No QR code found in that image')
    );
  });

  it('adds a hashtag channel to a joined community', async () => {
    const user = userEvent.setup();
    mocks.getCommunities.mockResolvedValue([ACME]);
    mocks.addCommunityHashtag.mockResolvedValue({
      channel: { key: '15', name: 'Acme #ops' },
      created: true,
      community: {
        ...ACME,
        channels: [
          ...ACME.channels,
          { key: '152999787891E7AB30C7B6EEB7909B40', name: 'Acme #ops', kind: 'hashtag' },
        ],
      },
      decrypt_started: false,
      decrypt_total_packets: 0,
    });
    render(<CommunitiesPanel onChannelsChanged={vi.fn()} />);

    const tagInput = await screen.findByRole('textbox', { name: 'Community hashtag' });
    await user.type(tagInput, '#ops');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(mocks.addCommunityHashtag).toHaveBeenCalledWith(ACME.id, '#ops', true);
    expect(await screen.findByText('Acme #ops')).toBeInTheDocument();
  });

  it('only fetches the secret when export is requested, then shows QR and JSON', async () => {
    const user = userEvent.setup();
    mocks.getCommunities.mockResolvedValue([ACME]);
    mocks.exportCommunity.mockResolvedValue({ id: ACME.id, name: 'Acme', payload: PAYLOAD });
    render(<CommunitiesPanel onChannelsChanged={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Show QR code and JSON' }));

    expect(mocks.exportCommunity).toHaveBeenCalledWith(ACME.id);
    const img = await screen.findByRole('img', { name: 'QR code for community Acme' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole('textbox', { name: 'Community code (JSON)' })).toHaveValue(PAYLOAD);
  });
});
