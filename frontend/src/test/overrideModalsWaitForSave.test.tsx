import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChannelFloodScopeOverrideModal } from '../components/ChannelFloodScopeOverrideModal';
import { ChannelPathHashModeOverrideModal } from '../components/ChannelPathHashModeOverrideModal';

describe('override dialogs wait for the save', () => {
  it('region override closes once saved', async () => {
    const onClose = vi.fn();
    const onSetOverride = vi.fn(async () => true);
    render(
      <ChannelFloodScopeOverrideModal
        open
        onClose={onClose}
        roomName="#ops"
        currentOverride={null}
        onSetOverride={onSetOverride}
      />
    );
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'nl' } });
    fireEvent.click(screen.getByRole('button', { name: /nl/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSetOverride).toHaveBeenCalledWith('nl');
  });

  it('region override stays open with the typed region when saving failed', async () => {
    const onClose = vi.fn();
    const onSetOverride = vi.fn(async () => false);
    render(
      <ChannelFloodScopeOverrideModal
        open
        onClose={onClose}
        roomName="#ops"
        currentOverride={null}
        onSetOverride={onSetOverride}
      />
    );
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'nl' } });
    fireEvent.click(screen.getByRole('button', { name: /nl/ }));

    await waitFor(() => expect(onSetOverride).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Region')).toHaveValue('nl');
  });

  it('path hop width override stays open when saving failed', async () => {
    const onClose = vi.fn();
    const onSetOverride = vi.fn(async () => false);
    render(
      <ChannelPathHashModeOverrideModal
        open
        onClose={onClose}
        channelName="#ops"
        currentOverride={null}
        radioDefault={0}
        onSetOverride={onSetOverride}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use radio default for #ops' }));

    await waitFor(() => expect(onSetOverride).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(onClose).not.toHaveBeenCalled();
  });
});
