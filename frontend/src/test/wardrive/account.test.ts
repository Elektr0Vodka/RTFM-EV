import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMe, radioState, signedRadio } from '../../wardrive/account';
import { WardriveApiError, wardriveApi } from '../../wardrive/api';
import type { Companion } from '../../wardrive/radio/companion';

const KEY = 'AB'.repeat(32);
const ME = {
  user_id: 1,
  username: 'mike',
  visibility: 'own',
  radios: [{ public_key: KEY, name: 'car' }],
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wardrive api client', () => {
  it('raises a status 0 error when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(wardriveApi.me()).rejects.toMatchObject({ status: 0 });
  });

  it('raises the server detail with its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(409, { detail: 'taken' }));
    const err = await wardriveApi.login('a', 'b').catch((e) => e);
    expect(err).toBeInstanceOf(WardriveApiError);
    expect(err).toMatchObject({ status: 409, message: 'taken' });
  });

  it('sends same-origin JSON to /api/wardrive/', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, ME));
    await wardriveApi.login('mike', 'pw');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('../api/wardrive/login');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(init?.body))).toEqual({ username: 'mike', password: 'pw' });
  });
});

describe('wardrive account', () => {
  it('signs exactly the challenge bytes and sends hex', async () => {
    vi.spyOn(wardriveApi, 'challenge').mockResolvedValue({ nonce: 'n1', message_hex: '0a0b' });
    const sign = vi.fn().mockResolvedValue(new Uint8Array(64).fill(0xcd));
    const signed = await signedRadio({ sign } as unknown as Companion, KEY);
    expect(sign).toHaveBeenCalledWith(new Uint8Array([0x0a, 0x0b]));
    expect(signed).toEqual({ public_key: KEY, nonce: 'n1', signature: 'cd'.repeat(64) });
  });

  it('uses the cached account when the server cannot be reached', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValueOnce(ME as never);
    expect(await loadMe()).toEqual({ me: ME, offline: false });
    vi.spyOn(wardriveApi, 'me').mockRejectedValueOnce(new WardriveApiError('offline', 0));
    expect(await loadMe()).toEqual({ me: ME, offline: true });
  });

  it('forgets the cached account on 401', async () => {
    vi.spyOn(wardriveApi, 'me').mockResolvedValueOnce(ME as never);
    await loadMe();
    vi.spyOn(wardriveApi, 'me').mockRejectedValueOnce(new WardriveApiError('no', 401));
    expect(await loadMe()).toEqual({ me: null, offline: false });
    vi.spyOn(wardriveApi, 'me').mockRejectedValueOnce(new WardriveApiError('offline', 0));
    expect(await loadMe()).toEqual({ me: null, offline: true });
  });

  it('reports whether the paired radio is on the account', () => {
    expect(radioState(null, KEY)).toBe('logged-out');
    expect(radioState(ME as never, KEY.toLowerCase())).toBe('on-account');
    expect(radioState(ME as never, 'CD'.repeat(32))).toBe('not-on-account');
  });
});
