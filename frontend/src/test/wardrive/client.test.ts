import { afterEach, describe, expect, it, vi } from 'vitest';

const { connectAsync } = vi.hoisted(() => ({ connectAsync: vi.fn() }));
vi.mock('mqtt', () => ({ default: { connectAsync } }));

import { CONNECT_GIVE_UP_MS, connectMqtt } from '../../wardrive/forward/client';

const CREDS = { username: 'u', password: 'p', clientId: 'c' };

afterEach(() => {
  vi.useRealTimers();
  connectAsync.mockReset();
});

describe('connectMqtt', () => {
  it('asks mqtt to fail on a closed socket instead of retrying for ever', async () => {
    connectAsync.mockResolvedValue({ publish: vi.fn(), endAsync: vi.fn(), on: vi.fn() });
    await connectMqtt('wss://broker:443', CREDS);
    expect(connectAsync).toHaveBeenCalledWith(
      'wss://broker:443',
      expect.objectContaining({ username: 'u', clientId: 'c', reconnectPeriod: 0 }),
      false
    );
  });

  it('gives up when the broker never answers', async () => {
    vi.useFakeTimers();
    connectAsync.mockReturnValue(new Promise(() => {}));
    const attempt = connectMqtt('wss://broker:443', CREDS);
    const assertion = expect(attempt).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(CONNECT_GIVE_UP_MS + 1);
    await assertion;
  });

  it('closes a client that connects only after it gave up', async () => {
    vi.useFakeTimers();
    let resolveLate: (c: unknown) => void = () => {};
    const endAsync = vi.fn().mockResolvedValue(undefined);
    connectAsync.mockReturnValue(new Promise((r) => (resolveLate = r)));
    const attempt = connectMqtt('wss://broker:443', CREDS).catch(() => 'gave up');
    await vi.advanceTimersByTimeAsync(CONNECT_GIVE_UP_MS + 1);
    expect(await attempt).toBe('gave up');
    resolveLate({ publish: vi.fn(), endAsync, on: vi.fn() });
    await vi.advanceTimersByTimeAsync(1);
    expect(endAsync).toHaveBeenCalled();
  });

  it('listens for client errors so a keepalive timeout does not throw', async () => {
    const on = vi.fn();
    connectAsync.mockResolvedValue({ publish: vi.fn(), endAsync: vi.fn(), on });
    await connectMqtt('wss://broker:443', CREDS);
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
