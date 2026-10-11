import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type PushHandler = (event: {
  data: { json: () => unknown; text: () => string };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

const KEY = '0d1d00147f96';
const TWO_RADIOS = [
  { id: 1, name: '868 MHz', url_key: KEY },
  { id: 2, name: '433 MHz', url_key: 'b1b2b3b4b5b6' },
];

async function push(scope: string, data: Record<string, unknown>) {
  const handlers = new Map<string, PushHandler>();
  const showNotification = vi.fn(async () => undefined);
  const worker = {
    registration: { scope, showNotification },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, handler: PushHandler) => {
      handlers.set(type, handler);
    }),
  };
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  new Function('self', 'clients', source)(worker, { claim: vi.fn() });

  let lifetime: Promise<unknown> | undefined;
  handlers.get('push')?.({
    data: { json: () => data, text: () => '' },
    waitUntil: (promise) => {
      lifetime = promise;
    },
  });
  expect(lifetime).toBeDefined();
  await lifetime;
  expect(showNotification).toHaveBeenCalledTimes(1);
  const [title, options] = showNotification.mock.calls[0] as unknown as [string, { tag: string }];
  return { title, tag: options.tag };
}

function stubRadios(reply: () => Promise<Response>) {
  const fetchMock = vi.fn((_url: unknown, _init?: unknown) => reply());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('service worker push notifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the title and makes the tag unique per scope outside multi-radio mode', async () => {
    const fetchMock = stubRadios(json(TWO_RADIOS));
    const shown = await push('https://x.test/meshcore/', {
      title: 'Alice',
      body: 'hi',
      tag: 'meshcore-abc',
    });
    expect(shown.title).toBe('Alice');
    expect(shown.tag).toBe('https://x.test/meshcore/|meshcore-abc');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives two workspaces different tags for the same conversation', async () => {
    stubRadios(json([]));
    const a = await push(`https://x.test/r/${KEY}/`, { title: 'Public', tag: 'meshcore-chan' });
    const b = await push('https://x.test/r/b1b2b3b4b5b6/', {
      title: 'Public',
      tag: 'meshcore-chan',
    });
    expect(a.tag).not.toBe(b.tag);
  });

  it('puts the radio name in front when the gateway lists several radios', async () => {
    const fetchMock = stubRadios(json(TWO_RADIOS));
    const shown = await push(`https://x.test/mesh/r/${KEY}/`, { title: 'Alice' });
    expect(shown.title).toBe('[868 MHz] Alice');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://x.test/mesh/gateway/api/radios');
  });

  it('adds no label with a single radio', async () => {
    stubRadios(json([TWO_RADIOS[0]]));
    const shown = await push(`https://x.test/r/${KEY}/`, { title: 'Alice' });
    expect(shown.title).toBe('Alice');
  });

  it('still shows the notification when the gateway cannot be asked', async () => {
    stubRadios(async () => {
      throw new Error('offline');
    });
    expect((await push(`https://x.test/r/${KEY}/`, { title: 'Alice' })).title).toBe('Alice');

    stubRadios(json({ detail: 'Unauthorized' }, 401));
    expect((await push(`https://x.test/r/${KEY}/`, { title: 'Alice' })).title).toBe('Alice');
  });
});
