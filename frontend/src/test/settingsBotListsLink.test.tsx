import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsLocalSection } from '../components/settings/SettingsLocalSection';

describe('Settings > Local: Bot lists', () => {
  it('links to the Bot lists tab instead of showing the lists', () => {
    const onOpenBotLists = vi.fn();
    render(<SettingsLocalSection onOpenBotLists={onOpenBotLists} />);

    expect(screen.getByText(/now on their own tab of the Spam Guard page/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Hide bots in chat')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open bot lists' }));
    expect(onOpenBotLists).toHaveBeenCalledTimes(1);
  });
});
