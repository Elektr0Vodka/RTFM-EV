import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AtlasSidebarFoot, AtlasSidebarHead } from '../components/shell/AtlasSidebar';
import { CommandPalette } from '../components/CommandPalette';
import { StatusBar } from '../components/StatusBar';
import { useThemeLayout } from '../hooks/useThemeLayout';
import { COMMAND_PALETTE_OPEN_EVENT, openCommandPalette } from '../utils/commandPalette';
import { applyTheme, getThemeLayout } from '../utils/theme';
import type { HealthStatus } from '../types';

const health: HealthStatus = {
  status: 'degraded',
  radio_connected: false,
  radio_initializing: false,
  connection_info: null,
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
};

describe('theme layout', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('is atlas for the MCEU themes and classic for everything else', () => {
    expect(getThemeLayout('mceu-light')).toBe('atlas');
    expect(getThemeLayout('mceu-dark')).toBe('atlas');
    expect(getThemeLayout('original')).toBe('classic');
    expect(getThemeLayout('darkdutch')).toBe('classic');
    expect(getThemeLayout('no-such-theme')).toBe('classic');
  });

  it('useThemeLayout follows theme changes', () => {
    const { result } = renderHook(() => useThemeLayout());
    expect(result.current).toBe('classic');

    act(() => applyTheme('mceu-dark'));
    expect(result.current).toBe('atlas');

    act(() => applyTheme('original'));
    expect(result.current).toBe('classic');
  });
});

describe('AtlasSidebarHead', () => {
  it('shows the brand and a search button that asks for the command palette', () => {
    const onOpen = vi.fn();
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);

    render(<AtlasSidebarHead brandName="My Mesh" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Mesh');
    fireEvent.click(screen.getByRole('button', { name: 'Search anything' }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
  });

  it('keeps only the logo and the search icon on the rail', () => {
    render(<AtlasSidebarHead brandName="My Mesh" rail />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Search anything' })).toBeInTheDocument();
    expect(screen.queryByText('Search anything')).not.toBeInTheDocument();
  });
});

describe('AtlasSidebarFoot', () => {
  function renderFoot(props: Partial<Parameters<typeof AtlasSidebarFoot>[0]> = {}) {
    const handlers = {
      onSettingsClick: vi.fn(),
      onOpenChatWindow: vi.fn(),
      onOpenThemeSettings: vi.fn(),
    };
    render(<AtlasSidebarFoot settingsMode={false} {...handlers} {...props} />);
    return handlers;
  }

  it('has rows for settings, chat window, language and theme', () => {
    const handlers = renderFoot();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handlers.onSettingsClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Chat window' }));
    expect(handlers.onOpenChatWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Color Scheme' }));
    expect(handlers.onOpenThemeSettings).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('English');
  });

  it('turns the settings row into "Back to Chat" while settings are open', () => {
    renderFoot({ settingsMode: true });

    expect(screen.getByRole('button', { name: 'Back to Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('leaves the chat window row out when there is no handler', () => {
    renderFoot({ onOpenChatWindow: undefined });

    expect(screen.queryByRole('button', { name: 'Chat window' })).not.toBeInTheDocument();
  });

  it('keeps labelled icon buttons on the rail and drops the language row', () => {
    renderFoot({ rail: true });

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Color Scheme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Language' })).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});

describe('StatusBar topbar variant', () => {
  it('shows the radio state and leaves the brand and app controls to the sidebar', () => {
    render(
      <StatusBar
        health={health}
        config={null}
        onSettingsClick={vi.fn()}
        onMenuClick={vi.fn()}
        onOpenChatWindow={vi.fn()}
        variant="topbar"
      />
    );

    expect(screen.getByRole('status', { name: 'Radio Disconnected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat window' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open theme settings' })).not.toBeInTheDocument();
  });

  it('the classic bar hands the theme button to the parent when asked to', () => {
    const onOpenThemeSettings = vi.fn();
    render(
      <StatusBar
        health={health}
        config={null}
        onSettingsClick={vi.fn()}
        onOpenThemeSettings={onOpenThemeSettings}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open theme settings' }));
    expect(onOpenThemeSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('command palette open request', () => {
  beforeEach(() => {
    // cmdk calls scrollIntoView on mount; jsdom does not implement it.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('opens when openCommandPalette() is called', () => {
    render(
      <CommandPalette
        contacts={[]}
        channels={[]}
        onSelectConversation={vi.fn()}
        onOpenSettings={vi.fn()}
        onRepeaterAutoLogin={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText('Jump to...')).not.toBeInTheDocument();

    act(() => openCommandPalette());

    expect(screen.getByPlaceholderText('Jump to...')).toBeInTheDocument();
  });
});
