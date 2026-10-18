import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  NodeMapPopup,
  advertRateText,
  compassBearing,
  relativeAge,
  type NodeMapPopupProps,
} from '../../map/NodeMapPopup';
import { translate, type Catalog } from '../../i18n';
import en from '../../i18n/locales/en.json';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Contact,
} from '../../types';

vi.mock('../../components/TelemetryPopupChart', () => ({
  TelemetryPopupChart: ({ publicKey }: { publicKey: string }) => <div>chart:{publicKey}</div>,
}));

const t = (key: string, params?: Record<string, string | number>) =>
  translate({ en: en as Catalog, nl: {}, de: {} }, 'en', key, params);

const NOW = 1_800_000_000;

const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'abcdef0123456789',
  name: 'Node',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: 52.9,
  lon: 4.75,
  last_seen: NOW - 240,
  on_radio: false,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

function renderPopup(over: Partial<NodeMapPopupProps>) {
  const props: NodeMapPopupProps = {
    t,
    contact: contact({}),
    nowSec: NOW,
    roleColor: '#3b82f6',
    selfLatLon: null,
    distanceUnit: 'metric',
    coordinateFormat: 'decimal',
    linkCount: null,
    triangulateUrl: null,
    ...over,
  };
  return render(<NodeMapPopup {...props} />);
}

describe('NodeMapPopup helpers', () => {
  it('shows the advert rate per hour, or per day below 1/h', () => {
    expect(advertRateText(2.345, t)).toBe('~2.3 per hour');
    expect(advertRateText(12.6, t)).toBe('~13 per hour');
    expect(advertRateText(0.04, t)).toBe('~1.0 per day');
    expect(advertRateText(0.5, t)).toBe('~12 per day');
  });

  it('formats relative ages', () => {
    expect(relativeAge(30, t)).toBe('just now');
    expect(relativeAge(240, t)).toBe('4 min ago');
    expect(relativeAge(3 * 3600, t)).toBe('3 h ago');
    expect(relativeAge(86400, t)).toBe('1 day ago');
    expect(relativeAge(3 * 86400, t)).toBe('3 days ago');
  });

  it('gives an 8-point compass direction', () => {
    expect(compassBearing(52, 5, 53, 5)).toBe('N');
    expect(compassBearing(52, 5, 51, 5)).toBe('S');
    expect(compassBearing(52, 5, 52, 6)).toBe('E');
    expect(compassBearing(52, 5, 52.5, 5.8)).toBe('NE');
    expect(compassBearing(52, 5, 51.5, 4.2)).toBe('SW');
  });
});

describe('NodeMapPopup', () => {
  it('repeater: power, battery bar, links, advert rate and distance', async () => {
    const loadAdvertRate = vi.fn().mockResolvedValue(2.345);
    const { container } = renderPopup({
      contact: contact({
        type: CONTACT_TYPE_REPEATER,
        name: 'NL-DHR-SOLAR',
        power_source: 'solar_battery',
        favorite: true,
        effective_route: { path: '', path_len: 0, path_hash_mode: 0 },
        effective_route_source: 'direct',
      }),
      telemetry: {
        timestamp: NOW - 600,
        battery_volts: 4.0,
        temperature: 14.24,
        source: 'repeater',
      },
      selfLatLon: [52.88, 4.71],
      linkCount: 7,
      loadAdvertRate,
    });
    expect(container.querySelector('[data-node-popup="2"]')).not.toBeNull();
    expect(screen.getByText('Repeater')).toBeInTheDocument();
    expect(screen.getByText('heard 4 min ago')).toBeInTheDocument();
    expect(screen.getByText('Direct neighbour')).toBeInTheDocument();
    expect(screen.getByText(/km NE$/)).toBeInTheDocument();
    expect(screen.getByText('Reported location')).toBeInTheDocument();
    expect(screen.getByText('Solar + battery')).toBeInTheDocument();
    expect(screen.getByText(/% · 4\.00 V$/)).toBeInTheDocument();
    expect(screen.getByText('14.2 °C')).toBeInTheDocument();
    expect(screen.getByText('7 nodes')).toBeInTheDocument();
    expect(screen.getByLabelText('Favourite')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('~2.3 per hour')).toBeInTheDocument());
    expect(loadAdvertRate).toHaveBeenCalledTimes(1);
  });

  it('aborts the advert-rate fetch on unmount', () => {
    let signal: AbortSignal | undefined;
    const { unmount } = renderPopup({
      loadAdvertRate: (s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('companion: last DM, route source, manual location and Message action', () => {
    const onOpenChat = vi.fn();
    renderPopup({
      contact: contact({
        lat: null,
        lon: null,
        manual_lat: 52.8,
        manual_lon: 4.8,
        last_contacted: NOW - 2 * 3600,
        effective_route: { path: 'aabb', path_len: 2, path_hash_mode: 0 },
        effective_route_source: 'override',
      }),
      onOpenChat,
    });
    expect(screen.getByText('2 hops')).toBeInTheDocument();
    expect(screen.getByText('Manual location')).toBeInTheDocument();
    expect(screen.getByText('2 h ago')).toBeInTheDocument();
    expect(screen.getByText('Set by you')).toBeInTheDocument();
    expect(screen.queryByText('Links on map')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('room server: last visited, mains without battery, Open room action', () => {
    renderPopup({
      contact: contact({ type: CONTACT_TYPE_ROOM, power_source: 'mains', last_read_at: null }),
      linkCount: 3,
      onOpenChat: vi.fn(),
    });
    expect(screen.getByText('Last visited')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Mains')).toBeInTheDocument();
    expect(screen.getByText('no battery data')).toBeInTheDocument();
    expect(screen.getByText('3 nodes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open room' })).toBeInTheDocument();
    expect(screen.getByText('Flood route')).toBeInTheDocument();
  });

  it('sensor: reading tiles and a history toggle', () => {
    renderPopup({
      contact: contact({ type: CONTACT_TYPE_SENSOR, public_key: 'feed' }),
      telemetry: {
        timestamp: NOW - 720,
        battery_volts: 4.02,
        temperature: 21.4,
        source: 'contact',
      },
      onOpenChat: vi.fn(),
    });
    expect(screen.getByText('21.4 °C')).toBeInTheDocument();
    expect(screen.getByText('4.02 V')).toBeInTheDocument();
    expect(screen.getByText(/Reading 12 min ago/)).toBeInTheDocument();
    // No Message / Open room for a sensor.
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    expect(screen.getByText('chart:feed')).toBeInTheDocument();
  });

  it('leaves out the power row when neither source nor battery is known', () => {
    renderPopup({ contact: contact({ type: CONTACT_TYPE_REPEATER, name: 'Plain' }) });
    expect(screen.queryByText('Unknown')).toBeNull();
    expect(screen.queryByText('no battery data')).toBeNull();
  });

  it('colours the recency dot and icon ring with the drawn palette', () => {
    const { container } = renderPopup({
      contact: contact({ last_seen: NOW - 240 }),
      roleColor: '#123456',
      recencyColors: { recent: '#010203', today: '#040506', stale: '#070809', old: '#0a0b0c' },
    });
    const dot = container.querySelector<HTMLElement>('span.rounded-full[style]');
    expect(dot?.style.backgroundColor).toBe('rgb(1, 2, 3)');
    const ring = container.querySelector<HTMLElement>('div.border-2[style]');
    expect(ring?.style.borderColor).toBe('rgb(18, 52, 86)');
  });

  it('sensor without telemetry says so', () => {
    renderPopup({ contact: contact({ type: CONTACT_TYPE_SENSOR }) });
    expect(screen.getByText('No readings yet')).toBeInTheDocument();
  });

  it('dims telemetry values older than a day', () => {
    const at = (ageSec: number) =>
      renderPopup({
        contact: contact({ type: CONTACT_TYPE_REPEATER, power_source: 'battery' }),
        telemetry: { timestamp: NOW - ageSec, battery_volts: 4.1, source: 'repeater' },
      });
    const { unmount } = at(3600);
    expect(screen.getByText(/% · 4\.10 V$/)).not.toHaveClass('opacity-60');
    unmount();
    at(2 * 86400);
    expect(screen.getByText(/% · 4\.10 V$/)).toHaveClass('opacity-60');
    expect(screen.getByText(/Reading 2 days ago/)).toBeInTheDocument();
  });

  it('never-heard node and triangulate link', () => {
    renderPopup({
      contact: contact({ last_seen: null }),
      triangulateUrl: 'https://example.test/x',
    });
    expect(screen.getByText('Never heard by this server')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Triangulate' })).toHaveAttribute(
      'href',
      'https://example.test/x'
    );
  });

  it('orbit and flyover buttons call their handlers, and hide when omitted', () => {
    const onOrbit = vi.fn();
    const onFlyover = vi.fn();
    const { unmount } = renderPopup({ onOrbit, onFlyover });
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flyover' }));
    expect(onOrbit).toHaveBeenCalledTimes(1);
    expect(onFlyover).toHaveBeenCalledTimes(1);
    unmount();
    renderPopup({});
    expect(screen.queryByRole('button', { name: 'Orbit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flyover' })).toBeNull();
  });
});
