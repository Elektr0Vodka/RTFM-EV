import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  api: {
    getLinkSummary: vi.fn(),
    getLinkTimeseries: vi.fn(),
    getLinkPackets: vi.fn(),
    getPacket: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));

import { I18nProvider } from '../i18n/I18nProvider';
import { LinkDetailView } from '../components/LinkDetailView';

const summary = (involvesSelf: boolean) => ({
  a: { pubkey: 'aa', name: 'Alpha', kind: 'contact', lat: 52, lon: 5 },
  b: { pubkey: 'bb', name: 'Bravo', kind: involvesSelf ? 'self' : 'contact', lat: 52.1, lon: 5 },
  distance_km: 11.1,
  involves_self: involvesSelf,
  total_packets: 3,
  first_seen: 100,
  last_seen: 200,
  by_hop_width: { '1': 3 },
  by_confidence: { unique: 3 },
  by_payload_type: { GROUP_TEXT: 3 },
});

function renderView() {
  return render(
    <I18nProvider>
      <LinkDetailView a="aa" b="bb" channels={[]} onBack={() => {}} />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getLinkTimeseries.mockResolvedValue({ bucket_seconds: 86400, traffic: [], signal: [] });
  mocks.api.getLinkPackets.mockResolvedValue([
    {
      raw_packet_id: 9,
      ts: 200,
      payload_type: 'GROUP_TEXT',
      route_type: 'Flood',
      hop_width: 1,
      confidence: 'unique',
      snr: null,
      rssi: null,
    },
  ]);
});

describe('LinkDetailView', () => {
  it('renders summary and explains missing signal', async () => {
    mocks.api.getLinkSummary.mockResolvedValue(summary(false));
    renderView();
    expect(await screen.findByText('Link Alpha ↔ Bravo')).toBeInTheDocument();
    expect(
      screen.getByText('Signal is only measured on links to your own node.')
    ).toBeInTheDocument();
    expect(mocks.api.getLinkSummary).toHaveBeenCalledWith(
      'aa',
      'bb',
      { since: null, until: null },
      expect.anything()
    );
  });

  it('opens the packet modal from a row', async () => {
    mocks.api.getLinkSummary.mockResolvedValue(summary(true));
    mocks.api.getPacket.mockResolvedValue({
      id: 9,
      timestamp: 200,
      data: '15',
      payload_type: 'GROUP_TEXT',
      snr: null,
      rssi: null,
      decrypted: false,
      decrypted_info: null,
    });
    renderView();
    fireEvent.click(await screen.findByTestId('link-packet-9'));
    await waitFor(() => expect(mocks.api.getPacket).toHaveBeenCalledWith(9));
  });
});
