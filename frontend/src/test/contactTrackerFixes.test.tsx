import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { api } from '../api';
import { ContactTrackerFixesSection } from '../components/ContactInfoBody';
import type { TrackerPosition, TrackersResponse } from '../types';

const RESCUE = 'a1b2c3d4e5f6' + '00'.repeat(26);

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const fix = (at: number): TrackerPosition => ({
  id: at,
  source: 'sar_fast_gps',
  identity: 'a1b2c3d4e5f6',
  display_name: 'Rescue 1',
  team: null,
  lat: 52.098,
  lon: 5.105,
  alt_m: null,
  speed_mps: 10,
  course_deg: null,
  battery_pct: null,
  cot_uid: null,
  channel_key: null,
  packet_id: null,
  path_len: 1,
  received_at: at,
});

const respond = (positions: TrackerPosition[]): TrackersResponse => ({
  positions,
  objects: [],
  truncated: false,
  counts: {},
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ContactTrackerFixesSection', () => {
  it("asks for this contact's MeshCore SAR fixes by key prefix", async () => {
    const getTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(respond([fix(2)]));
    render(<ContactTrackerFixesSection publicKey={RESCUE} t={t} />);
    await screen.findByTestId('contact-tracker-fixes');
    expect(getTrackers.mock.calls[0][0]).toEqual({
      since: expect.any(Number),
      identity: 'a1b2c3d4e5f6',
      source: 'sar_fast_gps',
      latestPerIdentity: false,
    });
    expect(screen.getAllByTestId('contact-tracker-fix-row')).toHaveLength(1);
    expect(screen.getByText(/"kmh":"36.0"/)).toBeInTheDocument();
  });

  it('renders nothing without fixes', async () => {
    const getTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(respond([]));
    const { container } = render(<ContactTrackerFixesSection publicKey={RESCUE} t={t} />);
    await waitFor(() => expect(getTrackers).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows five fixes, then all on request', async () => {
    const fixes = Array.from({ length: 7 }, (_, i) => fix(100 - i));
    vi.spyOn(api, 'getTrackers').mockResolvedValue(respond(fixes));
    render(<ContactTrackerFixesSection publicKey={RESCUE} t={t} />);
    await screen.findByTestId('contact-tracker-fixes');
    expect(screen.getAllByTestId('contact-tracker-fix-row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /contact_beacons_show_all/ }));
    expect(screen.getAllByTestId('contact-tracker-fix-row')).toHaveLength(7);
  });
});
