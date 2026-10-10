import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Read from disk, not through Vite, so the test sees the files as written.
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

// index.css keeps Tailwind 3's space-x/space-y behaviour: one rule cancels
// Tailwind 4's own margins for every class that contains "space-x-" or
// "space-y-", and one rule per class puts the Tailwind 3 margin back. A class
// without its own rule therefore gets no gap at all (this happened to
// sm:space-x-2 on the dialog footer), so every class used in the source must
// have one.
const srcDir = resolve(process.cwd(), 'src');
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('test/'))
    .map((file) => [file, readFileSync(resolve(srcDir, file), 'utf8')])
);

const SPACE_CLASS = /(?<![\w-])((?:[a-z0-9-]+:)*space-[xy]-[\w.[\]%-]+)/g;

function usedSpaceClasses(): Map<string, string> {
  const used = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(SPACE_CLASS)) {
      if (!used.has(match[1])) used.set(match[1], file);
    }
  }
  return used;
}

function restoreSelector(className: string): string {
  return `.${className.replace(/[:.[\]%]/g, '\\$&')} > :not([hidden]) ~ :not([hidden])`;
}

describe('Tailwind 3 space-* compatibility rules', () => {
  it('sees the space classes in the source', () => {
    const used = usedSpaceClasses();
    expect(indexCss).toContain('.space-y-2 > :not([hidden]) ~ :not([hidden])');
    expect(used.has('space-y-2')).toBe(true);
    expect(used.has('sm:space-x-2')).toBe(true);
  });

  it('has a restore rule in index.css for every space class in use', () => {
    const missing = [...usedSpaceClasses()]
      .filter(([className]) => !indexCss.includes(restoreSelector(className)))
      .map(([className, file]) => `${className} (${file})`);
    expect(missing).toEqual([]);
  });
});

// Tailwind 4 reads class names out of the source as whole tokens. A class that
// touches a `${` in a template string is not seen and gets no CSS (this
// happened to bg-black/10 on the corrupt-message avatar). Use cn() or put a
// space before the placeholder.
describe('class names Tailwind 4 can see', () => {
  it('has no class glued to a template placeholder in a className', () => {
    const glued = /className=\{`[^`]*[A-Za-z0-9\]]\$\{/;
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, index) => (glued.test(line) ? `${file}:${index + 1}` : null))
        .filter((hit): hit is string => hit !== null)
    );
    expect(offenders).toEqual([]);
  });
});
