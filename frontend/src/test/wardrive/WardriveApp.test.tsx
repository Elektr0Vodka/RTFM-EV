import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { WardriveApp, type WardriveDeps } from '../../wardrive/WardriveApp';
import { WardriveApiError, wardriveApi, type WardriveMe } from '../../wardrive/api';
import type { Fix } from '../../wardrive/messages';
import type { PositionSource } from '../../wardrive/position/sources';
import type { MqttLike } from '../../wardrive/forward/client';
import { openQueue } from '../../wardrive/queue';
import { Listeners, type RadioTransport } from '../../wardrive/radio/transport';

// MapLibre does not run in jsdom; the live map is checked in a real browser.
vi.mock('../../wardrive/map/LiveMap', () => ({
  LiveMap: () => <div data-testid="live-map" />,
}));

const KEY = 'AB'.repeat(32);
const OTHER = 'CD'.repeat(32);
let n = 0;

class FakeRadio implements RadioTransport {
  kind = 'ble' as const;
  frames = new Listeners<Uint8Array>();
  closes = new Listeners<void>();
  constructor(private key: string) {}
  async connect() {}
  async disconnect() {}
  async send(frame: Uint8Array) {
    if (frame[0] === 0x01) {
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
    bleSupported: () => true,
    serialSupported: () => false,
    deviceLocationAllowed: () => true,
    connectMqtt: async () => mqtt,
    ...over,
  };
  render(
    <I18nProvider>
      <WardriveApp deps={deps} />
    </I18nProvider>
  );
  return { radio, position };
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

  it('needs an on8ar username and password before on8ar can be switched on', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    await openMenu();
    const box = (await screen.findByLabelText('on8ar (your own account)')) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('on8ar username'), { target: { value: 'me' } });
    fireEvent.change(screen.getByLabelText('on8ar password'), { target: { value: 'pw' } });
    expect(
      ((await screen.findByLabelText('on8ar (your own account)')) as HTMLInputElement).disabled
    ).toBe(false);
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
    act(() => radio.hear());
    expect(await screen.findByText('1 rx')).toBeTruthy();
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-90');
    expect(screen.getByTestId('wardrive-stored').textContent).toBe('0');
  });

  it('shows a reception picked in the live log in the HUD', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValue(me([KEY]));
    const { radio } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect over Bluetooth' }));
    await screen.findByText(/Car/);
    act(() => radio.hear(0xa6));
    await screen.findByText('1 rx');
    act(() => radio.hear(0xb0));
    await screen.findByText('2 rx');
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-80');
    const rows = screen.getAllByRole('listitem');
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

  it('forgets the on8ar password and the radio tokens on log out', async () => {
    localStorage.setItem(
      'rtfm-wardrive-brokers',
      JSON.stringify({
        enabled: { [`dmc-wardriver@${KEY}`]: true },
        on8ar: { username: 'me', password: 'secret' },
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
    expect(stored.on8ar).toBeNull();
    expect(stored.tokens).toEqual({});
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
