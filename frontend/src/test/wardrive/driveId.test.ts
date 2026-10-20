import { describe, expect, it } from 'vitest';

import { DriveIds, newDriveUid } from '../../wardrive/driveId';

// The server's pattern for a drive uid (app/wardrive/models.py UploadBody).
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('drive ids', () => {
  it('makes uids the server accepts', () => {
    const a = newDriveUid();
    expect(a).toMatch(UID);
    expect(newDriveUid()).not.toBe(a);
  });

  it('makes uids without randomUUID too', () => {
    const saved = crypto.randomUUID;
    try {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      expect(newDriveUid()).toMatch(UID);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: saved, configurable: true });
    }
  });

  it('keeps one uid until a gap of more than ten minutes', () => {
    let n = 0;
    const ids = new DriveIds(600000, () => `uid-${n++}`);
    const first = ids.current(0);
    expect(ids.current(600000)).toBe(first);
    expect(ids.current(1200000)).toBe(first);
    expect(ids.current(1800001)).not.toBe(first);
  });
});
