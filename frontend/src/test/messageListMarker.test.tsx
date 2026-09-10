import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import { RichPayloadProvider } from '../contexts/RichPayloadContext';
import { PathHopWidthProvider } from '../contexts/PathHopWidthContext';
import type { Message } from '../types';

function markerMessage(text: string): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'chan1',
    text,
    sender_timestamp: 1000,
    received_at: 1000,
    paths: [],
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Alice',
    packet_id: null,
    region: null,
  };
}

function renderList(onCoordinateClick: (lat: number, lon: number, label: string) => void) {
  return render(
    <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
      <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
        <MessageList
          messages={[markerMessage('Alice: m:52.123456,4.123456|Home|poi')]}
          contacts={[]}
          loading={false}
          onCoordinateClick={onCoordinateClick}
        />
      </PathHopWidthProvider>
    </RichPayloadProvider>
  );
}

describe('MessageList location card', () => {
  it('renders a clickable location card and calls onCoordinateClick', () => {
    const onCoordinateClick = vi.fn();
    renderList(onCoordinateClick);
    const button = screen.getByRole('button', { name: /show on map/i });
    expect(button).toHaveTextContent('Home');
    fireEvent.click(button);
    expect(onCoordinateClick).toHaveBeenCalledWith(52.123456, 4.123456, 'Home');
  });
});
