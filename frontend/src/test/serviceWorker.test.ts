import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

type ServiceWorkerHandler = (event: {
  notification: { close: () => void; data?: { url_hash?: string } };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

describe('service worker notification clicks', () => {
  it('keeps the worker alive through focus and navigation', async () => {
    const handlers = new Map<string, ServiceWorkerHandler>();
    const scope = 'https://example.test/rtfm/';
    const operationOrder: string[] = [];
    let resolveFocus!: () => void;
    let resolveNavigate!: () => void;
    const focusPromise = new Promise<void>((resolvePromise) => {
      resolveFocus = resolvePromise;
    });
    const navigatePromise = new Promise<void>((resolvePromise) => {
      resolveNavigate = resolvePromise;
    });
    const client = {
      url: `${scope}#old`,
      focus: vi.fn(() => {
        operationOrder.push('focus');
        return focusPromise;
      }),
      navigate: vi.fn(() => {
        operationOrder.push('navigate');
        return navigatePromise;
      }),
    };
    const clients = {
      claim: vi.fn(),
      matchAll: vi.fn(async () => [client]),
      openWindow: vi.fn(),
    };
    const worker = {
      registration: { scope, showNotification: vi.fn() },
      clients,
      skipWaiting: vi.fn(),
      addEventListener: vi.fn((type: string, handler: ServiceWorkerHandler) => {
        handlers.set(type, handler);
      }),
    };
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    new Function('self', 'clients', source)(worker, clients);

    let lifetime: Promise<unknown> | undefined;
    handlers.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { url_hash: '#contact/alice' } },
      waitUntil: (promise) => {
        lifetime = promise;
      },
    });

    expect(lifetime).toBeDefined();
    let lifetimeSettled = false;
    void lifetime?.then(() => {
      lifetimeSettled = true;
    });
    await Promise.resolve();
    expect(operationOrder).toEqual(['focus']);
    expect(lifetimeSettled).toBe(false);

    resolveFocus();
    await Promise.resolve();
    await Promise.resolve();
    expect(operationOrder).toEqual(['focus', 'navigate']);
    expect(lifetimeSettled).toBe(false);

    resolveNavigate();
    await lifetime;
    expect(lifetimeSettled).toBe(true);
    expect(client.navigate).toHaveBeenCalledWith(`${scope}#contact/alice`);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
});
