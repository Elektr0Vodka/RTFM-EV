import { cleanup, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PathModal, type MessageDetailsFields } from '../components/PathModal';
import type { MessagePath } from '../types';
import { formatOffsetDuration, pathHopCounts, senderClockOffset } from '../utils/messageDetails';

vi.mock('../api', () => ({ api: { listPartialResolutions: vi.fn().mockResolvedValue([]) } }));

const RECEIVED = 1_793_800_000;

function renderModal(message: MessageDetailsFields, paths: MessagePath[]) {
  render(
    <PathModal
      open
      onClose={vi.fn()}
      paths={paths}
      senderInfo={{ name: 'Sender', publicKeyOrPrefix: 'aabbccddeeff', lat: null, lon: null }}
      contacts={[]}
      config={null}
      message={message}
    />
  );
  return within(screen.getByRole('region', { name: 'Details' }));
}

const incoming: MessageDetailsFields = {
  sender_timestamp: RECEIVED - 5,
  received_at: RECEIVED,
  outgoing: false,
  transport_code: null,
  region: null,
};

describe('messageDetails helpers', () => {
  it('measures the sender clock against the receive time', () => {
    expect(senderClockOffset(RECEIVED + 3600, RECEIVED)).toBe(3600);
    expect(senderClockOffset(RECEIVED - 10, RECEIVED)).toBe(-10);
    expect(senderClockOffset(null, RECEIVED)).toBeNull();
    expect(senderClockOffset(0, RECEIVED)).toBeNull();
  });

  it('formats offsets compactly', () => {
    expect(formatOffsetDuration(2 * 86400 + 8 * 3600 + 11)).toBe('2d 8h');
    expect(formatOffsetDuration(-(3 * 3600 + 5 * 60))).toBe('3h 5m');
    expect(formatOffsetDuration(250)).toBe('4m 10s');
    expect(formatOffsetDuration(45)).toBe('45s');
    expect(formatOffsetDuration(86400)).toBe('1d');
  });

  it('collects distinct hop counts per path', () => {
    expect(
      pathHopCounts([
        { path: 'aabbccddeeff0011aabb', received_at: 1, path_len: 5 },
        { path: '', received_at: 1, path_len: 0 },
        { path: '1122334455667788aabb', received_at: 1, path_len: 5 },
      ])
    ).toEqual([0, 5]);
    expect(pathHopCounts(null)).toEqual([]);
  });
});

describe('PathModal details', () => {
  it('shows hops, path hash size and region for an incoming message', () => {
    const details = renderModal({ ...incoming, region: 'nl', transport_code: 0x1234 }, [
      { path: 'aabbccddeeff0011aabb', received_at: RECEIVED, path_len: 5 },
    ]);
    expect(details.getByText('Hops:').nextSibling?.textContent).toBe('5');
    expect(details.getByText('Path hash:').nextSibling?.textContent).toBe('2 bytes');
    expect(details.getByText('Region:').nextSibling?.textContent).toBe('nl');
    expect(details.getByText('Sent:')).toBeTruthy();
    expect(details.getByText('Received:')).toBeTruthy();
    // A few seconds of flood delay is not called out.
    expect(details.queryByText(/ahead|before it was received/)).toBeNull();
  });

  it('flags a sender clock that is ahead of the receive time', () => {
    const details = renderModal(
      { ...incoming, sender_timestamp: RECEIVED + 2 * 86400 + 8 * 3600 },
      [{ path: 'aabb', received_at: RECEIVED, path_len: 2 }]
    );
    expect(details.getByText('(sender clock 2d 8h ahead)')).toBeTruthy();
  });

  it('notes a stamp well before the receive time', () => {
    const details = renderModal({ ...incoming, sender_timestamp: RECEIVED - 3 * 3600 }, [
      { path: 'aabb', received_at: RECEIVED, path_len: 2 },
    ]);
    expect(details.getByText('(3h before it was received)')).toBeTruthy();
  });

  it('labels direct, unscoped and unknown-scope messages', () => {
    let details = renderModal(incoming, [{ path: '', received_at: RECEIVED, path_len: 0 }]);
    expect(details.getByText('Hops:').nextSibling?.textContent).toBe('Direct');
    expect(details.getByText('Region:').nextSibling?.textContent).toBe('Unscoped');
    expect(details.queryByText('Path hash:')).toBeNull();
    cleanup();
    details = renderModal({ ...incoming, transport_code: 0xbeef }, [
      { path: 'aa', received_at: RECEIVED, path_len: 1 },
    ]);
    expect(details.getByText('Region:').nextSibling?.textContent).toBe('Scoped (0xBEEF)');
  });

  it('shows only the send time for an outgoing message without echoes', () => {
    const details = renderModal(
      { ...incoming, outgoing: true, sender_timestamp: RECEIVED, region: 'nl' },
      []
    );
    expect(details.getByText('Sent:')).toBeTruthy();
    expect(details.queryByText('Received:')).toBeNull();
    expect(details.queryByText('Hops:')).toBeNull();
    expect(details.queryByText('Region:')).toBeNull();
  });
});
