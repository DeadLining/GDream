// Shared helper for tests that need to match against CSS source.
// Reads globals.css + all styles/*.css files (sorted) so tests can use regex
// matching regardless of how globals.css is split into domain files.
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';

export function readAllStyles(): string {
  const parts: string[] = [];
  parts.push(readFileSync(resolve(process.cwd(), 'app/tokens.css'), 'utf8'));
  parts.push(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'));
  const stylesDir = resolve(process.cwd(), 'app/styles');
  const files = readdirSync(stylesDir).filter(f => f.endsWith('.css')).sort();
  for (const f of files) {
    parts.push(readFileSync(resolve(stylesDir, f), 'utf8'));
  }
  return parts.join('\n');
}
