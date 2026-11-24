import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PathModal } from '../components/PathModal';
import type { MessagePath } from '../types';

vi.mock('../api', () => ({ api: { listPartialResolutions: vi.fn().mockResolvedValue([]) } }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('../components/ui/sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

function renderModal(paths: MessagePath[], opts: { isOutgoingChan?: boolean } = {}) {
  render(
    <PathModal
      open
      onClose={vi.fn()}
      paths={paths}
      senderInfo={{ name: 'Sender', publicKeyOrPrefix: 'aabbccddeeff', lat: null, lon: null }}
      contacts={[]}
      config={null}
      isOutgoingChan={opts.isOutgoingChan}
    />
  );
}

const BUTTON = { name: 'Copy reverse path' };

describe('PathModal copy reverse path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    toastSuccess.mockReset();
  });

  it('copies the hops in reverse order in the routing override format', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderModal([{ path: 'AE92F13E', received_at: 1_700_000_000, path_len: 2 }]);

    await user.click(screen.getByRole('button', BUTTON));

    expect(writeText).toHaveBeenCalledWith('f13e,ae92');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('gives one button per received path', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderModal([
      { path: 'aabb', received_at: 1_700_000_000, path_len: 2 },
      { path: '112233', received_at: 1_700_000_001, path_len: 1 },
    ]);

    const buttons = screen.getAllByRole('button', BUTTON);
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    expect(writeText).toHaveBeenCalledWith('112233');
  });

  it('is disabled for a direct path', () => {
    renderModal([{ path: '', received_at: 1_700_000_000, path_len: 0 }]);
    const button = screen.getByRole('button', BUTTON);
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute(
      'title',
      'Direct path: there are no hops to reverse'
    );
  });

  it('is disabled instead of guessing when the hop size is unknown', () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    // Legacy entry without path_len: 4 hex chars could be 2x1 byte or 1x2 bytes.
    renderModal([{ path: 'aabb', received_at: 1_700_000_000, path_len: null }]);
    const button = screen.getByRole('button', BUTTON);
    expect(button).toBeDisabled();
    expect(button.parentElement?.getAttribute('title')).toMatch(/hop size .* unknown/i);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('is not shown for echoes of our own channel message', () => {
    renderModal([{ path: 'aabb', received_at: 1_700_000_000, path_len: 2 }], {
      isOutgoingChan: true,
    });
    expect(screen.queryByRole('button', BUTTON)).toBeNull();
  });
});
