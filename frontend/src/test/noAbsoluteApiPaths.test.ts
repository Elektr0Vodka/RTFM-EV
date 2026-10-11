import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// The app runs under a sub-path (a reverse proxy prefix, or /r/<key>/ in
// multi-radio mode), so every API call must be relative ('./api/...'). An
// absolute '/api/...' leaves the sub-path and reaches the wrong server.
const ABSOLUTE_API = /['"`]\/api\//;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

describe('API paths', () => {
  it('are never absolute', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
          if (ABSOLUTE_API.test(line)) offenders.push(`${relative(root, file)}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
