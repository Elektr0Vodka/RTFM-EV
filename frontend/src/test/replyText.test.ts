import { describe, it, expect } from 'vitest';
import { buildReplyText } from '../utils/replyText';

describe('buildReplyText', () => {
  it('quotes the first 10 characters with ".." when longer', () => {
    expect(buildReplyText('Bob', 'instellingen - standaard')).toBe('@[Bob]\n>instelling..\n');
  });

  it('quotes short messages whole without ".."', () => {
    expect(buildReplyText('Bob', 'Test')).toBe('@[Bob]\n>Test\n');
  });

  it('strips a leading mention before quoting', () => {
    expect(buildReplyText('Bob', '@[512 A] goede avond')).toBe('@[Bob]\n>goede avon..\n');
  });

  it('counts emoji as single characters, not UTF-16 units', () => {
    expect(buildReplyText('Bob', '😀😀😀😀😀😀😀😀😀😀😀')).toBe(
      '@[Bob]\n>😀😀😀😀😀😀😀😀😀😀..\n'
    );
  });
});
