import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWebSocket } from '../useWebSocket';
import * as authRedirect from '../utils/authRedirect';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  send(): void {}
}

const originalWebSocket = globalThis.WebSocket;

describe('useWebSocket lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it('does not reconnect after hook unmount cleanup', () => {
    const { unmount } = renderHook(() => useWebSocket({}));

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      unmount();
    });

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    // Unmount-triggered socket close should not start a new connection.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('checks the session over HTTP after three failed connections in a row', () => {
    // A browser hides the HTTP status of a refused WebSocket handshake, so a
    // lost proxy session and a stopped server look the same from here.
    const probe = vi.spyOn(authRedirect, 'probeAuthSession').mockResolvedValue();
    const { unmount } = renderHook(() => useWebSocket({}));

    for (let failure = 1; failure <= 2; failure++) {
      act(() => {
        MockWebSocket.instances[MockWebSocket.instances.length - 1].onclose?.();
        vi.advanceTimersByTime(3100);
      });
    }
    expect(probe).not.toHaveBeenCalled();

    act(() => {
      MockWebSocket.instances[MockWebSocket.instances.length - 1].onclose?.();
    });
    expect(probe).toHaveBeenCalledTimes(1);

    act(() => unmount());
    probe.mockRestore();
  });

  it('starts counting again after a connection that opened', () => {
    const probe = vi.spyOn(authRedirect, 'probeAuthSession').mockResolvedValue();
    const { unmount } = renderHook(() => useWebSocket({}));
    const last = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

    for (let failure = 1; failure <= 2; failure++) {
      act(() => {
        last().onclose?.();
        vi.advanceTimersByTime(3100);
      });
    }
    act(() => {
      last().onopen?.();
      last().onclose?.();
    });
    expect(probe).not.toHaveBeenCalled();

    act(() => unmount());
    probe.mockRestore();
  });

  it('asks for the full stream by default and the chat profile on request', () => {
    const full = renderHook(() => useWebSocket({}));
    expect(MockWebSocket.instances[0].url).toMatch(/\/api\/ws$/);
    act(() => full.unmount());

    const chat = renderHook(() => useWebSocket({}, 'chat'));
    expect(MockWebSocket.instances[1].url).toMatch(/\/api\/ws\?events=chat$/);
    act(() => chat.unmount());
  });
});
