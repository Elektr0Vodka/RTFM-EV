import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPng, downloadBlob, getShareCapabilities, shareFile } from '../../share/shareActions';

const originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

function setSecure(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

function stubNavigator(opts: {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  clipboardWrite?: (items: ClipboardItem[]) => Promise<void>;
}) {
  vi.stubGlobal('navigator', {
    ...navigator,
    canShare: opts.canShare,
    share: opts.share,
    clipboard: opts.clipboardWrite ? { write: opts.clipboardWrite } : undefined,
  });
}

class FakeClipboardItem {
  constructor(public readonly items: Record<string, Blob>) {}
  get types() {
    return Object.keys(this.items);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSecure) Object.defineProperty(window, 'isSecureContext', originalSecure);
  else delete (window as { isSecureContext?: boolean }).isSecureContext;
});

describe('getShareCapabilities', () => {
  it('hides share and copy outside a secure context', () => {
    setSecure(false);
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    stubNavigator({ canShare: () => true, clipboardWrite: async () => {} });
    const caps = getShareCapabilities();
    expect(caps.secure).toBe(false);
    expect(caps.canShareFiles(new File([''], 'a.png'))).toBe(false);
    expect(caps.canCopyImage).toBe(false);
  });

  it('offers share and copy in a secure context when the browser supports them', () => {
    setSecure(true);
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    stubNavigator({ canShare: () => true, clipboardWrite: async () => {} });
    const caps = getShareCapabilities();
    expect(caps.secure).toBe(true);
    expect(caps.canShareFiles(new File([''], 'a.png'))).toBe(true);
    expect(caps.canCopyImage).toBe(true);
  });

  it('does not offer share when the browser cannot share files', () => {
    setSecure(true);
    stubNavigator({ canShare: () => false });
    expect(getShareCapabilities().canShareFiles(new File([''], 'a.gif'))).toBe(false);
  });
});

describe('shareFile', () => {
  it('reports a cancelled share sheet as cancelled', async () => {
    stubNavigator({ share: () => Promise.reject(new DOMException('x', 'AbortError')) });
    await expect(shareFile(new File([''], 'a.gif'), 't')).resolves.toBe('cancelled');
  });

  it('rethrows other errors', async () => {
    stubNavigator({ share: () => Promise.reject(new DOMException('x', 'NotAllowedError')) });
    await expect(shareFile(new File([''], 'a.gif'), 't')).rejects.toThrow();
  });

  it('passes the file and title to the share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await expect(shareFile(file, 'My card')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'My card' });
  });
});

describe('copyPng', () => {
  it('writes one image/png item', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboardWrite: write });
    const png = new Blob(['x'], { type: 'image/png' });
    await copyPng(png);
    const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(['image/png']);
    expect(items[0].items['image/png']).toBe(png);
  });
});

describe('downloadBlob timing', () => {
  it('keeps the URL alive long enough for slower browsers to start the download', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:y', revokeObjectURL: revoke });
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    downloadBlob(new Blob(['x']), 'card.gif');
    vi.advanceTimersByTime(1000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:y');
    vi.useRealTimers();
    spy.mockRestore();
  });
});

describe('downloadBlob', () => {
  it('clicks a download link with the filename and revokes the URL', () => {
    const create = vi.fn().mockReturnValue('blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: revoke });
    const clicked: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.download);
    });
    vi.useFakeTimers();
    downloadBlob(new Blob(['x']), 'card.png');
    vi.runAllTimers();
    vi.useRealTimers();
    spy.mockRestore();
    expect(clicked).toEqual(['card.png']);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
