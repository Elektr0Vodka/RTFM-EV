import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaderRadioMenu } from '../gateway/HeaderRadioMenu';
import { trackRadioTabs } from '../gateway/radioTabs';
import {
  connectGatewayEvents,
  gatewayEventsUrl,
  getRadioUnreads,
  parseUnreads,
} from '../gateway/unreads';
import { useOtherRadioAlerts } from '../gateway/useOtherRadioAlerts';

const ALICE = `contact-${'11'.repeat(32)}`;
const PUBLIC = 'channel-8B3387E9C5CDEA6AC9E5EDBAA115CD72';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
}

function workspace(id: number) {
  window.__RTFM_GATEWAY__ = {
    page: 'workspace',
    base: '../../gateway/',
    radio: { id, name: `Radio ${id}`, urlKey: '0d1d00147f96' },
  };
}

const TOTALS = {
  type: 'unreads',
  radios: {
    '1': { unread: 4, dms: 0, mentions: 0, sound: true },
    '2': { unread: 3, dms: 1, mentions: 0, sound: true },
    '3': { unread: 2, dms: 0, mentions: 0, sound: false },
  },
};

beforeEach(() => {
  FakeSocket.instances = [];
  localStorage.clear();
  window.history.replaceState(null, '', '/r/0d1d00147f96/');
});

afterEach(() => {
  delete window.__RTFM_GATEWAY__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('parseUnreads', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parseUnreads({
        '2': { unread: 3, dms: 1, mentions: 0, sound: true },
        x: { unread: 1 },
        '4': 'nope',
        '5': { unread: -2, dms: 'a' },
      })
    ).toEqual({
      2: { unread: 3, dms: 1, mentions: 0, sound: true },
      5: { unread: 0, dms: 0, mentions: 0, sound: false },
    });
    expect(parseUnreads(null)).toEqual({});
  });
});

describe('connectGatewayEvents', () => {
  it('does nothing in single-radio mode', () => {
    expect(gatewayEventsUrl()).toBeNull();
    const stop = connectGatewayEvents(vi.fn(), (url) => new FakeSocket(url));
    expect(FakeSocket.instances).toHaveLength(0);
    stop();
  });

  it('connects to the gateway next to the workspace and publishes totals', () => {
    workspace(1);
    const onAlert = vi.fn();
    const stop = connectGatewayEvents(onAlert, (url) => new FakeSocket(url));

    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe(`ws://${window.location.host}/gateway/ws`);

    socket.receive(TOTALS);
    expect(getRadioUnreads()[2]).toEqual({ unread: 3, dms: 1, mentions: 0, sound: true });

    socket.receive({ type: 'alert', radio: 2, keys: [ALICE, 7] });
    expect(onAlert).toHaveBeenCalledWith(2, [ALICE]);

    socket.receive('not json');
    socket.receive({ type: 'pong' });
    expect(onAlert).toHaveBeenCalledTimes(1);

    stop();
    expect(socket.closed).toBe(true);
    expect(getRadioUnreads()).toEqual({});
  });

  it('reconnects after the connection drops, and not after stop', () => {
    vi.useFakeTimers();
    workspace(1);
    const stop = connectGatewayEvents(vi.fn(), (url) => new FakeSocket(url));
    FakeSocket.instances[0].close();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    stop();
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe('useOtherRadioAlerts', () => {
  function setup(enabled = true) {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('BroadcastChannel', undefined);
    const play = vi.fn();
    const hook = renderHook(() => useOtherRadioAlerts(play, enabled));
    const socket = FakeSocket.instances[0];
    act(() => socket?.receive(TOTALS));
    return { play, socket, hook };
  }

  it('plays for a new DM on another radio', () => {
    workspace(1);
    const { play, socket } = setup();
    act(() => socket.receive({ type: 'alert', radio: 2, keys: [ALICE] }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for this radio, for a radio with sound off, and when disabled', () => {
    workspace(1);
    const { play, socket, hook } = setup();
    act(() => socket.receive({ type: 'alert', radio: 1, keys: [ALICE] }));
    act(() => socket.receive({ type: 'alert', radio: 3, keys: [ALICE] }));
    act(() => socket.receive({ type: 'alert', radio: 9, keys: [ALICE] }));
    expect(play).not.toHaveBeenCalled();
    hook.unmount();

    FakeSocket.instances = [];
    setup(false);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('respects the other radio per-conversation sound mute', () => {
    workspace(1);
    localStorage.setItem(
      'r2:meshcore_mention_sound_muted_by_conversation',
      JSON.stringify({ [ALICE]: true })
    );
    const { play, socket } = setup();
    act(() => socket.receive({ type: 'alert', radio: 2, keys: [ALICE] }));
    expect(play).not.toHaveBeenCalled();
    act(() => socket.receive({ type: 'alert', radio: 2, keys: [ALICE, PUBLIC] }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not connect in single-radio mode', () => {
    setup();
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe('HeaderRadioMenu unread badge', () => {
  it('shows what waits on the other radios', () => {
    workspace(1);
    const stop = connectGatewayEvents(vi.fn(), (url) => new FakeSocket(url));
    render(<HeaderRadioMenu />);
    expect(screen.queryByTestId('gateway-other-unread')).toBeNull();

    act(() => FakeSocket.instances[0].receive(TOTALS));
    const badge = screen.getByTestId('gateway-other-unread');
    expect(badge).toHaveTextContent('5');
    expect(badge).toHaveAttribute('aria-label', '5 unread messages on other radios');
    act(() => stop());
  });
});

describe('trackRadioTabs', () => {
  type Message = { t: string; id: number };

  function bus() {
    const ends: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: (message: Message) => void;
      close: () => void;
    }[] = [];
    return () => {
      const end = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: (message: Message) => {
          ends
            .filter((other) => other !== end)
            .forEach((other) => other.onmessage?.({ data: message }));
        },
        close: () => {
          ends.splice(ends.indexOf(end), 1);
        },
      };
      ends.push(end);
      return end;
    };
  }

  it('knows which radios have a tab open, also after one of two closes', () => {
    const open = bus();
    const one = trackRadioTabs(1, open());
    expect(one.isOpen(2)).toBe(false);

    const two = trackRadioTabs(2, open());
    const twoAgain = trackRadioTabs(2, open());
    expect(one.isOpen(2)).toBe(true);
    expect(two.isOpen(1)).toBe(true);

    two.dispose();
    expect(one.isOpen(2)).toBe(true);
    twoAgain.dispose();
    expect(one.isOpen(2)).toBe(false);
    one.dispose();
  });

  it('is a no-op without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const tabs = trackRadioTabs(1);
    expect(tabs.isOpen(2)).toBe(false);
    tabs.dispose();
  });
});
