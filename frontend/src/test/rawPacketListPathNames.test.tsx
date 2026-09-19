import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RawPacketList } from '../components/RawPacketList';
import type { Contact, RawPacket } from '../types';

// Control the decoded summary so we can assert path-hop name resolution without
// hand-crafting a valid MeshCore packet with a path.
vi.mock('../utils/rawPacketInspector', () => ({
  createDecoderOptions: () => ({}),
  decodePacketSummary: () => ({
    summary: 'summary',
    routeType: 'Flood',
    pathTokens: ['cd', 'ab'],
  }),
}));

const packet: RawPacket = {
  id: 1,
  timestamp: 1700000000,
  data: 'cdab',
  payload_type: 'ADVERT',
  snr: null,
  rssi: null,
  decrypted: false,
  decrypted_info: null,
};

const contact = (public_key: string, name: string | null): Contact =>
  ({ public_key, name }) as unknown as Contact;

describe('RawPacketList path-hop name resolution', () => {
  it('shows a contact name for a uniquely-matching hop prefix and raw hex otherwise', () => {
    const contacts = [
      contact('cd34ef0000', 'Bob'),
      contact('ab11110000', 'Alice'),
      contact('ab22220000', 'Alex'), // makes "ab" ambiguous
    ];

    render(<RawPacketList packets={[packet]} contacts={contacts} />);

    // "cd" uniquely matches Bob -> name shown (with the raw hex as a title).
    const bob = screen.getByText('Bob');
    expect(bob).toBeInTheDocument();
    expect(bob).toHaveAttribute('title', 'cd');

    // "ab" is ambiguous -> raw hex (uppercased) kept.
    expect(screen.getByText('AB')).toBeInTheDocument();
  });
});
