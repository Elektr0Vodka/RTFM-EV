import { describe, it, expect, vi } from 'vitest';
import {
  buildPinImage,
  buildSharedLocationAreas,
  buildSharedLocationFeatures,
  sharedLocationTitle,
} from '../../map/layers/sharedLocationsLayer';
import { buildSharedLocationPopup } from '../../map/useSharedLocations';
import { CONTACT_TYPE_CLIENT, type Contact, type SharedLocation } from '../../types';

const loc = (over: Partial<SharedLocation> = {}): SharedLocation => ({
  message_id: 7,
  type: 'CHAN',
  conversation_key: 'AB'.repeat(16),
  conversation_name: '#dmc',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: 1_789_999_998,
  lat: 52.0907,
  lon: 5.1214,
  format: 'decimal',
  raw: '52.090700, 5.121400',
  label: '',
  flags: '',
  precision_m: null,
  paths: null,
  ...over,
});

const contact = (publicKey: string): Contact => ({
  public_key: publicKey,
  name: 'Alice node',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
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
});

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

describe('sharedLocationsLayer builders', () => {
  it('maps shares to [lon, lat] points with title and poi flag', () => {
    const fc = buildSharedLocationFeatures([
      loc(),
      loc({ message_id: 8, format: 'marker', label: 'Dom', flags: 'poi' }),
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([5.1214, 52.0907]);
    expect(fc.features[0].properties).toMatchObject({ message_id: 7, title: 'Alice', poi: false });
    expect(fc.features[1].properties).toMatchObject({ message_id: 8, title: 'Dom', poi: true });
  });

  it('titles an incoming DM share with the contact name', () => {
    expect(
      sharedLocationTitle(loc({ type: 'PRIV', sender_name: null, conversation_name: 'Bob node' }))
    ).toBe('Bob node');
  });

  it('titles our own shares with our node name', () => {
    expect(sharedLocationTitle(loc({ outgoing: true, sender_name: null }), 'My node')).toBe(
      'My node'
    );
  });

  it('outlines only MGRS grid squares of 10 m or more', () => {
    const areas = buildSharedLocationAreas([
      loc({ format: 'mgrs', precision_m: 1 }),
      loc({ message_id: 9, format: 'mgrs', precision_m: 1000 }),
      loc({ message_id: 10 }),
    ]);
    expect(areas.features).toHaveLength(1);
    expect(areas.features[0].properties.message_id).toBe(9);
    const ring = areas.features[0].geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    // ~1 km tall: 1000 m / 111320 m per degree.
    expect(ring[2][1] - ring[0][1]).toBeCloseTo(1000 / 111_320, 6);
  });
});

describe('buildPinImage', () => {
  const alphaAt = (img: ReturnType<typeof buildPinImage>, x: number, y: number) =>
    img.data[(y * img.width + x) * 4 + 3];
  const rgbAt = (img: ReturnType<typeof buildPinImage>, x: number, y: number) =>
    Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

  it('draws a 2x teardrop: opaque head and tip, transparent corners', () => {
    const img = buildPinImage('#e11d48');
    expect(img.width).toBe(48);
    expect(img.height).toBe(64);
    expect(img.data).toHaveLength(48 * 64 * 4);
    expect(alphaAt(img, 0, 0)).toBe(0);
    expect(alphaAt(img, 47, 63)).toBe(0);
    // Fill colour between the centre dot and the rim.
    expect(alphaAt(img, 24, 32)).toBe(255);
    expect(rgbAt(img, 24, 32)).toEqual([0xe1, 0x1d, 0x48]);
    // White centre dot.
    expect(rgbAt(img, 24, 22)).toEqual([255, 255, 255]);
    // The tail reaches the bottom centre.
    expect(alphaAt(img, 24, 58)).toBeGreaterThan(0);
  });
});

describe('buildSharedLocationPopup', () => {
  const baseDeps = {
    t,
    contacts: [] as Contact[],
    config: null,
    distanceUnit: 'metric' as const,
    coordinateFormat: 'decimal' as const,
  };

  it('shows sender, conversation and coordinates in the chosen format', () => {
    const el = buildSharedLocationPopup(loc(), { ...baseDeps, coordinateFormat: 'mgrs' });
    const text = el.textContent ?? '';
    expect(text).toContain('map_shared_locations_from {"sender":"Alice"}');
    expect(text).toContain('map_shared_locations_in_channel {"name":"#dmc"}');
    expect(text).toContain('31U FT 45332 73249');
    expect(text).toContain('map_shared_locations_format_decimal');
  });

  it('shows the original MGRS text and grid size', () => {
    const el = buildSharedLocationPopup(
      loc({ format: 'mgrs', raw: '31U FT 4533 7324', precision_m: 10 }),
      baseDeps
    );
    const text = el.textContent ?? '';
    expect(text).toContain('map_shared_locations_as_sent {"text":"31U FT 4533 7324"}');
    expect(text).toContain('map_shared_locations_grid_square {"size":"10 m"}');
  });

  it('opens the message in chat and closes the popup', () => {
    const onNavigateToMessage = vi.fn();
    const onAction = vi.fn();
    const el = buildSharedLocationPopup(loc({ type: 'PRIV', conversation_key: 'cc'.repeat(32) }), {
      ...baseDeps,
      onNavigateToMessage,
      onAction,
    });
    const button = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'map_shared_locations_open_in_chat'
    );
    expect(button?.type).toBe('button');
    button!.click();
    expect(onNavigateToMessage).toHaveBeenCalledWith({
      id: 7,
      type: 'PRIV',
      conversation_key: 'cc'.repeat(32),
      conversation_name: '#dmc',
    });
    expect(onAction).toHaveBeenCalled();
  });

  it('links to the sender contact only when it is a known contact', () => {
    const key = 'dd'.repeat(32);
    const onOpenContactInfo = vi.fn();
    const known = buildSharedLocationPopup(loc({ sender_key: key }), {
      ...baseDeps,
      contacts: [contact(key)],
      onOpenContactInfo,
    });
    const details = Array.from(known.querySelectorAll('button')).find(
      (b) => b.textContent === 'map_node_details'
    );
    details!.click();
    expect(onOpenContactInfo).toHaveBeenCalledWith(key);

    const unknown = buildSharedLocationPopup(loc({ sender_key: key }), {
      ...baseDeps,
      onOpenContactInfo,
    });
    expect(
      Array.from(unknown.querySelectorAll('button')).some(
        (b) => b.textContent === 'map_node_details'
      )
    ).toBe(false);
  });

  it('shows distance from our node and the hop count', () => {
    const el = buildSharedLocationPopup(
      loc({ paths: [{ path: 'aabb', received_at: 1, path_len: 2 }] }),
      {
        ...baseDeps,
        config: { name: 'Me', lat: 52.0, lon: 5.1214 } as never,
      }
    );
    const text = el.textContent ?? '';
    expect(text).toContain('map_shared_locations_distance');
    expect(text).toContain('map_shared_locations_hops {"count":2}');
  });
});
