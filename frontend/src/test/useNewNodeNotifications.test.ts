import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewNodeNotifications } from '../hooks/useNewNodeNotifications';
import type { NewNodePayload } from '../wsEvents';

const mocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: mocks.toast,
}));

function singlePayload(overrides: Partial<NewNodePayload> = {}): NewNodePayload {
  return {
    batched: false,
    count: 1,
    public_key: 'aa'.repeat(32),
    name: 'Alice',
    type: 2, // repeater
    types: { '2': 1 },
    ...overrides,
  };
}

function batchPayload(overrides: Partial<NewNodePayload> = {}): NewNodePayload {
  return {
    batched: true,
    count: 3,
    public_key: null,
    name: null,
    type: null,
    types: { '2': 2, '4': 1 },
    ...overrides,
  };
}

describe('useNewNodeNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.location.hash = '';
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(window, 'focus').mockImplementation(() => {});

    const NotificationMock = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.close = vi.fn();
      this.onclick = null;
    });
    Object.assign(NotificationMock, {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: NotificationMock,
    });
  });

  it('is disabled by default and does not notify', () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    expect(result.current.newNodeNotificationsEnabled).toBe(false);

    act(() => {
      result.current.handleNewNodeEvent(singlePayload());
    });

    expect(window.Notification).not.toHaveBeenCalled();
  });

  it('requests permission and enables on first opt-in, defaulting to all types', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    expect(result.current.newNodeNotificationsEnabled).toBe(true);
    expect(result.current.newNodeNotificationTypes).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(mocks.toast.success).toHaveBeenCalledWith('New node notifications enabled');
  });

  it('shows a single-node notification with the contact type label and deep-links on click', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    act(() => {
      result.current.handleNewNodeEvent(singlePayload());
    });

    expect(window.Notification).toHaveBeenCalledWith('New node: Alice', {
      body: 'Repeater - first heard on this mesh',
      icon: './favicon-256x256.png',
      tag: `meshcore-new-node-${'aa'.repeat(32)}`,
    });

    const instance = (window.Notification as unknown as ReturnType<typeof vi.fn>).mock
      .instances[0] as {
      onclick: (() => void) | null;
      close: ReturnType<typeof vi.fn>;
    };

    act(() => {
      instance.onclick?.();
    });

    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#contact/${'aa'.repeat(32)}/Alice`,
      '_self'
    );
    expect(instance.close).toHaveBeenCalledTimes(1);
  });

  it('filters a single-node event out when its type is unchecked', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    act(() => {
      result.current.setNewNodeNotificationType(2, false); // uncheck repeaters
    });

    act(() => {
      result.current.handleNewNodeEvent(singlePayload({ type: 2 }));
    });
    expect(window.Notification).not.toHaveBeenCalled();

    act(() => {
      result.current.handleNewNodeEvent(singlePayload({ type: 4, public_key: 'bb'.repeat(32) }));
    });
    expect(window.Notification).toHaveBeenCalledTimes(1);
  });

  it('shows a batch summary counting only the enabled types', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    act(() => {
      result.current.setNewNodeNotificationType(4, false); // sensors off; repeaters stay on
    });

    act(() => {
      // 2 repeaters + 1 sensor in the batch, but sensors are filtered out here.
      result.current.handleNewNodeEvent(batchPayload());
    });

    expect(window.Notification).toHaveBeenCalledWith('2 new nodes', {
      body: 'First heard on this mesh',
      icon: './favicon-256x256.png',
      tag: 'meshcore-new-node-batch',
    });
  });

  it('suppresses a batch entirely when none of its types are enabled', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    act(() => {
      result.current.setNewNodeNotificationType(2, false);
      result.current.setNewNodeNotificationType(4, false);
    });

    act(() => {
      result.current.handleNewNodeEvent(batchPayload()); // only types 2 and 4
    });

    expect(window.Notification).not.toHaveBeenCalled();
  });

  it('a batch notification click clears the hash and focuses the window instead of opening a contact', async () => {
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    act(() => {
      result.current.handleNewNodeEvent(batchPayload());
    });

    const instance = (window.Notification as unknown as ReturnType<typeof vi.fn>).mock
      .instances[0] as {
      onclick: (() => void) | null;
      close: ReturnType<typeof vi.fn>;
    };

    act(() => {
      instance.onclick?.();
    });

    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}`,
      '_self'
    );
  });

  it('shows a blocked-notifications toast instead of enabling when permission is denied', async () => {
    Object.assign(window.Notification, { permission: 'denied' });
    const { result } = renderHook(() => useNewNodeNotifications());

    await act(async () => {
      await result.current.setNewNodeNotificationsEnabled(true);
    });

    expect(result.current.newNodeNotificationsEnabled).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith('Notifications blocked', {
      description:
        'Desktop notifications are blocked by your browser. Allow notifications in browser settings, then try again.',
    });
  });

  it('persists the enabled flag and type selection across hook instances', async () => {
    const first = renderHook(() => useNewNodeNotifications());
    await act(async () => {
      await first.result.current.setNewNodeNotificationsEnabled(true);
    });
    act(() => {
      first.result.current.setNewNodeNotificationType(3, false);
    });

    const second = renderHook(() => useNewNodeNotifications());
    expect(second.result.current.newNodeNotificationsEnabled).toBe(true);
    expect(second.result.current.newNodeNotificationTypes).not.toContain(3);
  });
});
