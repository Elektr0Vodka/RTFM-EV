import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PathModal } from '../components/PathModal';
import type { Contact, PartialNodeResolution } from '../types';

const { listPartialResolutions } = vi.hoisted(() => ({ listPartialResolutions: vi.fn() }));

vi.mock('../api', () => ({ api: { listPartialResolutions } }));

function repeater(publicKey: string, name: string): Contact {
  return {
    public_key: publicKey,
    name,
    type: 2,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

function link(prefix: string, name: string): PartialNodeResolution {
  return {
    prefix_hex: prefix,
    resolved_pubkey: `${prefix}${'0'.repeat(64 - prefix.length)}`,
    resolved_name: name,
    source: 'external_map',
    confidence: 0.7,
    candidate_count: 2,
    resolved_by: 'user',
    created_at: null,
    updated_at: null,
  };
}

function renderModal(contacts: Contact[]) {
  render(
    <PathModal
      open
      onClose={vi.fn()}
      paths={[{ path: '4532', received_at: 1_700_000_000, path_len: 2 }]}
      senderInfo={{ name: 'Sender', publicKeyOrPrefix: 'aabbccddeeff', lat: null, lon: null }}
      contacts={contacts}
      config={null}
    />
  );
}

describe('PathModal soft links (plan 16)', () => {
  beforeEach(() => {
    listPartialResolutions.mockReset();
  });

  it('names unknown and ambiguous hops the user linked', async () => {
    listPartialResolutions.mockResolvedValue([link('45', 'Far Relay'), link('32', 'Relay B')]);
    renderModal([
      repeater(`32aa${'0'.repeat(60)}`, 'Relay A'),
      repeater(`32bb${'0'.repeat(60)}`, 'Relay B'),
    ]);

    await waitFor(() => expect(screen.getAllByTestId('hop-soft-link')).toHaveLength(2));
    expect(screen.getByText('Linked to Far Relay (soft link)')).toBeInTheDocument();
    expect(screen.getByText('Linked to Relay B (soft link)')).toBeInTheDocument();
    // The unknown hop no longer reads <UNKNOWN>; the ambiguous one still lists its matches.
    expect(screen.queryByText('<UNKNOWN>')).not.toBeInTheDocument();
    expect(screen.getByText('Relay A')).toBeInTheDocument();
  });

  it('keeps the prefix-only display without links', async () => {
    listPartialResolutions.mockResolvedValue([]);
    renderModal([]);
    await waitFor(() => expect(listPartialResolutions).toHaveBeenCalled());
    expect(screen.getAllByText('<UNKNOWN>')).toHaveLength(2);
    expect(screen.queryByTestId('hop-soft-link')).not.toBeInTheDocument();
  });
});
