import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PartialNodeSyncModal } from '../components/settings/PartialNodeSyncModal';
import { api } from '../api';
import type { PartialResolutionPreview } from '../types';

vi.mock('../api', () => ({
  api: {
    previewPartialResolutions: vi.fn(),
    applyPartialResolutions: vi.fn().mockResolvedValue({ applied: 1 }),
    listPartialResolutions: vi.fn(),
    deletePartialResolution: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const EXT_A = 'aa' + '11'.repeat(31);

const unambiguousPreview: PartialResolutionPreview = {
  external_count: 5,
  reason: null,
  resolutions: [
    {
      prefix_hex: 'aa',
      seen_as: 'placeholder',
      candidate_count: 1,
      candidates: [
        { pubkey: EXT_A, name: 'Alpha', lat: 52, lon: 4, confidence: 0.8, distance_km: null },
      ],
    },
  ],
  unmatched: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listPartialResolutions).mockResolvedValue([]);
});

describe('PartialNodeSyncModal', () => {
  it('loads the preview on open and shows the proposed candidate', async () => {
    vi.mocked(api.previewPartialResolutions).mockResolvedValue(unambiguousPreview);
    render(<PartialNodeSyncModal open onClose={() => {}} />);

    await waitFor(() => expect(api.previewPartialResolutions).toHaveBeenCalled());
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('aa')).toBeInTheDocument();
  });

  it('applies only the checked rows with the chosen candidate', async () => {
    vi.mocked(api.previewPartialResolutions).mockResolvedValue(unambiguousPreview);
    render(<PartialNodeSyncModal open onClose={() => {}} />);
    await screen.findByText('Alpha');

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() =>
      expect(api.applyPartialResolutions).toHaveBeenCalledWith([
        {
          prefix_hex: 'aa',
          resolved_pubkey: EXT_A,
          resolved_name: 'Alpha',
          confidence: 0.8,
          candidate_count: 1,
        },
      ])
    );
  });

  it('auto-checks an ambiguous row whose best candidate is within 15km of the path', async () => {
    const preview: PartialResolutionPreview = {
      external_count: 5,
      reason: null,
      unmatched: [],
      resolutions: [
        {
          prefix_hex: 'cc',
          seen_as: 'path',
          candidate_count: 2,
          candidates: [
            {
              pubkey: 'cc' + '11'.repeat(31),
              name: 'Near',
              lat: 52,
              lon: 4,
              confidence: 0.3,
              distance_km: 10,
            },
            {
              pubkey: 'cc' + '22'.repeat(31),
              name: 'NearAlt',
              lat: 52,
              lon: 4,
              confidence: 0.2,
              distance_km: 40,
            },
          ],
        },
        {
          prefix_hex: 'dd',
          seen_as: 'path',
          candidate_count: 2,
          candidates: [
            {
              pubkey: 'dd' + '11'.repeat(31),
              name: 'Far',
              lat: 48,
              lon: 2,
              confidence: 0.2,
              distance_km: 100,
            },
            {
              pubkey: 'dd' + '22'.repeat(31),
              name: 'FarAlt',
              lat: 48,
              lon: 2,
              confidence: 0.1,
              distance_km: 200,
            },
          ],
        },
      ],
    };
    vi.mocked(api.previewPartialResolutions).mockResolvedValue(preview);
    render(<PartialNodeSyncModal open onClose={() => {}} />);
    await screen.findByText('cc');

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() =>
      expect(api.applyPartialResolutions).toHaveBeenCalledWith([
        {
          prefix_hex: 'cc',
          resolved_pubkey: 'cc' + '11'.repeat(31),
          resolved_name: 'Near',
          confidence: 0.3,
          candidate_count: 2,
        },
      ])
    );
  });

  it('shows the reason when the external cache is empty', async () => {
    vi.mocked(api.previewPartialResolutions).mockResolvedValue({
      external_count: 0,
      reason: 'The external map cache is empty. Enable and sync the external map first.',
      resolutions: [],
      unmatched: [],
    });
    render(<PartialNodeSyncModal open onClose={() => {}} />);

    expect(await screen.findByText(/external map cache is empty/i)).toBeInTheDocument();
  });

  describe('applied soft links', () => {
    const appliedRow = (prefix: string, name: string) => ({
      prefix_hex: prefix,
      resolved_pubkey: prefix + '22'.repeat(31),
      resolved_name: name,
      source: 'external_map',
      confidence: 0.9,
      candidate_count: 1,
      resolved_by: 'user',
      created_at: null,
      updated_at: null,
    });

    it('lists applied links and removes one', async () => {
      vi.mocked(api.previewPartialResolutions).mockResolvedValue(unambiguousPreview);
      vi.mocked(api.listPartialResolutions).mockResolvedValue([
        appliedRow('bb', 'Bravo'),
        appliedRow('cc', 'Charlie'),
      ]);
      vi.mocked(api.deletePartialResolution).mockResolvedValue({ deleted: true });
      render(<PartialNodeSyncModal open onClose={() => {}} />);

      fireEvent.click(await screen.findByText('Applied soft links (2)'));
      expect(screen.getByText('Bravo')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Remove soft link bb' }));

      await waitFor(() => expect(api.deletePartialResolution).toHaveBeenCalledWith('bb'));
      await waitFor(() => expect(screen.queryByText('Bravo')).not.toBeInTheDocument());
      expect(screen.getByText('Charlie')).toBeInTheDocument();
      expect(screen.getByText('Applied soft links (1)')).toBeInTheDocument();
    });

    it('keeps the row when removal fails', async () => {
      vi.mocked(api.previewPartialResolutions).mockResolvedValue(unambiguousPreview);
      vi.mocked(api.listPartialResolutions).mockResolvedValue([appliedRow('bb', 'Bravo')]);
      vi.mocked(api.deletePartialResolution).mockRejectedValue(new Error('boom'));
      render(<PartialNodeSyncModal open onClose={() => {}} />);

      fireEvent.click(await screen.findByText('Applied soft links (1)'));
      fireEvent.click(screen.getByRole('button', { name: 'Remove soft link bb' }));

      await waitFor(() => expect(api.deletePartialResolution).toHaveBeenCalledWith('bb'));
      expect(screen.getByText('Bravo')).toBeInTheDocument();
    });

    it('shows applied links even when the external map cache is empty', async () => {
      vi.mocked(api.previewPartialResolutions).mockResolvedValue({
        external_count: 0,
        reason: 'The external map cache is empty.',
        resolutions: [],
        unmatched: [],
      });
      vi.mocked(api.listPartialResolutions).mockResolvedValue([appliedRow('bb', 'Bravo')]);
      render(<PartialNodeSyncModal open onClose={() => {}} />);

      expect(await screen.findByText('Applied soft links (1)')).toBeInTheDocument();
    });
  });
});
