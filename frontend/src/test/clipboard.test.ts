import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../utils/clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

function setExecCommand(impl: (cmd: string) => boolean) {
  const fn = vi.fn(impl);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fn });
  return fn;
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
  else delete (document as { execCommand?: unknown }).execCommand;
});

describe('copyText', () => {
  it('uses the async clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const exec = setExecCommand(() => true);

    await copyText('f13e,ae92');

    expect(writeText).toHaveBeenCalledWith('f13e,ae92');
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the clipboard API is missing (plain http)', async () => {
    setClipboard(undefined);
    let copied = '';
    const exec = setExecCommand(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });

    await copyText('f13e,ae92');

    expect(exec).toHaveBeenCalledWith('copy');
    expect(copied).toBe('f13e,ae92');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to execCommand when the clipboard API refuses', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    const exec = setExecCommand(() => true);

    await copyText('112233');

    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('rejects when neither way can copy', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);

    await expect(copyText('aa')).rejects.toThrow();
  });
});
