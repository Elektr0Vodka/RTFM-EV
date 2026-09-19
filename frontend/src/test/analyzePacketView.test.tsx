import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalyzePacketView } from '../components/AnalyzePacketView';
import type { Channel } from '../types';

const GROUP_TEXT_PACKET_HEX =
  '1500E69C7A89DD0AF6A2D69F5823B88F9720731E4B887C56932BF889255D8D926D99195927144323A42DD8A158F878B518B8304DF55E80501C7D02A9FFD578D3518283156BBA257BF8413E80A237393B2E4149BBBC864371140A9BBC4E23EB9BF203EF0D029214B3E3AAC3C0295690ACDB89A28619E7E5F22C83E16073AD679D25FA904D07E5ACF1DB5A7C77D7E1719FB9AE5BF55541EE0D7F59ED890E12CF0FEED6700818';

const TEST_CHANNEL: Channel = {
  key: '7ABA109EDCF304A84433CB71D0F3AB73',
  name: '#six77',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

describe('AnalyzePacketView', () => {
  it('inspects a pasted raw packet inline', () => {
    render(<AnalyzePacketView channels={[TEST_CHANNEL]} />);

    expect(screen.getByRole('heading', { name: 'Analyze Packet' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Packet Hex'), {
      target: { value: GROUP_TEXT_PACKET_HEX },
    });

    expect(screen.getByText('Full packet hex')).toBeInTheDocument();
    expect(screen.getByText('Packet fields')).toBeInTheDocument();
    expect(screen.getByText('Payload fields')).toBeInTheDocument();
  });
});
