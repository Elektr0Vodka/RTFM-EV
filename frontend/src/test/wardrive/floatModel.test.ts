import { describe, expect, it, vi } from 'vitest';

import { FloatReadout } from '../../wardrive/float/FloatReadout';
import { floatModel, floatSupport, type FloatWindow } from '../../wardrive/float/floatModel';
import type { LiveEntry } from '../../wardrive/liveLog';
import { rssiTier } from '../../wardrive/signal';

const t = (key: string, vars?: Record<string, unknown>) =>
  key === 'wardrive_page_hud_snr' ? `SNR ${vars?.value} dB` : key;

const entry = (over: Partial<LiveEntry> = {}): LiveEntry => ({
  id: 1,
  at: 0,
  rssi: -85,
  snr: 4.5,
  payloadType: 5,
  typeName: 'GroupText',
  direct: false,
  hops: 2,
  lat: 52,
  lon: 5,
  kept: true,
  packetType: 'GroupText',
  heardDirect: false,
  sender: { kind: null, id: null, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
  ...over,
});

const SENDER = { prefix: 'via ', name: 'Tower', note: '' };

describe('floatModel', () => {
  it('is empty before the first reception', () => {
    expect(floatModel({ entry: null, sender: SENDER, ageText: '3 s', offset: 0, t })).toEqual({
      empty: true,
      rssi: '',
      snr: '',
      since: '',
      tier: 'none',
      sender: SENDER,
    });
  });

  it('shows the measured RSSI with the tier of the plotted value', () => {
    const m = floatModel({ entry: entry(), sender: SENDER, ageText: '12 s', offset: 20, t });
    expect(m).toEqual({
      empty: false,
      rssi: '-85',
      snr: 'SNR 4.5 dB',
      since: '12 s',
      tier: rssiTier(-65),
      sender: SENDER,
    });
    expect(m.tier).not.toBe(rssiTier(-85));
  });

  it('leaves out a signal the radio did not give', () => {
    const m = floatModel({
      entry: entry({ rssi: null, snr: null }),
      sender: SENDER,
      ageText: '1 s',
      offset: 0,
      t,
    });
    expect(m).toMatchObject({ empty: false, rssi: '', snr: '', tier: 'none' });
  });
});

function fakeWin({
  capture = true,
  pip = false,
  fullscreen = true,
}: { capture?: boolean; pip?: boolean; fullscreen?: boolean } = {}) {
  const canvasProto: Record<string, unknown> = capture ? { captureStream: () => null } : {};
  const videoProto: Record<string, unknown> = {};
  if (pip) videoProto.requestPictureInPicture = () => null;
  if (fullscreen) videoProto.requestFullscreen = () => null;
  return {
    document: { pictureInPictureEnabled: pip },
    HTMLCanvasElement: { prototype: canvasProto },
    HTMLVideoElement: { prototype: videoProto },
  } as unknown as FloatWindow;
}

const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141' } as Navigator;
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141' } as Navigator;

describe('floatSupport', () => {
  it('is pip on a desktop browser with picture-in-picture', () => {
    expect(floatSupport(fakeWin({ pip: true }), DESKTOP)).toBe('pip');
  });

  it('is fullscreen on Android, where picture-in-picture hides the page', () => {
    expect(floatSupport(fakeWin({ pip: true }), ANDROID)).toBe('fullscreen');
    expect(
      floatSupport(fakeWin(), { userAgentData: { platform: 'Android' } } as unknown as Navigator)
    ).toBe('fullscreen');
  });

  it('is null without picture-in-picture on a desktop, or without canvas capture', () => {
    expect(floatSupport(fakeWin(), DESKTOP)).toBeNull();
    expect(floatSupport(fakeWin({ capture: false, pip: true }), DESKTOP)).toBeNull();
    expect(floatSupport(fakeWin({ fullscreen: false }), ANDROID)).toBeNull();
  });
});

function fakeElements(opts: { refusePip?: boolean; refuseFullscreen?: boolean } = {}) {
  const requestFrame = vi.fn();
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 10 }) },
    {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : typeof key === 'string' ? vi.fn() : 0,
      set: () => true,
    }
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    captureStream: vi.fn(() => ({ getVideoTracks: () => [{ requestFrame }] })),
  };
  const listeners: Record<string, () => void> = {};
  const doc = {
    pictureInPictureEnabled: true,
    pictureInPictureElement: null as unknown,
    fullscreenElement: null as unknown,
    exitPictureInPicture: vi.fn(async () => {}),
    exitFullscreen: vi.fn(async () => {}),
    addEventListener: (name: string, cb: () => void) => (listeners[name] = cb),
    removeEventListener: vi.fn(),
  };
  const video = {
    ownerDocument: doc,
    srcObject: null as unknown,
    muted: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    requestPictureInPicture: vi.fn(async () => {
      if (opts.refusePip) throw new Error('refused');
      doc.pictureInPictureElement = video;
    }),
    requestFullscreen: vi.fn(async () => {
      if (opts.refuseFullscreen) throw new Error('refused');
      doc.fullscreenElement = video;
    }),
    addEventListener: (name: string, cb: () => void) => (listeners[name] = cb),
    removeEventListener: vi.fn(),
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    video: video as unknown as HTMLVideoElement,
    raw: { canvas, video, doc, requestFrame, listeners },
  };
}

const LABELS = { empty: 'No reception yet', emptyHint: 'It appears here.', dbm: 'dBm' };
const MODEL = floatModel({ entry: entry(), sender: SENDER, ageText: '2 s', offset: 0, t });

describe('FloatReadout', () => {
  it('streams the canvas only when it draws and opens picture-in-picture', async () => {
    const els = fakeElements();
    const onChange = vi.fn();
    const fr = new FloatReadout({ ...els, mode: 'pip', labels: LABELS, cvd: false, onChange });
    expect(els.raw.canvas.captureStream).toHaveBeenCalledWith(0);
    expect(await fr.open(MODEL)).toBe(true);
    expect(els.raw.video.play).toHaveBeenCalled();
    expect(els.raw.video.requestPictureInPicture).toHaveBeenCalled();
    expect(els.raw.video.requestFullscreen).not.toHaveBeenCalled();
    expect(els.raw.requestFrame).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(true);
    const frames = els.raw.requestFrame.mock.calls.length;
    fr.update({ ...MODEL, since: '3 s' });
    expect(els.raw.requestFrame.mock.calls.length).toBe(frames + 1);
  });

  it('goes fullscreen upright on Android', async () => {
    const els = fakeElements();
    const orientation = { lock: vi.fn(async () => {}), unlock: vi.fn() };
    const fr = new FloatReadout({
      ...els,
      mode: 'fullscreen',
      labels: LABELS,
      cvd: false,
      orientation,
    });
    expect(await fr.open(MODEL)).toBe(true);
    expect(els.raw.video.requestFullscreen).toHaveBeenCalled();
    expect(orientation.lock).toHaveBeenCalledWith('portrait');
    expect(els.raw.video.requestPictureInPicture).not.toHaveBeenCalled();
  });

  it('says it did not open when the browser refuses, and stops the stream', async () => {
    const els = fakeElements({ refusePip: true, refuseFullscreen: true });
    const onChange = vi.fn();
    const fr = new FloatReadout({ ...els, mode: 'pip', labels: LABELS, cvd: false, onChange });
    expect(await fr.open(MODEL)).toBe(false);
    expect(fr.isOpen()).toBe(false);
    expect(els.raw.video.pause).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith(true);
  });

  it('closes what it opened', async () => {
    const els = fakeElements();
    const onChange = vi.fn();
    const fr = new FloatReadout({ ...els, mode: 'pip', labels: LABELS, cvd: false, onChange });
    await fr.open(MODEL);
    await fr.close();
    expect(els.raw.doc.exitPictureInPicture).toHaveBeenCalled();
    expect(els.raw.video.pause).toHaveBeenCalled();
    expect(fr.isOpen()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('notices the window closed from outside the page', async () => {
    vi.useFakeTimers();
    try {
      const els = fakeElements();
      const onChange = vi.fn();
      const fr = new FloatReadout({ ...els, mode: 'pip', labels: LABELS, cvd: false, onChange });
      await fr.open(MODEL);
      els.raw.doc.pictureInPictureElement = null;
      els.raw.listeners.leavepictureinpicture();
      await vi.advanceTimersByTimeAsync(700);
      expect(fr.isOpen()).toBe(false);
      expect(onChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
