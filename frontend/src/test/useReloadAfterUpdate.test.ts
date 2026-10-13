import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReloadAfterUpdate } from '../hooks/useReloadAfterUpdate';
import type { AppInfo } from '../types';
import { appReload } from '../utils/appReload';

const mocks = vi.hoisted(() => ({
  toast: { info: vi.fn() },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: mocks.toast,
}));

const LOADED: AppInfo = { version: '3.17.1-EV.0.1', commit_hash: 'aaaaaaa' };
const UPDATED: AppInfo = { version: '3.17.1-EV.0.1', commit_hash: 'bbbbbbb' };

function renderWith(initial: AppInfo | null | undefined) {
  return renderHook(
    ({ appInfo }: { appInfo: AppInfo | null | undefined }) => useReloadAfterUpdate(appInfo),
    { initialProps: { appInfo: initial } }
  );
}

describe('useReloadAfterUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says nothing while the server stays on the version the page was loaded from', () => {
    const { rerender } = renderWith(undefined);
    rerender({ appInfo: LOADED });
    rerender({ appInfo: { ...LOADED } });
    rerender({ appInfo: null });
    rerender({ appInfo: LOADED });

    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it('offers a reload once when the server runs another build', () => {
    const reload = vi.spyOn(appReload, 'now').mockImplementation(() => {});
    const { rerender } = renderWith(LOADED);

    rerender({ appInfo: UPDATED });
    rerender({ appInfo: { ...UPDATED } });

    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
    const [title, options] = mocks.toast.info.mock.calls[0];
    expect(title).toBe('The server was updated');
    expect(options.description).toBe('Reload to use the new version.');
    // It stays until answered: on a phone there is no other way to reload.
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe('Reload');

    options.action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
    reload.mockRestore();
  });

  it('also notices a new version number', () => {
    const { rerender } = renderWith(LOADED);

    rerender({ appInfo: { ...LOADED, version: '3.18.0-EV.0.1' } });

    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
  });
});
