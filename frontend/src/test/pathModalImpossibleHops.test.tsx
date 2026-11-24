import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PathModal } from '../components/PathModal';
import type { Contact } from '../types';

const { listPartialResolutions } = vi.hoisted(() => ({
  listPartialResolutions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../api', () => ({ api: { listPartialResolutions } }));

function repeater(publicKey: string, name: string, lat: number, lon: number): Contact {
  return {
    public_key: publicKey,
    name,
    type: 2,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat,
    lon,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

describe('PathModal impossible hop matches', () => {
  it('shows the nearby match and notes the ignored far-away one', async () => {
    render(
      <PathModal
        open
        onClose={vi.fn()}
        paths={[{ path: '45', received_at: 1_700_000_000, path_len: 1 }]}
        senderInfo={{ name: 'Sender', publicKeyOrPrefix: 'aabbccddeeff', lat: 52.1, lon: 5.1 }}
        contacts={[
          repeater(`45aa${'0'.repeat(60)}`, 'Utrecht Relay', 52.09, 5.12),
          repeater(`45bb${'0'.repeat(60)}`, 'Lisbon Relay', 38.72, -9.14),
        ]}
        config={null}
      />
    );

    await waitFor(() => expect(listPartialResolutions).toHaveBeenCalled());
    expect(screen.getByText('Utrecht Relay')).toBeInTheDocument();
    expect(screen.queryByText('Lisbon Relay')).not.toBeInTheDocument();
    expect(screen.queryByText('(ambiguous)')).not.toBeInTheDocument();
    const note = screen.getByTestId('hop-ignored-matches');
    expect(note).toHaveTextContent('1 other match ignored: too far away for this hop');
    expect(note).toHaveAttribute('title', 'Lisbon Relay');
  });
});
