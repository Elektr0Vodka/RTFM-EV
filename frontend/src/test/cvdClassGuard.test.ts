import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Every hard-coded Tailwind status colour must either carry a `cvd:` partner on
// the same line (so the colourblind mode can swap it) or be marked decorative
// with a `cvd-decorative` comment on that line or the line above.
const RAW_COLOR =
  /\b(?:text|bg|border|fill|stroke)-(?:red|green|yellow|emerald|amber|lime|orange)-\d{2,3}\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('hard-coded status colours', () => {
  it('all have a cvd: partner or a cvd-decorative marker', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!RAW_COLOR.test(line) || /\bcvd:/.test(line)) return;
        if (/cvd-decorative/.test(line) || /cvd-decorative/.test(lines[i - 1] ?? '')) return;
        offenders.push(`${relative(root, file)}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
