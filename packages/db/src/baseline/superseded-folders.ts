import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../../../..');
const migrationsPath = 'packages/db/migrations';

/**
 * The migration folders the baseline replaced, written out from git as
 * they were committed at `commit`: every folder up to and including
 * `cutoff`. Building a database from them is building it the old way.
 * Development and tests only; the image ships no superseded folder.
 */
export async function supersededFolders({
  commit,
  cutoff,
}: {
  readonly commit: string;
  readonly cutoff: string;
}): Promise<{ readonly folder: string; readonly close: () => Promise<void> }> {
  const scratch = await mkdtemp(join(tmpdir(), 'daisy-superseded-'));
  await Bun.$`git -C ${repository} archive --format=tar ${commit} -- ${migrationsPath} | tar -x -C ${scratch}`.quiet();
  const folder = join(scratch, migrationsPath);
  const entries = await readdir(folder);
  if (!entries.includes(cutoff))
    throw new Error(`${commit} holds no migration folder ${cutoff}`);
  for (const entry of entries)
    if (entry > cutoff)
      await rm(join(folder, entry), { recursive: true, force: true });
  return {
    folder,
    close: () => rm(scratch, { recursive: true, force: true }),
  };
}
