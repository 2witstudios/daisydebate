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
import { dirname, join, relative, resolve } from 'node:path';

// Only block-to-block boundaries are layout whitespace; inline spaces are text.
export const canonicalPipeline = (text: string): string =>
  text
    .trim()
    .replace(
      /(<\/?(?:h[1-6]|p|ul|ol|li|div|section|article)\b[^>]*>)\s+(?=<\/?(?:h[1-6]|p|ul|ol|li|div|section|article)\b)/gi,
      '$1',
    );

/** Find the highest directory link within the caller's allocated install root. */
function linkedPipelineDirectory(
  path: string,
  installedRoot: string,
): string | undefined {
  const root = resolve(installedRoot);
  const directory = resolve(dirname(path));
  const offset = relative(root, directory);
  if (offset === '..' || offset.startsWith('../'))
    throw new Error('Pipeline target is outside its installed root');
  let linked: string | undefined;
  for (let current = directory; ; current = dirname(current)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      linked = current;
    if (current === root) return linked;
  }
}

function detachPipelineDirectory(linked: string, unchanged: () => void): void {
  const scratch = mkdtempSync(join(dirname(linked), '.pipeline-install-'));
  try {
    const copy = join(scratch, 'installed');
    cpSync(realpathSync(linked), copy, { recursive: true, dereference: true });
    unchanged();
    rmSync(linked);
    renameSync(copy, linked);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Equal text still needs installation when cleanup would follow a checkout link. */
export function pipelineSkillNeedsInstall(
  path: string,
  desired: string,
  installedRoot: string,
): boolean {
  const info = lstatSync(path, { throwIfNoEntry: false });
  return (
    !info ||
    info.isSymbolicLink() ||
    readFileSync(path, 'utf8') !== desired ||
    linkedPipelineDirectory(path, installedRoot) !== undefined
  );
}

export function retirePipelineReference(
  path: string,
  apply: boolean,
  installedRoot: string,
): boolean {
  if (!lstatSync(path, { throwIfNoEntry: false })) return false;
  if (apply) {
    const linked = linkedPipelineDirectory(path, installedRoot);
    if (linked) detachPipelineDirectory(linked, () => {});
    rmSync(path, { force: true });
  }
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
  installedRoot: string,
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
  const linked = linkedPipelineDirectory(path, installedRoot);
  if (linked) detachPipelineDirectory(linked, unchanged);
  mkdirSync(directory, { recursive: true });
  unchanged();
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    rmSync(path);
  writeFileSync(path, desired);
  if (readFileSync(path, 'utf8') !== desired)
    throw new Error('Installed pipeline skill readback differs');
}
