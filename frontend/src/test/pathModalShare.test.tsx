import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PathModal } from '../components/PathModal';

vi.mock('../api', () => ({ api: { listPartialResolutions: vi.fn().mockResolvedValue([]) } }));

function renderModal(
  onShare?: () => void,
  paths = [{ path: '4532', received_at: 1_700_000_000, path_len: 2 }]
) {
  render(
    <PathModal
      open
      onClose={vi.fn()}
      paths={paths}
      senderInfo={{ name: 'Sender', publicKeyOrPrefix: 'aabbccddeeff', lat: null, lon: null }}
      contacts={[]}
      config={null}
      onShare={onShare}
    />
  );
}

describe('PathModal share', () => {
  it('shows a Share button that calls onShare', async () => {
    const onShare = vi.fn();
    renderModal(onShare);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalled();
  });

  it('has no Share button without onShare', () => {
    renderModal(undefined);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('has no Share button when there are no paths', () => {
    renderModal(vi.fn(), []);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
