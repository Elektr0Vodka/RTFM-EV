import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrackerPanel } from '../components/CrackerPanel';

const { setWordlist } = vi.hoisted(() => ({ setWordlist: vi.fn() }));

vi.mock('meshcore-hashtag-cracker', () => ({
  GroupTextCracker: class {
    isGpuAvailable() {
      return false;
    }
    destroy() {}
    setWordlist(words: string[]) {
      setWordlist(words);
    }
    abort() {}
  },
}));

vi.mock('meshcore-hashtag-cracker/wordlist', () => ({
  ENGLISH_WORDLIST: ['apple', 'banana'],
}));

vi.mock('nosleep.js', () => ({
  default: class {
    enable() {}
    disable() {}
  },
}));

vi.mock('../api', () => ({
  api: {
    getUndecryptedPacketCount: vi.fn(),
    listWordlists: vi.fn(),
    getWordlistWords: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { api } from '../api';

const mockedApi = vi.mocked(api);

const FILES: Record<string, string> = {
  'wordlists/nl.txt': 'fiets\ngracht\n',
  'wordlists/known-channels.txt': 'amsterdam\nmeshcore-nl\n',
};

function lastWordlist(): string[] {
  const calls = setWordlist.mock.calls;
  return calls[calls.length - 1][0] as string[];
}

describe('CrackerPanel wordlist selection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedApi.getUndecryptedPacketCount.mockResolvedValue({ count: 0 });
    mockedApi.listWordlists.mockResolvedValue({ wordlists: [] });
    fetchMock = vi.fn(async (url: string) => {
      const body = FILES[url];
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        text: async () => body ?? '',
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads English and the known channels by default, not the Dutch list', async () => {
    render(<CrackerPanel channels={[]} onChannelCreate={vi.fn()} visible />);

    await waitFor(() => expect(setWordlist).toHaveBeenCalled());

    expect(lastWordlist()).toEqual(['apple', 'banana', 'amsterdam', 'meshcore-nl']);
    expect(fetchMock).toHaveBeenCalledWith('wordlists/known-channels.txt');
    expect(fetchMock).not.toHaveBeenCalledWith('wordlists/nl.txt');
  });

  it('lets the known channels be switched off on their own', async () => {
    render(<CrackerPanel channels={[]} onChannelCreate={vi.fn()} visible />);
    await waitFor(() => expect(setWordlist).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Wordlists' }));
    const known = screen.getByRole('checkbox', { name: /Known channels \(MCCL\)/ });
    expect(known).toBeChecked();
    fireEvent.click(known);

    await waitFor(() => expect(lastWordlist()).toEqual(['apple', 'banana']));
  });

  it('merges every selected list when several are on at once', async () => {
    render(<CrackerPanel channels={[]} onChannelCreate={vi.fn()} visible />);
    await waitFor(() => expect(setWordlist).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Wordlists' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Dutch \(NL\)/ }));

    await waitFor(() =>
      expect(lastWordlist()).toEqual([
        'apple',
        'banana',
        'fiets',
        'gracht',
        'amsterdam',
        'meshcore-nl',
      ])
    );
  });

  it('uses only the known channels when the other lists are off', async () => {
    localStorage.setItem(
      'meshcore-wordlist-selection',
      JSON.stringify({ english: false, dutch: false, knownChannels: true, customIds: [] })
    );

    render(<CrackerPanel channels={[]} onChannelCreate={vi.fn()} visible />);

    await waitFor(() => expect(setWordlist).toHaveBeenCalled());
    expect(lastWordlist()).toEqual(['amsterdam', 'meshcore-nl']);
  });
});
