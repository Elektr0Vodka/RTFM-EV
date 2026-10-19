import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import { RichPayloadProvider } from '../contexts/RichPayloadContext';
import { PathHopWidthProvider } from '../contexts/PathHopWidthContext';
import type { Message } from '../types';

function channelMessage(text: string): Message {
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

describe('MessageList MeshCore SAR markers', () => {
  it('renders an S: marker as a location card', () => {
    const onCoordinateClick = vi.fn();
    render(
      <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
        <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
          <MessageList
            messages={[channelMessage('Alice: S:🔥:1:52.1,5.2:smoke')]}
            contacts={[]}
            loading={false}
            onCoordinateClick={onCoordinateClick}
          />
        </PathHopWidthProvider>
      </RichPayloadProvider>
    );

    const button = screen.getByRole('button', { name: /show on map/i });
    expect(button).toHaveTextContent('🔥 smoke');
    fireEvent.click(button);
    expect(onCoordinateClick).toHaveBeenCalledWith(52.1, 5.2, '🔥 smoke');
  });
});
