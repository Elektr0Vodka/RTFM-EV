import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PartialNodeSyncModal } from '../components/settings/PartialNodeSyncModal';
import { api } from '../api';
import type { PartialResolutionPreview } from '../types';

vi.mock('../api', () => ({
  api: {
    previewPartialResolutions: vi.fn(),
    applyPartialResolutions: vi.fn().mockResolvedValue({ applied: 1 }),
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
});
