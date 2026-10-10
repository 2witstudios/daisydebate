/** Content comparison and private scratch for explicit pipeline distribution. */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

/** Replace installed links with local copies; never write into a source checkout. */
export function installPipelineSkill(
  path: string,
  desired: string,
  before: string,
): void {
  const unchanged = () => {
    const current = lstatSync(path, { throwIfNoEntry: false })
      ? readFileSync(path, 'utf8')
      : '';
    if (current !== before)
      throw new Error(
        'Installed pipeline skill changed; retry after reading current state',
      );
  };
  unchanged();
  const directory = dirname(path);
  if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) {
    const scratch = mkdtempSync(join(dirname(directory), '.pipeline-install-'));
    try {
      const copy = join(scratch, 'skill');
      cpSync(realpathSync(directory), copy, {
        recursive: true,
        dereference: true,
      });
      unchanged();
      rmSync(directory);
      renameSync(copy, directory);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  mkdirSync(directory, { recursive: true });
  unchanged();
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    rmSync(path);
  writeFileSync(path, desired);
  if (readFileSync(path, 'utf8') !== desired)
    throw new Error('Installed pipeline skill readback differs');
}
