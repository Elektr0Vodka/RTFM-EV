import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WardriveApiError, wardriveApi } from '../../wardrive/api';
import type { ObsMessage, TrackMessage } from '../../wardrive/messages';
import { openQueue, type Queue } from '../../wardrive/queue';
import { Uploader, localDest } from '../../wardrive/uploader';

const A = 'AA'.repeat(32);
const B = 'BB'.repeat(32);
let n = 0;
let queue: Queue;

const obs = (key: string, rxAt: string): ObsMessage => ({
  v: 1,
  origin_id: key,
  rx_at: rxAt,
  hash: '0123456789abcdef',
  raw: '15000102',
  len: 4,
  packet_type: 5,
  payload_len: 2,
  path: [],
  pos: { lat: 52, lon: 5, src: 'phone' },
});

const track = (key: string, t0: string): TrackMessage => ({
  v: 1,
  origin_id: key,
  t0,
  t1: t0,
  lat: 52,
  lon: 5,
  rx_count: 0,
  listening: true,
  src: 'phone',
});

const OK = { accepted_obs: 1, duplicate_obs: 0, accepted_tracks: 0, duplicate_tracks: 0 };

/** An uploader for an account with `radios` (null: nobody logged in). */
function make(radios: string[] | null = [A, B], destsFor?: (key: string) => string[]) {
  return new Uploader(
    queue,
    wardriveApi,
    { batch: 200, intervalMs: 10000 },
    destsFor,
    () => radios
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  queue = await openQueue(`uploader-${n++}`);
});

describe('wardrive uploader', () => {
  it('uploads obs then tracks and moves the watermark', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    await queue.addTrack(A, track(A, 't1'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    const status = await make().tick();
    expect(upload.mock.calls.map((c) => [c[0].obs.length, c[0].tracks.length])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(status).toMatchObject({ state: 'idle', pendingObs: 0, pendingTracks: 0 });
  });

  it('keeps rows and reports offline on a network error, then catches up', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    const upload = vi
      .spyOn(wardriveApi, 'upload')
      .mockRejectedValueOnce(new WardriveApiError('offline', 0))
      .mockResolvedValue(OK);
    const up = make();
    expect(await up.tick()).toMatchObject({ state: 'offline', pendingObs: 1 });
    expect(await up.tick()).toMatchObject({ state: 'idle', pendingObs: 0 });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('keeps rows on a server error', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    vi.spyOn(wardriveApi, 'upload').mockRejectedValue(new WardriveApiError('boom', 503));
    expect(await make().tick()).toMatchObject({
      state: 'error',
      pendingObs: 1,
      lastError: 'boom',
    });
  });

  it('pauses on 401 without acking', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    vi.spyOn(wardriveApi, 'upload').mockRejectedValue(new WardriveApiError('no', 401));
    expect(await make().tick()).toMatchObject({ state: 'logged-out', pendingObs: 1 });
  });

  it('sets aside a batch the server refuses with 422 and goes on', async () => {
    await queue.addObs(A, obs(A, 'bad'));
    await queue.addObs(B, obs(B, 'good'));
    const upload = vi
      .spyOn(wardriveApi, 'upload')
      .mockRejectedValueOnce(new WardriveApiError('bad row', 422))
      .mockResolvedValue(OK);
    const up = make();
    expect(await up.tick()).toMatchObject({ setAside: 1, pendingObs: 1 });
    expect(await up.tick()).toMatchObject({ state: 'idle', setAside: 1, pendingObs: 0 });
    expect(upload.mock.calls.map((c) => c[0].radio_key)).toEqual([A, B]);
  });

  it('keeps rows on 403 and asks the page to read the account again', async () => {
    await queue.addObs(A, obs(A, 'o1'));
    vi.spyOn(wardriveApi, 'upload').mockRejectedValue(
      new WardriveApiError('This radio is not on your account', 403)
    );
    const refresh = vi.fn();
    const up = new Uploader(queue, wardriveApi, undefined, undefined, () => [A], refresh);
    expect(await up.tick()).toMatchObject({ state: 'error', setAside: 0, pendingObs: 1 });
    expect(await up.tick()).toMatchObject({ setAside: 0, pendingObs: 1 });
    expect(refresh).toHaveBeenCalled();
  });

  it('counts only receptions of other accounts', async () => {
    await queue.addObs(B, obs(B, 'b1'));
    await queue.addTrack(B, track(B, 'b1'));
    vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    expect(await make([A]).tick()).toMatchObject({ otherAccounts: 1 });
  });

  it.each([404, 408, 429])('keeps rows and retries after %i', async (status) => {
    await queue.addObs(A, obs(A, 'o1'));
    const upload = vi
      .spyOn(wardriveApi, 'upload')
      .mockRejectedValueOnce(new WardriveApiError('later', status))
      .mockResolvedValue(OK);
    const up = make();
    expect(await up.tick()).toMatchObject({ state: 'error', setAside: 0, pendingObs: 1 });
    expect(await up.tick()).toMatchObject({ state: 'idle', setAside: 0, pendingObs: 0 });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('sends one drive per call with its drive uid', async () => {
    await queue.addObs(A, obs(A, 'a1'), 1, 'x');
    await queue.addObs(A, obs(A, 'a2'), 2, 'x');
    await queue.addObs(A, obs(A, 'a3'), 3);
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    await make().tick();
    expect(upload.mock.calls.map((c) => [c[0].obs.length, c[0].drive_uid])).toEqual([
      [2, 'x'],
      [1, undefined],
    ]);
    // The messages go as they are: the uid is beside them, never in them.
    expect(upload.mock.calls[0][0].obs[0]).toEqual(obs(A, 'a1'));
  });

  it('sends one radio per call', async () => {
    await queue.addObs(A, obs(A, 'a1'));
    await queue.addObs(B, obs(B, 'b1'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    await make().tick();
    expect(upload.mock.calls.map((c) => c[0].radio_key)).toEqual([A, B]);
  });

  it('prunes rows every destination has acked once they are a week old', async () => {
    const DAY = 86400000;
    await queue.addObs(A, obs(A, 'old'), Date.now() - 8 * DAY);
    vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    const prune = vi.spyOn(queue, 'prune');
    const destsFor = (key: string) => [localDest(key)];
    await make([A, B], destsFor).tick();
    expect(prune).toHaveBeenCalledWith(7, destsFor, expect.any(Number), expect.any(Function));
    expect(await queue.batch('other', 'obs', 10)).toEqual([]);
  });

  it('uploads only the radios on the account and leaves the others waiting', async () => {
    await queue.addObs(B, obs(B, 'other account'));
    await queue.addObs(A, obs(A, 'own'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    const status = await make([A]).tick();
    expect(upload.mock.calls.map((c) => c[0].radio_key)).toEqual([A]);
    expect(status).toMatchObject({ state: 'idle', setAside: 0, pendingObs: 0, otherAccounts: 1 });
  });

  it('uploads a waiting radio once its own account logs in', async () => {
    await queue.addObs(B, obs(B, 'b1'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    let radios: string[] | null = [A];
    const up = new Uploader(queue, wardriveApi, undefined, undefined, () => radios);
    await up.tick();
    expect(upload).not.toHaveBeenCalled();
    radios = [B];
    expect(await up.tick()).toMatchObject({ pendingObs: 0, otherAccounts: 0 });
    expect(upload.mock.calls.map((c) => c[0].radio_key)).toEqual([B]);
  });

  it('logged out it sends nothing and says so while rows wait', async () => {
    await queue.addObs(A, obs(A, 'a1'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    expect(await make(null).tick()).toMatchObject({
      state: 'logged-out',
      pendingObs: 1,
      reached: null,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts a radio key in either case', async () => {
    await queue.addObs(A, obs(A, 'a1'));
    const upload = vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    await make([A.toLowerCase()]).tick();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('prunes week-old rows of other accounts, but not while logged out', async () => {
    const DAY = 86400000;
    await queue.addObs(B, obs(B, 'old, other account'), Date.now() - 8 * DAY);
    vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    await make(null).tick();
    expect(await queue.countForRadio(localDest(B), 'obs', B)).toBe(1);
    await make([A]).tick();
    expect(await queue.countForRadio(localDest(B), 'obs', B)).toBe(0);
  });

  it('prunes at most once an hour', async () => {
    vi.spyOn(wardriveApi, 'upload').mockResolvedValue(OK);
    const prune = vi.spyOn(queue, 'prune');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const up = make();
    await up.tick();
    await up.tick();
    expect(prune).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(1_000_000_000_000 + 3600_000);
    await up.tick();
    expect(prune).toHaveBeenCalledTimes(2);
  });
});
