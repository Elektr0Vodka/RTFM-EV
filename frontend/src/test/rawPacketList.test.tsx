import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RawPacketList } from '../components/RawPacketList';
import type { RawPacket } from '../types';

function createPacket(overrides: Partial<RawPacket> = {}): RawPacket {
  return {
    id: 1,
    timestamp: 1700000000,
    data: '000000000000',
    payload_type: 'REQ',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
    ...overrides,
  };
}

describe('RawPacketList', () => {
  it('renders TF badge for transport-flood packets', () => {
    render(<RawPacketList packets={[createPacket()]} />);

    expect(screen.getByText('TF')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks plaintext third-party packets as not encrypted', () => {
    const fuota = createPacket({
      id: 3,
      data: '3a0001abdeadbeefc4000038000001000000050000001122334455667788047f',
    });
    const groupText = createPacket({ id: 4, data: '1500e69c7a89' });
    render(<RawPacketList packets={[fuota, groupText]} />);
    expect(screen.getAllByText('Not encrypted')).toHaveLength(1);
    expect(screen.getAllByText('Encrypted')).toHaveLength(1);
  });

  it('makes packet cards clickable only when an inspector handler is provided', () => {
    const packet = createPacket({ id: 9, observation_id: 22 });
    const onPacketClick = vi.fn();

    render(<RawPacketList packets={[packet]} onPacketClick={onPacketClick} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onPacketClick).toHaveBeenCalledWith(packet);
  });

  it('orders oldest-first by default and newest-first when newestFirst is set', () => {
    const packets = [
      createPacket({ id: 1, timestamp: 100, data: 'aaaaaaaaaaaa' }),
      createPacket({ id: 2, timestamp: 200, data: 'bbbbbbbbbbbb' }),
    ];

    const { rerender } = render(<RawPacketList packets={packets} />);
    let older = screen.getByText('AAAAAAAAAAAA');
    let newer = screen.getByText('BBBBBBBBBBBB');
    // Oldest first: the older packet precedes the newer one in the document.
    expect(older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<RawPacketList packets={packets} newestFirst />);
    older = screen.getByText('AAAAAAAAAAAA');
    newer = screen.getByText('BBBBBBBBBBBB');
    // Newest first: the newer packet now precedes the older one.
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('autoscrolls to the top (newest) when newestFirst is on', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    try {
      const { container, rerender } = render(
        <RawPacketList packets={[createPacket({ id: 1 })]} autoScroll newestFirst />
      );
      const list = container.querySelector('.overflow-y-auto') as HTMLElement;
      list.scrollTop = 300;

      rerender(
        <RawPacketList
          packets={[createPacket({ id: 1 }), createPacket({ id: 2 })]}
          autoScroll
          newestFirst
        />
      );
      expect(list.scrollTop).toBe(0);
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('renders no scroll-to-end buttons unless showScrollToEnds is set', () => {
    render(<RawPacketList packets={[createPacket()]} />);
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();
  });

  it('shows scroll-to-end buttons only on overflow and scrolls to each end', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });
    try {
      const { container } = render(
        <RawPacketList
          packets={[createPacket({ id: 1 }), createPacket({ id: 2 })]}
          autoScroll={false}
          showScrollToEnds
        />
      );
      const list = container.querySelector('.overflow-y-auto') as HTMLElement;

      // At the top, only "scroll to bottom" is offered.
      expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
      expect(list.scrollTop).toBe(1000);

      // Scrolled into the middle: both ends become reachable.
      list.scrollTop = 500;
      fireEvent.scroll(list);
      expect(screen.getByRole('button', { name: 'Scroll to top' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Scroll to top' }));
      expect(list.scrollTop).toBe(0);
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  it('folds same-content packets into one row with a copy count when groupByContent is set', () => {
    const packets = [
      createPacket({ id: 1, observation_id: 1, timestamp: 100, data: 'aaaa' }),
      createPacket({ id: 2, observation_id: 2, timestamp: 200, data: 'aaaa' }),
      createPacket({ id: 3, observation_id: 3, timestamp: 150, data: 'bbbb' }),
    ];

    render(<RawPacketList packets={packets} groupByContent />);

    // The two 'aaaa' copies collapse into a single row...
    expect(screen.getAllByText('AAAA')).toHaveLength(1);
    expect(screen.getByText('BBBB')).toBeInTheDocument();
    // ...carrying a "heard twice" copy badge; the singleton has none.
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.queryByText('×1')).not.toBeInTheDocument();
  });

  it('does not fold packets when groupByContent is off (default)', () => {
    const packets = [
      createPacket({ id: 1, observation_id: 1, data: 'aaaa' }),
      createPacket({ id: 2, observation_id: 2, data: 'aaaa' }),
    ];

    render(<RawPacketList packets={packets} />);

    expect(screen.getAllByText('AAAA')).toHaveLength(2);
    expect(screen.queryByText('×2')).not.toBeInTheDocument();
  });

  it('renders a selection checkbox per row and toggles selection when selectable', () => {
    const onToggleSelect = vi.fn();
    const packets = [
      createPacket({ id: 1, observation_id: 11 }),
      createPacket({ id: 2, observation_id: 22 }),
    ];
    render(
      <RawPacketList
        packets={packets}
        selectable
        selectedKeys={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );
    const boxes = screen.getAllByRole('checkbox', { name: 'Select packet for export' });
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(onToggleSelect).toHaveBeenCalledWith(packets[0]);
  });

  it('renders no selection checkboxes unless selectable', () => {
    render(<RawPacketList packets={[createPacket()]} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('holds the viewed packets in place on prepend in newest-first when autoScroll is off', () => {
    let scrollHeight = 500;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    try {
      const { container, rerender } = render(
        <RawPacketList packets={[createPacket({ id: 1 })]} autoScroll={false} newestFirst />
      );
      const list = container.querySelector('.overflow-y-auto') as HTMLElement;
      // User is 100px down from the newest (top) packet, reading older rows.
      list.scrollTop = 100;

      // A new packet arrives and is prepended at the top, growing the list 80px.
      scrollHeight = 580;
      rerender(
        <RawPacketList
          packets={[createPacket({ id: 1 }), createPacket({ id: 2 })]}
          autoScroll={false}
          newestFirst
        />
      );

      // scrollTop is compensated by the +80 delta so the same rows stay in view
      // instead of the newest packet shoving them down.
      expect(list.scrollTop).toBe(180);
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('sticks to the bottom on new packets when autoScroll is on, and holds when off', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    try {
      const { container, rerender } = render(
        <RawPacketList packets={[createPacket({ id: 1 })]} autoScroll />
      );
      const list = container.querySelector('.overflow-y-auto') as HTMLElement;

      rerender(
        <RawPacketList packets={[createPacket({ id: 1 }), createPacket({ id: 2 })]} autoScroll />
      );
      expect(list.scrollTop).toBe(500);

      // Pause autoscroll, simulate the user scrolling up, then receive a packet.
      list.scrollTop = 0;
      rerender(
        <RawPacketList
          packets={[createPacket({ id: 1 }), createPacket({ id: 2 }), createPacket({ id: 3 })]}
          autoScroll={false}
        />
      );
      expect(list.scrollTop).toBe(0);
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });
});

describe('RawPacketList policy verdict', () => {
  it('shows the deciding drop rule in red under the date and time', () => {
    const rule = 'rtfm-spam:text:7440749b06 (yours)';
    render(<RawPacketList packets={[createPacket({ policy: { action: 'drop', rule } })]} />);

    const line = screen.getByTestId('packet-policy');
    expect(line).toHaveTextContent(`Drop rule ${rule}`);
    expect(line.className).toContain('text-destructive');
    // The live feed stamps each packet with date and time (14 Nov 2023 UTC).
    expect(screen.getByText(/2023.*\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('shows an allow or log only rule without the red', () => {
    render(
      <RawPacketList
        packets={[
          createPacket({ id: 1, policy: { action: 'allow', rule: 'let adverts through' } }),
          createPacket({ id: 2, policy: { action: 'log_only', rule: 'watch traces' } }),
        ]}
      />
    );
    const lines = screen.getAllByTestId('packet-policy');
    expect(lines.map((line) => line.textContent)).toEqual([
      'Allow rule let adverts through',
      'Log only rule watch traces',
    ]);
    expect(lines.every((line) => !line.className.includes('text-destructive'))).toBe(true);
  });

  it('names the default action when no rule did the dropping', () => {
    render(<RawPacketList packets={[createPacket({ policy: { action: 'drop', rule: null } })]} />);
    expect(screen.getByTestId('packet-policy')).toHaveTextContent('Dropped by the default action');
  });

  it('adds no line to a packet without a verdict', () => {
    render(<RawPacketList packets={[createPacket(), createPacket({ id: 2, policy: null })]} />);
    expect(screen.queryByTestId('packet-policy')).toBeNull();
  });
});
