import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Rename = { readonly from: string; readonly to: string };
type Update = {
  readonly path: string;
  readonly before: string;
  readonly after: string;
};
type Files = {
  readonly read: (path: string) => string;
  readonly write: (path: string, text: string) => void;
  readonly rename: (from: string, to: string) => void;
};
const filesystem: Files = {
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, text) => {
    if ((statSync(path).mode & 0o222) === 0)
      throw new Error(`Pending proof is read-only: ${path}`);
    writeFileSync(path, text);
  },
  rename: (from, to) => renameSync(from, to),
};

/** Restore each attempted write and completed move independently on failure. */
export function applyPendingPreparation(
  cwd: string,
  renames: readonly Rename[],
  updates: readonly Update[],
  files: Files = filesystem,
) {
  const moved: Rename[] = [];
  const attempted: Update[] = [];
  try {
    for (const rename of renames) {
      files.rename(join(cwd, rename.from), join(cwd, rename.to));
      moved.push(rename);
    }
    for (const update of updates) {
      attempted.push(update);
      files.write(join(cwd, update.path), update.after);
    }
  } catch (cause) {
    const failed: string[] = [];
    for (const update of attempted.reverse()) {
      try {
        const path = join(cwd, update.path);
        if (files.read(path) !== update.before)
          files.write(path, update.before);
        if (files.read(path) !== update.before) failed.push(update.path);
      } catch {
        failed.push(update.path);
      }
    }
    for (const rename of moved.reverse()) {
      try {
        files.rename(join(cwd, rename.to), join(cwd, rename.from));
      } catch {
        failed.push(`${rename.to} -> ${rename.from}`);
      }
    }
    if (failed.length)
      throw new Error(
        `Pending preparation failed; restoration incomplete: ${failed.join(', ')}`,
        { cause },
      );
    throw new Error(
      'Pending preparation failed; all completed changes restored',
      { cause },
    );
  }
}
