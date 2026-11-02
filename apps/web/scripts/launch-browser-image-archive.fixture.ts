import { afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchImageIdentity } from '../e2e/support/launch-browser-image-policy';

/** Owned temporary directories for one test file, removed when it ends. */
export function createScratch() {
  const directories: string[] = [];
  afterAll(() =>
    Promise.all(
      directories.map((path) => rm(path, { recursive: true, force: true })),
    ),
  );
  return async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daisy-archive-test-'));
    directories.push(directory);
    return directory;
  };
}
/** Inspect metadata of a verified upstream base. */
export const launchBaseMetadata = (
  image: ReturnType<typeof launchImageIdentity>,
  id: string,
) => ({
  Id: id,
  Os: 'linux',
  Architecture: 'arm64',
  RootFS: { Layers: image.native.layers },
  Config: {
    Env: image.environment.slice(0, 4),
    Cmd: ['/bin/bash'],
    Labels: image.baseLabels,
  },
});
export const sha = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
