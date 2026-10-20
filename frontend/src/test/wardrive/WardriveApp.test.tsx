import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { WardriveApp, type WardriveDeps } from '../../wardrive/WardriveApp';
import {
  WardriveApiError,
  wardriveApi,
  type WardriveConfig,
  type WardriveMe,
} from '../../wardrive/api';
import type { Fix } from '../../wardrive/messages';
import type { PositionSource } from '../../wardrive/position/sources';
import { DEFAULT_BROKERS, type Broker } from '../../wardrive/forward/brokers';
import type { MqttLike } from '../../wardrive/forward/client';
import { openQueue } from '../../wardrive/queue';
import { openNodeCache } from '../../wardrive/nodeSources';
import { hexToBytes } from '../../wardrive/packet';
import { Listeners, type RadioTransport } from '../../wardrive/radio/transport';
import { TEST_SECRET, groupTextFrame } from './decodeVectors';
import { contactFrame, contactsEndFrame, contactsStartFrame } from './radioFrames';
import { T0, drive, fakeApi } from './reports/fixtures';

// MapLibre does not run in jsdom; the live map is checked in a real browser.
// The stand-in shows how many receptions the page gives it.
vi.mock('../../wardrive/map/LiveMap', () => ({
  LiveMap: (p: {
    entries: unknown[];
    view: { mode: string; mode3D: boolean };
    compass: string;
    nodePos: string;
    exaggeration: number;
    nodes: unknown[];
    noiseOn?: boolean;
  }) => (
    <div
      data-testid="live-map"
      data-count={p.entries.length}
      data-view={`${p.view.mode}${p.view.mode3D ? '3d' : '2d'}`}
      data-compass={p.compass}
      data-nodepos={p.nodePos}
      data-exaggeration={p.exaggeration}
      data-nodes={p.nodes.length}
      data-noise={p.noiseOn ? 'on' : 'off'}
    />
  ),
}));

// The live log as the page renders it, recording the select handler it gets.
const logSelects: unknown[] = [];
vi.mock('../../wardrive/screen/ReceptionLog', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../wardrive/screen/ReceptionLog')>();
  return {
    ...real,
    ReceptionLog: (props: Parameters<typeof real.ReceptionLog>[0]) => {
      logSelects.push(props.onSelect);
      return real.ReceptionLog(props);
    },
  };
});

const KEY = 'AB'.repeat(32);
const OTHER = 'CD'.repeat(32);
let n = 0;

class FakeRadio implements RadioTransport {
  kind = 'ble' as const;
  frames = new Listeners<Uint8Array>();
  closes = new Listeners<void>();
  sent: number[] = [];
  /** RESP_CONTACT frames the radio answers GET_CONTACTS with. */
  contacts: Uint8Array[] = [];
  constructor(private key: string) {}
  async connect() {}
  async disconnect() {}
  async send(frame: Uint8Array) {
    this.sent.push(frame[0]);
    if (frame[0] === 0x04) {
      queueMicrotask(() => {
        this.frames.emit(contactsStartFrame(this.contacts.length));
        for (const c of this.contacts) this.frames.emit(c);
        this.frames.emit(contactsEndFrame());
      });
    } else if (frame[0] === 0x05) {
      // GET_DEVICE_TIME: the radio's clock, in step with the page's.
      const f = new Uint8Array(5);
      f[0] = 9;
      new DataView(f.buffer).setUint32(1, Math.floor(Date.now() / 1000), true);
      queueMicrotask(() => this.frames.emit(f));
    } else if (frame[0] === 0x01) {
      const b = new Uint8Array(61);
      b[0] = 0x05;
      for (let i = 0; i < 32; i++) b[4 + i] = parseInt(this.key.slice(i * 2, i * 2 + 2), 16);
      b.set(new TextEncoder().encode('Car'), 58);
      queueMicrotask(() => this.frames.emit(b));
    } else if (frame[0] === 33) {
      queueMicrotask(() => this.frames.emit(new Uint8Array([19, 0, 0, 4, 0, 0])));
    } else if (frame[0] === 34) {
      queueMicrotask(() => this.frames.emit(new Uint8Array([0])));
    } else if (frame[0] === 35) {
      const sig = new Uint8Array(65);
      sig[0] = 20;
      queueMicrotask(() => this.frames.emit(sig));
    } else if (frame[0] === 0x37) {
      // Discover (only with Auto-discover on): the radio answers OK.
      queueMicrotask(() => this.frames.emit(new Uint8Array([0])));
    } else if (frame[0] === 0x38) {
      // Stats: battery 3.7 V, noise -110 dBm.
      const f = new Uint8Array(frame[1] === 0 ? 11 : 14);
      f[0] = 24;
      f[1] = frame[1];
      new DataView(f.buffer).setInt16(2, frame[1] === 0 ? 3700 : -110, true);
      queueMicrotask(() => this.frames.emit(f));
    }
  }
  onFrame(cb: (f: Uint8Array) => void) {
    return this.frames.add(cb);
  }
  onClose(cb: () => void) {
    return this.closes.add(cb);
  }
  /** An RX log push; `rssi` is the signed byte (0xa6 = -90 dBm). */
  hear(rssi = 0xa6) {
    this.frames.emit(new Uint8Array([0x88, 0x10, rssi, 0x15, 0x02, 0xa1, 0xb2, 0xc0, 0xff]));
  }
  /** An RX log push of a raw frame given as hex, at -90 dBm. */
  hearRaw(hex: string, rssi = 0xa6) {
    this.frames.emit(new Uint8Array([0x88, 0x10, rssi, ...hexToBytes(hex)]));
  }
}

class FakePosition implements PositionSource {
  kind = 'device' as const;
  onFix: ((f: Fix) => void) | null = null;
  async start(onFix: (f: Fix) => void) {
    this.onFix = onFix;
    onFix({ lat: 52.1, lon: 5.1, accM: 5, at: Date.now() });
  }
  async stop() {}
}

function me(radios: string[]): WardriveMe {
  return {
    user_id: 1,
    username: 'mike',
    visibility: 'own',
    radios: radios.map((k) => ({ public_key: k, name: 'car' })),
  };
}

const published: { topic: string; payload: string }[] = [];
const mqtt: MqttLike = {
  publish: async (topic, payload) => {
    published.push({ topic, payload });
  },
  end: async () => {},
  onClose: () => {},
};

function setup(over: Partial<WardriveDeps> = {}) {
  const radio = new FakeRadio(KEY);
  const position = new FakePosition();
  const deps: WardriveDeps = {
    makeTransport: () => radio,
    makePosition: () => position,
    openQueue: () => openQueue(`app-${n++}`),
    openNodeCache: () => openNodeCache(`app-nodes-${n++}`),
    bleSupported: () => true,
    serialSupported: () => false,
    deviceLocationAllowed: () => true,
    connectMqtt: async () => mqtt,
    drivesApi: fakeApi([]),
    ...over,
  };
  render(
    <I18nProvider>
      <WardriveApp deps={deps} />
    </I18nProvider>
  );
  return { radio, position };
}

/** The live log's rows (each a button inside a list item). */
function logRows(): HTMLElement[] {
  const log = screen.getByRole('region', { name: 'Receptions' });
  return within(within(log).getByRole('list')).queryAllByRole('button');
}

/** The account, radio, position and forwarding panels live in the menu. */
async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
  await screen.findByRole('dialog');
}

async function closeMenu() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

const SERVED_ANALYZER: Broker = {
  id: 'meshcore-analyzer',
  name: 'meshcore-analyzer.eu',
  url: 'wss://mqtt.meshcore-analyzer.eu:443',
  audience: 'mqtt.meshcore-analyzer.eu',
  auth: 'companion',
  format: 'packets',
  region: 'nl',
  builtin: true,
};
const SERVED_CLUB: Broker = {
  id: 'club-mqtt',
  name: 'Club MQTT',
  url: 'wss://mqtt.example.org:8084/mqtt',
  audience: 'mqtt.example.org',
  auth: 'password',
  username: 'club',
  password: 's3cret-pass',
  format: 'packets',
  region: 'ams',
  builtin: false,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  published.length = 0;
  vi.spyOn(wardriveApi, 'upload').mockResolvedValue({
    accepted_obs: 0,
    duplicate_obs: 0,
    accepted_tracks: 0,
    duplicate_tracks: 0,
  });
  vi.spyOn(wardriveApi, 'config').mockResolvedValue({ hashtag_channels: ['#test'] });
  vi.spyOn(wardriveApi, 'nodes').mockResolvedValue({ nodes: [], truncated: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wardrive page', () => {
  it('shows the login form when logged out', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    await openMenu();
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });

  it('logs in', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    const login = vi.spyOn(wardriveApi, 'login').mockResolvedValue(me([KEY]));
    setup();
    await openMenu();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'mike' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('mike', 'correct horse'));
    expect(await screen.findByText(/Logged in as mike/)).toBeTruthy();
  });

  it('offers create account only with a radio paired', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    await openMenu();
    await screen.findByRole('button', { name: 'Log in' });
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect over Bluetooth' }));
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('offers add to this account and separate account for a radio not on the account', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([OTHER]));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    expect(await screen.findByRole('button', { name: 'Add to this account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a separate account' })).toBeTruthy();
  });

  it('hides device location on a device without touch', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup({ deviceLocationAllowed: () => false, serialSupported: () => true });
    await openMenu();
    expect(await screen.findByRole('button', { name: 'Use a USB GPS' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this device location' })).toBeNull();
    expect(screen.getByText(/A laptop needs a connected GPS/)).toBeTruthy();
  });

  it('starts a drive, stores a reception and shows the counters', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    const start = await screen.findByRole('button', { name: 'Start driving' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false), {
      timeout: 5000,
    });
    fireEvent.click(start);
    await screen.findByRole('button', { name: 'Stop driving' }, { timeout: 5000 });
    // Let the page subscribe to receptions first (its effect may still be pending).
    await act(async () => {});
    act(() => radio.hear());
    await waitFor(() => expect(screen.getByTestId('wardrive-stored').textContent).toBe('1'), {
      timeout: 5000,
    });
    expect(screen.getByTestId('wardrive-heard').textContent).toBe('1');
  });

  it('shows the offline banner when the server cannot be reached', async () => {
    localStorage.setItem('rtfm-wardrive-me', JSON.stringify(me([KEY])));
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('offline', 0));
    setup();
    expect(await screen.findByText(/Working offline/)).toBeTruthy();
    await openMenu();
    expect(await screen.findByText(/Logged in as mike/)).toBeTruthy();
    // The uploader's first tick has nothing to send: that proves nothing
    // about the server, so the banner must stay.
    await screen.findByText('Uploaded to RTFM-EV');
    expect(screen.getByText(/Working offline/)).toBeTruthy();
  });

  it('explains when the browser can reach no radio', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup({ bleSupported: () => false, serialSupported: () => false });
    expect(await screen.findByText(/cannot reach a radio/)).toBeTruthy();
  });

  it('shows the brokers off by default once a radio is connected', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    const box = (await screen.findByLabelText(/DutchMeshCore wardriver/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((screen.getByLabelText(/DutchMeshCore hunter/) as HTMLInputElement).checked).toBe(false);
  });

  it('switching DMC wardriver on signs in with the radio token', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const connectMqtt = vi.fn(async () => mqtt);
    setup({ connectMqtt });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    fireEvent.click(await screen.findByLabelText(/DutchMeshCore wardriver/));
    await waitFor(() => expect(connectMqtt).toHaveBeenCalled());
    expect(connectMqtt.mock.calls[0]).toEqual([
      'wss://collector2.dutchmeshcore.nl:443',
      expect.objectContaining({ username: `v1_${KEY}` }),
    ]);
  });

  it('does not show an old status when a broker is switched on again', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const connectMqtt = vi
      .fn<WardriveDeps['connectMqtt']>()
      .mockRejectedValueOnce(new Error('refused'))
      .mockReturnValue(new Promise(() => {}));
    setup({ connectMqtt });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    const box = await screen.findByLabelText(/DutchMeshCore wardriver/);
    fireEvent.click(box);
    expect(await screen.findByText(/Problem: refused/)).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByText(/Problem: refused/)).toBeNull());
    fireEvent.click(box);
    await waitFor(() => expect(connectMqtt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Connecting')).toBeTruthy();
    expect(screen.queryByText(/Problem: refused/)).toBeNull();
  });

  it('lists the brokers the server serves, with switches and no account fields', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'config').mockResolvedValue({
      hashtag_channels: [],
      brokers: [...DEFAULT_BROKERS, SERVED_ANALYZER, SERVED_CLUB],
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    expect(await screen.findByLabelText('meshcore-analyzer.eu')).toBeTruthy();
    expect(screen.getByLabelText('Club MQTT')).toBeTruthy();
    expect(screen.getByLabelText(/DutchMeshCore wardriver/)).toBeTruthy();
    expect(screen.queryByLabelText(/on8ar/)).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    // Kept for the next start without a connection.
    expect(localStorage.getItem('rtfm-wardrive-served-brokers')).toContain('Club MQTT');
  });

  it('stops forwarding to a broker the server no longer serves', async () => {
    localStorage.setItem(
      'rtfm-wardrive-served-brokers',
      JSON.stringify([...DEFAULT_BROKERS, SERVED_ANALYZER])
    );
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({ enabled: { [`meshcore-analyzer@${KEY}`]: true }, tokens: {} })
    );
    let serve: (c: WardriveConfig) => void = () => {};
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'config').mockReturnValue(new Promise((r) => (serve = r)));
    const end = vi.fn(async () => {});
    const connectMqtt = vi.fn<WardriveDeps['connectMqtt']>(async () => ({
      publish: async () => {},
      end,
      onClose: () => {},
    }));
    setup({ connectMqtt });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await waitFor(() =>
      expect(connectMqtt).toHaveBeenCalledWith(
        'wss://mqtt.meshcore-analyzer.eu:443',
        expect.anything()
      )
    );
    await act(async () => serve({ hashtag_channels: [], brokers: DEFAULT_BROKERS }));
    await waitFor(() => expect(end).toHaveBeenCalled());
    await openMenu();
    await screen.findByLabelText(/DutchMeshCore wardriver/);
    expect(screen.queryByLabelText('meshcore-analyzer.eu')).toBeNull();
    // Its switch goes too: a broker served again later (or a new one with
    // the same id) starts off, with what is heard from then on.
    const stored = JSON.parse(localStorage.getItem('rtfm-wardrive-brokers') ?? '{}');
    expect(stored.enabled).toEqual({});
  });

  it('forgets the owner broker accounts on log out', async () => {
    localStorage.setItem(
      'rtfm-wardrive-served-brokers',
      JSON.stringify([...DEFAULT_BROKERS, SERVED_CLUB])
    );
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'config').mockResolvedValue({
      hashtag_channels: [],
      brokers: [...DEFAULT_BROKERS, SERVED_CLUB],
    });
    vi.spyOn(wardriveApi, 'logout').mockResolvedValue(undefined);
    setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Log in' });
    const cached = localStorage.getItem('rtfm-wardrive-served-brokers') ?? '';
    expect(cached).not.toContain('s3cret-pass');
    expect(cached).toContain('dmc-wardriver');
  });

  it('drops cached broker accounts when the server says nobody is logged in', async () => {
    localStorage.setItem(
      'rtfm-wardrive-served-brokers',
      JSON.stringify([...DEFAULT_BROKERS, SERVED_CLUB])
    );
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    await openMenu();
    await screen.findByRole('button', { name: 'Log in' });
    await waitFor(() =>
      expect(localStorage.getItem('rtfm-wardrive-served-brokers') ?? '').not.toContain(
        's3cret-pass'
      )
    );
  });

  it('publishes a reception to a broker that is switched on', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    fireEvent.click(await screen.findByLabelText(/DutchMeshCore wardriver/));
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    await closeMenu();
    const start = await screen.findByRole('button', { name: 'Start driving' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole('button', { name: 'Stop driving' });
    // Let the page subscribe to receptions first (its effect may still be pending).
    await act(async () => {});
    act(() => radio.hear());
    await waitFor(() => expect(screen.getByTestId('wardrive-stored').textContent).toBe('1'));
    await openMenu();
    await waitFor(
      () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
        expect(published.map((p) => p.topic)).toContain(`meshcore/wardriver/${KEY}/wardriver/obs`);
      },
      { timeout: 4000 }
    );
  });

  it('lets the radio go when it does not start', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const broken = new FakeRadio(KEY);
    broken.send = async () => {
      throw new Error('write failed');
    };
    const disconnect = vi.spyOn(broken, 'disconnect');
    setup({ makeTransport: () => broken });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    // On the start screen's radio row and in the error banner behind it.
    expect((await screen.findAllByText(/write failed/)).length).toBeGreaterThan(0);
    expect(disconnect).toHaveBeenCalled();
  });

  it('starts with Auto-discover off and disabled until a radio is connected', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    // Whatever an older page or a hand-edit left, the switch starts off.
    localStorage.setItem('rtfm-wardrive-autodiscover', '1');
    const { radio } = setup();
    const before = (await screen.findByRole('button', {
      name: 'Auto-discover: off',
    })) as HTMLButtonElement;
    expect(before.disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    const after = screen.getByRole('button', { name: 'Auto-discover: off' }) as HTMLButtonElement;
    await waitFor(() => expect(after.disabled).toBe(false));
    expect(radio.sent).not.toContain(0x37);
  });

  it('sends a Discover when switched on, says its cadence, and stops with the radio', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const keysBefore = new Set(Object.keys(localStorage));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    const button = screen.getByRole('button', { name: 'Auto-discover: off' }) as HTMLButtonElement;
    // The switch works once the engine for this radio exists.
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(radio.sent).toContain(0x37));
    expect(await screen.findByRole('button', { name: 'Auto-discover: on' })).toBeTruthy();
    await openMenu();
    expect(screen.getByTestId('wardrive-autodiscover-status').textContent).toContain('every 10 s');
    await closeMenu();
    // Nothing about the switch is kept.
    const added = Object.keys(localStorage).filter((k) => !keysBefore.has(k));
    expect(added.filter((k) => /discover/i.test(k))).toEqual([]);
    act(() => radio.closes.emit());
    expect(await screen.findByRole('button', { name: 'Auto-discover: off' })).toBeTruthy();
  });

  it('keeps Introduce my node as a setting, off by default', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    await openMenu();
    const settings = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.mouseDown(settings);
    fireEvent.click(settings);
    const box = (await screen.findByLabelText('Introduce my node to targets')) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(localStorage.getItem('rtfm-wardrive-introduce')).toBe('1');
  });

  it('lets the radio go when the link closes', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    const disconnect = vi.spyOn(radio, 'disconnect');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    act(() => radio.closes.emit());
    expect(await screen.findByText(/The radio disconnected/)).toBeTruthy();
    expect(disconnect).toHaveBeenCalled();
  });

  it('shows what the radio hears in the live log and the HUD while not driving', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    // Let the page subscribe to receptions first (its effect may still be pending).
    await act(async () => {});
    act(() => radio.hear());
    expect(await screen.findByText('1 rx', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-90');
    expect(screen.getByTestId('wardrive-stored').textContent).toBe('0');
  });

  it('hands the live log the same select handler on every clock tick', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    // Let the page subscribe to receptions first (its effect may still be pending).
    await act(async () => {});
    act(() => radio.hear());
    await screen.findByText('1 rx', undefined, { timeout: 5000 });
    logSelects.length = 0;
    // The page's clock ticks every second; each tick renders the log again.
    await waitFor(() => expect(logSelects.length).toBeGreaterThan(2), { timeout: 5000 });
    expect(new Set(logSelects).size).toBe(1);
  });

  it('shows a reception picked in the live log in the HUD', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    // The page subscribes to receptions in an effect: let it run first.
    await act(async () => {});
    act(() => radio.hear(0xa6));
    await screen.findByText('1 rx', undefined, { timeout: 5000 });
    act(() => radio.hear(0xb0));
    await screen.findByText('2 rx', undefined, { timeout: 5000 });
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-80');
    const rows = logRows();
    fireEvent.click(rows[1]);
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-90');
  });

  it('says on the main screen why the drive cannot start', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    expect(await screen.findByText('Log in to start a drive.')).toBeTruthy();
  });

  it('clears the paused note once the drive has stopped', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    const start = await screen.findByRole('button', { name: 'Start driving' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false), {
      timeout: 5000,
    });
    fireEvent.click(start);
    await screen.findByRole('button', { name: 'Stop driving' }, { timeout: 5000 });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText(/while the page was in the background/)).toBeTruthy();
    // The radio drops while the page is in the background: the drive stops.
    act(() => radio.closes.emit());
    visibility.mockReturnValue('visible');
    await waitFor(() =>
      expect(screen.queryByText(/while the page was in the background/)).toBeNull()
    );
  });

  it('forgets the radio tokens on log out', async () => {
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({
        enabled: { [`dmc-wardriver@${KEY}`]: true },
        tokens: { [`collector2.dutchmeshcore.nl@${KEY}`]: 'token' },
      })
    );
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'logout').mockResolvedValue(undefined);
    setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Log in' });
    const stored = JSON.parse(localStorage.getItem('rtfm-wardrive-brokers') ?? '{}');
    expect(stored.tokens).toEqual({});
    expect(stored.enabled).toEqual({ [`dmc-wardriver@${KEY}`]: true });
  });
});

describe('wardrive page storage', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage');
    vi.restoreAllMocks();
  });

  it('asks the browser to keep the queue when a drive starts', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    const start = await screen.findByRole('button', { name: 'Start driving' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false), {
      timeout: 5000,
    });
    expect(persist).not.toHaveBeenCalled();
    fireEvent.click(start);
    await screen.findByRole('button', { name: 'Stop driving' }, { timeout: 5000 });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('wardrive page with every broker switched off', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens no broker connection when driving after the switches went off', async () => {
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({ enabled: { [`dmc-hunter@${KEY}`]: true }, tokens: {} })
    );
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'upload').mockResolvedValue({
      accepted_obs: 1,
      duplicate_obs: 0,
      accepted_tracks: 0,
      duplicate_tracks: 0,
    });
    const end = vi.fn(async () => {});
    const publish = vi.fn(async () => {});
    const connectMqtt = vi.fn<WardriveDeps['connectMqtt']>(async () => ({
      publish,
      end,
      onClose: () => {},
    }));
    const { radio } = setup({ connectMqtt });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await waitFor(() => expect(connectMqtt).toHaveBeenCalledTimes(1));
    await openMenu();
    const hunter = (await screen.findByLabelText(/DutchMeshCore hunter/)) as HTMLInputElement;
    expect(hunter.checked).toBe(true);
    fireEvent.click(hunter);
    await waitFor(() => expect(hunter.checked).toBe(false));
    for (const box of screen.getAllByRole('checkbox') as HTMLInputElement[]) {
      expect(box.checked).toBe(false);
    }
    await waitFor(() => expect(end).toHaveBeenCalled());
    await closeMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    const start = await screen.findByRole('button', { name: 'Start driving' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false), {
      timeout: 5000,
    });
    fireEvent.click(start);
    await screen.findByRole('button', { name: 'Stop driving' }, { timeout: 5000 });
    act(() => radio.hear());
    await new Promise((r) => setTimeout(r, 1500));
    expect(connectMqtt).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('wardrive page with two accounts on one browser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps another account's receptions waiting instead of uploading them", async () => {
    const queue = await openQueue(`app-${n++}`);
    await queue.addObs(OTHER, {
      v: 1,
      origin_id: OTHER,
      rx_at: '2026-10-19T10:00:00.000Z',
      hash: '0123456789abcdef',
      raw: '15000102',
      len: 4,
      packet_type: 5,
      payload_len: 2,
      path: [],
      pos: { lat: 52, lon: 5, src: 'phone' },
    });
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const upload = vi.spyOn(wardriveApi, 'upload');
    setup({ openQueue: async () => queue });
    expect(await screen.findByText(/1 reception of another account/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('wardrive page when RTFM-EV refuses a radio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the account again after a 403 and keeps the rows', async () => {
    const queue = await openQueue(`app-${n++}`);
    await queue.addObs(KEY, {
      v: 1,
      origin_id: KEY,
      rx_at: '2026-10-19T10:00:00.000Z',
      hash: '0123456789abcdef',
      raw: '15000102',
      len: 4,
      packet_type: 5,
      payload_len: 2,
      path: [],
      pos: { lat: 52, lon: 5, src: 'phone' },
    });
    const meCall = vi
      .spyOn(wardriveApi, 'me')
      .mockResolvedValueOnce(me([KEY]))
      .mockResolvedValue(me([]));
    vi.spyOn(wardriveApi, 'upload').mockRejectedValue(
      new WardriveApiError('This radio is not on your account', 403)
    );
    setup({ openQueue: async () => queue });
    await waitFor(() => expect(meCall).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/1 reception of another account/)).toBeTruthy();
  });
});

describe('wardrive page reading what it hears', () => {
  const TOREN_KEY = 'a1b2' + 'ee'.repeat(30);

  async function connected(contacts: Uint8Array[] = []) {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const ctx = setup();
    ctx.radio.contacts = contacts;
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    await waitFor(() => expect(wardriveApi.config).toHaveBeenCalled());
    // The owner's channel list reaches the decoder.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return ctx;
  }

  async function hearChannelMessage(radio: FakeRadio) {
    act(() => radio.hearRaw(groupTextFrame(TEST_SECRET, 'Mike', 'hello')));
    await waitFor(() => expect(logRows().length).toBe(1));
  }

  it('decodes a channel message for the log and the HUD', async () => {
    const { radio } = await connected();
    await hearChannelMessage(radio);
    expect(logRows()[0].textContent).toContain('#test: hello');
    expect(logRows()[0].textContent).toContain('Mike');
    expect(screen.getByTestId('wardrive-hud-sender').textContent).toBe('Mike');
  });

  it('names a relay after the matching contact on the radio', async () => {
    const toren = contactFrame({ keyHex: TOREN_KEY, type: 2, name: 'Toren', lat: 52.11, lon: 5.1 });
    const { radio } = await connected([toren]);
    await waitFor(() => expect(radio.sent).toContain(0x04));
    act(() => radio.hearRaw(groupTextFrame(TEST_SECRET, 'Mike', 'hi', 'a1b2', 2)));
    await waitFor(() =>
      expect(screen.getByTestId('wardrive-hud-sender').textContent).toBe('via ~Toren')
    );
  });

  it('asks the radio only local questions and sends nothing of its own', async () => {
    const { radio } = await connected();
    await waitFor(() => expect(radio.sent).toContain(0x04));
    await hearChannelMessage(radio);
    // APP_START, GET_DEVICE_TIME, GET_CONTACTS and GET_STATS: none goes over the air.
    expect(new Set(radio.sent)).toEqual(new Set([0x01, 0x05, 0x04, 0x38]));
  });

  it('shows the noise floor the radio reports', async () => {
    await connected();
    await waitFor(() =>
      expect(screen.getByTestId('wardrive-hud-noise').textContent).toContain('-110')
    );
  });

  it('filters by packet type, counts it on the pill, and All brings the rest back', async () => {
    const { radio } = await connected();
    await hearChannelMessage(radio);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Advert' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(logRows()).toHaveLength(0));
    expect(screen.getByTestId('live-map').dataset.count).toBe('0');
    expect(screen.getByTestId('wardrive-filter-count').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Show all receptions' }));
    await waitFor(() => expect(logRows()).toHaveLength(1));
    expect(logRows()[0].getAttribute('title')).toBe('outside filter');
  });

  it('ignores the shown sender in both stands and lists it among the ignored', async () => {
    const { radio } = await connected();
    await hearChannelMessage(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Ignore the shown sender' }));
    await waitFor(() => expect(logRows()).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Show all receptions' }));
    expect(logRows()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(await screen.findByRole('button', { name: 'Stop ignoring Mike' })).toBeTruthy();
  });

  it('narrows the log to a target picked in the target sheet', async () => {
    const { radio } = await connected();
    await hearChannelMessage(radio);
    act(() => radio.hearRaw(groupTextFrame(TEST_SECRET, 'Anna', 'hoi')));
    await waitFor(() => expect(logRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Targets: All senders' }));
    const list = await screen.findByTestId('wardrive-target-list');
    fireEvent.click(within(list).getByRole('button', { name: /Anna/ }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(logRows()).toHaveLength(1));
    expect(logRows()[0].textContent).toContain('Anna');
    expect(screen.getByRole('button', { name: 'Targets: Anna' })).toBeTruthy();
  });
  it('cycles the map view and keeps it for next time', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'View: 2D, points' }));
    expect(screen.getByRole('button', { name: 'View: 2D, hex and points' })).toBeTruthy();
    expect(localStorage.getItem('rtfm-wardrive-view')).toBe('both2d');
    expect((await screen.findByTestId('live-map')).dataset.view).toBe('both2d');
  });

  it('starts at 2D points when the stored view is unknown', async () => {
    localStorage.setItem('rtfm-wardrive-view', 'garbage');
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    expect(await screen.findByRole('button', { name: 'View: 2D, points' })).toBeTruthy();
  });

  it('cycles the compass and the node positions and keeps them', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Compass: follow, north up' }));
    expect(screen.getByRole('button', { name: 'Compass: follow, heading' })).toBeTruthy();
    expect(localStorage.getItem('rtfm-wardrive-compass')).toBe('heading');
    fireEvent.click(screen.getByRole('button', { name: 'Node positions: off' }));
    expect(localStorage.getItem('rtfm-wardrive-nodepos')).toBe('positions');
    const map = await screen.findByTestId('live-map');
    expect(map.dataset.compass).toBe('heading');
    expect(map.dataset.nodepos).toBe('positions');
  });

  it('puts the noise floor on the map from the Settings tab, off by default', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    expect((await screen.findByTestId('live-map')).getAttribute('data-noise')).toBe('off');
    await openMenu();
    const settings = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.mouseDown(settings);
    fireEvent.click(settings);
    fireEvent.click(await screen.findByLabelText('Noise floor on the map'));
    await waitFor(() =>
      expect(screen.getByTestId('live-map').getAttribute('data-noise')).toBe('on')
    );
    expect(localStorage.getItem('rtfm-wardrive-noise-map')).toBe('1');
  });

  it('shows the radio battery in the Status tab', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    // The test radio reports 3700 mV.
    expect((await screen.findByTestId('wardrive-battery')).textContent).toContain('3.70 V, 58 %');
  });

  it('sets the terrain exaggeration in the Settings tab', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    await openMenu();
    const settings = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.mouseDown(settings);
    fireEvent.click(settings);
    const seven = await screen.findByRole('radio', { name: '7x' });
    expect((seven as HTMLInputElement).checked).toBe(true);
    for (const x of ['1x', '2x', '4x', '10x'])
      expect(screen.getByRole('radio', { name: x })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '4x' }));
    expect(localStorage.getItem('rtfm-wardrive-exaggeration')).toBe('4');
    await closeMenu();
    expect((await screen.findByTestId('live-map')).dataset.exaggeration).toBe('4');
  });

  it('asks a logged-out driver to log in for drives and reports', async () => {
    vi.spyOn(wardriveApi, 'me').mockRejectedValue(new WardriveApiError('no', 401));
    setup();
    await openMenu();
    const drives = screen.getByRole('tab', { name: 'Drives' });
    fireEvent.mouseDown(drives);
    fireEvent.click(drives);
    expect(await screen.findByText('Log in to see your drives and reports.')).toBeTruthy();
  });

  it('reports on the drives picked in the Drives tab', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const api = fakeApi([
      drive({ id: 7, name: 'Ochtend' }),
      drive({ id: 8, name: 'Avond', start_ts: T0 + 7200, end_ts: T0 + 7800 }),
    ]);
    setup({ drivesApi: api });
    await openMenu();
    const drives = screen.getByRole('tab', { name: 'Drives' });
    fireEvent.mouseDown(drives);
    fireEvent.click(drives);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pick Ochtend' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick Avond' }));
    const reports = screen.getByRole('tab', { name: 'Reports' });
    fireEvent.mouseDown(reports);
    fireEvent.click(reports);
    await waitFor(() => expect(api.report).toHaveBeenCalledWith({ drive: [7, 8], res: 9 }));
    expect(await screen.findByRole('heading', { name: 'What was driven' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drive card' })).toBeTruthy();
  });

  it('forgets the picked drives when another driver logs in', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'logout').mockResolvedValue(undefined);
    vi.spyOn(wardriveApi, 'login').mockResolvedValue({ ...me([]), user_id: 2, username: 'bert' });
    const api = fakeApi([drive({ id: 7, name: 'Ochtend' })]);
    setup({ drivesApi: api });
    await openMenu();
    const tab = (name: string) => {
      const el = screen.getByRole('tab', { name });
      fireEvent.mouseDown(el);
      fireEvent.click(el);
    };
    tab('Drives');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pick Ochtend' }));
    tab('Status');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'bert' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText(/Logged in as bert/)).toBeTruthy();
    tab('Reports');
    await waitFor(() => expect(api.report).toHaveBeenCalled());
    const calls = api.report.mock.calls as unknown[][];
    const last = calls[calls.length - 1][0] as { drive?: number[] };
    expect(last.drive).toBeUndefined();
  });

  it('ignores a calibration from the server outside -30..30 dB', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const config = vi.spyOn(wardriveApi, 'config').mockResolvedValue({
      hashtag_channels: [],
      rssi_calibration_db: 400,
    });
    localStorage.setItem('rtfm-wardrive-calibration', '6');
    setup();
    await waitFor(() => expect(config).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('rtfm-wardrive-calibration')).toBe('0'));
  });

  it('keeps a DMC forwarder running when the served list says the same as the built-in one', async () => {
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({ enabled: { [`dmc-hunter@${KEY}`]: true }, tokens: {} })
    );
    let serve: (c: WardriveConfig) => void = () => {};
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    vi.spyOn(wardriveApi, 'config').mockReturnValue(new Promise((r) => (serve = r)));
    const end = vi.fn(async () => {});
    const connectMqtt = vi.fn<WardriveDeps['connectMqtt']>(async () => ({
      publish: async () => {},
      end,
      onClose: () => {},
    }));
    setup({ connectMqtt });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await waitFor(() => expect(connectMqtt).toHaveBeenCalledTimes(1));
    // The server's own key order (app/wardrive/brokers.py), same values.
    const served = DEFAULT_BROKERS.map(({ id, name, url, auth, format, label, audience }) => ({
      id,
      name,
      url,
      auth,
      format,
      label,
      audience,
      builtin: true,
    }));
    await act(async () => serve({ hashtag_channels: [], brokers: served as never }));
    await act(async () => {});
    expect(end).not.toHaveBeenCalled();
    expect(connectMqtt).toHaveBeenCalledTimes(1);
  });

  it('keeps offering the cached broker list when the config cannot be read', async () => {
    localStorage.setItem(
      'rtfm-wardrive-served-brokers',
      JSON.stringify([...DEFAULT_BROKERS, SERVED_CLUB])
    );
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const config = vi
      .spyOn(wardriveApi, 'config')
      .mockRejectedValue(new WardriveApiError('down', 503));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await waitFor(() => expect(config).toHaveBeenCalled());
    await openMenu();
    expect(await screen.findByLabelText(/Club MQTT/)).toBeTruthy();
    expect(screen.getByLabelText(/DutchMeshCore wardriver/)).toBeTruthy();
  });
});
