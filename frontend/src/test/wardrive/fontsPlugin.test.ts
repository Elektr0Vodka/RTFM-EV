import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { wardriveFonts } from '../../wardrive/bundling/fonts';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

describe('wardrive build fonts', () => {
  it('points CSS font URLs at the copies under /wardrive/fonts/', () => {
    const plugin = wardriveFonts(path.resolve(process.cwd(), 'public/fonts'));
    const transform = plugin.transform as Hook;
    const css = "@font-face { src: url('/fonts/a.woff2') format('woff2'); }";
    const out = transform.call({}, css, '/x/src/index.css') as { code: string } | string;
    const code = typeof out === 'string' ? out : out.code;
    expect(code).toContain("url('../fonts/a.woff2')");
    expect(code).not.toContain("url('/fonts/");
  });

  it('leaves other files alone', () => {
    const plugin = wardriveFonts(path.resolve(process.cwd(), 'public/fonts'));
    const transform = plugin.transform as Hook;
    expect(transform.call({}, "const u = url('/fonts/a.woff2')", '/x/src/a.ts')).toBeNull();
  });

  it('ships the fonts with the page build', () => {
    const plugin = wardriveFonts(path.resolve(process.cwd(), 'public/fonts'));
    const emitFile = vi.fn();
    (plugin.generateBundle as Hook).call({ emitFile }, {}, {});
    const names = emitFile.mock.calls.map((c) => (c[0] as { fileName: string }).fileName);
    expect(names).toContain('fonts/figtree-latin.woff2');
    expect(emitFile.mock.calls[0][0]).toMatchObject({ type: 'asset' });
  });
});
