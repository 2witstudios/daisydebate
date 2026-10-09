/** Content comparison and private scratch for explicit pipeline distribution. */
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Only block-to-block boundaries are layout whitespace; inline spaces are text.
export const canonicalPipeline = (text: string): string =>
  text
    .trim()
    .replace(
      /(<\/?(?:h[1-6]|p|ul|ol|li|div|section|article)\b[^>]*>)\s+(?=<\/?(?:h[1-6]|p|ul|ol|li|div|section|article)\b)/gi,
      '$1',
    );

export function retirePipelineReference(path: string, apply: boolean): boolean {
  if (!lstatSync(path, { throwIfNoEntry: false })) return false;
  if (apply) rmSync(path, { force: true });
  return true;
}

export function withPipelineFiles<T>(
  desired: string,
  before: string,
  write: (file: string, old: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), 'pipeline-'));
  const file = join(directory, 'new');
  const old = join(directory, 'old');
  try {
    writeFileSync(file, desired, { mode: 0o600, flag: 'wx' });
    writeFileSync(old, before, { mode: 0o600, flag: 'wx' });
    return write(file, old);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
