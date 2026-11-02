import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The hanq-back package root, found by walking up from the compiled file (works from src/ and dist/). */
export function projectRoot(from: string = __dirname): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'hanq-back') return dir;
      } catch {
        /* keep walking */
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('hanq-back package root not found');
}
