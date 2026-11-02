import { afterAll } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { acquireLaunchBase } from '../e2e/support/launch-browser-image-build';
import {
  cacheLaunchImage,
  restoreLaunchImageArchive,
  saveLaunchImageArchive,
} from '../e2e/support/launch-browser-image-cache';
import { createLaunchPreparationProcess } from '../e2e/support/launch-browser-image-process';
import { readLaunchArchiveInventory } from '../e2e/support/launch-browser-image-archive';
import {
  blob,
  classicExport,
  sha,
  tarOf,
} from './launch-browser-image-archive.fixture';

setupRitewayBun();
const directories: string[] = [];
const scratch = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-archive-flow-'));
  directories.push(directory);
  return directory;
};
afterAll(() =>
  Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  ),
);

/** Real producer and restore, with only the Docker CLI boundary replaced. */
function fakeDocker(saved: Buffer) {
  const calls: string[][] = [];
  const process = createLaunchPreparationProcess();
  process.close();
  const owner: typeof process = {
    ...process,
    run: async (args) => {
      calls.push([...args]);
      if (args[1] === 'save') await Bun.write(args[3]!, saved);
      return { code: args[1] === 'save' ? 0 : 1, stdout: '' };
    },
  };
  return { owner, calls };
}
const loads = (calls: readonly string[][]) =>
  calls.filter((args) => args[1] === 'load').length;

test('a real classic export is saved closed and reaches load exactly once', async () => {
  const { image, closed, legacy, config, manifest } = classicExport();
  const directory = await scratch();
  const { owner, calls } = fakeDocker(tarOf({ ...closed, ...legacy }));
  await saveLaunchImageArchive(owner, image, config, directory);
  const published = (await readLaunchArchiveInventory(
    join(directory, 'image.tar'),
    () => undefined,
  ))!;
  assert({
    given: 'an exporter archive with its exact V1 and repositories objects',
    should:
      'publish only the closed archive, its exact receipt and no temp file',
    actual: {
      files: (await readdir(directory)).sort(),
      legacy: published.filter(({ name }) => name in legacy).length,
      receipt: await Bun.file(join(directory, 'receipt.json')).json(),
    },
    expected: {
      files: ['image.tar', 'receipt.json'],
      legacy: 0,
      receipt: {
        format: 2,
        key: image.key,
        store: 'overlay2',
        id: config,
        config,
        manifest,
      },
    },
  });
  assert({
    given: 'that published archive',
    should: 'pass every preflight and attempt one Docker load',
    actual: [
      await restoreLaunchImageArchive(owner, image, directory),
      loads(calls),
    ],
    expected: [null, 1],
  });
});

test('a refused export publishes nothing and leaves no temporary archive', async () => {
  const { image, closed, legacy, config, manifest } = classicExport();
  const attempts: [
    string,
    Record<string, string | Uint8Array>,
    string,
    string,
  ][] = [
    [
      'an unknown extra object',
      { ...closed, ...legacy, [blob(sha('x'))]: 'x' },
      config,
      'unknown-object',
    ],
    [
      'a daemon ID from the wrong descriptor',
      { ...closed, ...legacy },
      manifest,
      'daemon-identity',
    ],
    ['a foreign root object', { ...closed, payload: 'x' }, config, 'inventory'],
  ];
  for (const [given, entries, id, reason] of attempts) {
    const directory = await scratch();
    const { owner } = fakeDocker(tarOf(entries));
    const outcome = await saveLaunchImageArchive(owner, image, id, directory);
    assert({
      given,
      should: 'return its refusal with no published or temporary file',
      actual: [outcome, await readdir(directory)],
      expected: [{ saved: false, reason }, []],
    });
  }
});

test('restore has no raw fallback: unprojected exports never reach Docker', async () => {
  const { image, closed, legacy, config, manifest } = classicExport();
  const directory = await scratch();
  await Bun.write(
    join(directory, 'image.tar'),
    tarOf({ ...closed, ...legacy }),
  );
  await Bun.write(
    join(directory, 'receipt.json'),
    JSON.stringify({
      format: 2,
      key: image.key,
      store: 'overlay2',
      id: config,
      config,
      manifest,
    }),
  );
  const { owner, calls } = fakeDocker(Buffer.alloc(0));
  assert({
    given: 'a correctly receipted raw classic export containing legacy objects',
    should: 'refuse it with zero Docker loads',
    actual: [
      await restoreLaunchImageArchive(owner, image, directory),
      calls.length,
    ],
    expected: [null, 0],
  });
});

test('a refused cache keeps the valid image, but the deadline still stops preparation', async () => {
  const { image, closed, legacy, config } = classicExport();
  const directory = await scratch();
  const { owner } = fakeDocker(
    tarOf({ ...closed, ...legacy, [blob(sha('x'))]: 'x' }),
  );
  assert({
    given: 'an exporter output this producer does not recognize',
    should: 'report the refusal as a result, publishing nothing',
    actual: [
      await cacheLaunchImage(owner, image, config, directory),
      await readdir(directory),
    ],
    expected: [{ saved: false, reason: 'unknown-object' }, []],
  });
  const expired = {
    ...owner,
    checkpoint: () => {
      throw new Error('deadline');
    },
  };
  assert({
    given: 'the preparation deadline passing during archive work',
    should: 'still fail preparation instead of hiding it as a cache refusal',
    actual: await cacheLaunchImage(expired, image, config, directory).then(
      () => 'continued',
      (error: Error) => error.message,
    ),
    expected: 'deadline',
  });
});

test('a cache hit with no base acquires it through one verified step', async () => {
  const { image } = classicExport();
  const baseMetadata = {
    Id: image.native.config,
    Os: 'linux',
    Architecture: 'arm64',
    RootFS: { Layers: image.native.layers },
    Config: {
      Env: image.environment.slice(0, 4),
      Cmd: ['/bin/bash'],
      Labels: image.baseLabels,
    },
  };
  const daemon = (pullCode: number, pulled: unknown) => {
    const calls: string[] = [];
    let present = false;
    const process = createLaunchPreparationProcess();
    process.close();
    const owner: typeof process = {
      ...process,
      run: async (args) => {
        calls.push(args[0]!);
        if (args[0] === 'pull') {
          present = pullCode === 0;
          return { code: pullCode, stdout: '' };
        }
        return present
          ? { code: 0, stdout: JSON.stringify([pulled]) }
          : { code: 1, stdout: '' };
      },
    };
    return { owner, calls };
  };
  const failure = (owner: ReturnType<typeof daemon>['owner']) =>
    acquireLaunchBase(owner, image).then(
      () => 'acquired',
      (error: Error) => error.message,
    );
  const good = daemon(0, baseMetadata);
  assert({
    given: 'a daemon holding only the restored image, as after a cache hit',
    should: 'pull once and return the verified native identity',
    actual: [await acquireLaunchBase(good.owner, image), good.calls],
    expected: [image.native.config, ['image', 'pull', 'image']],
  });
  assert({
    given: 'an unavailable upstream',
    should: 'fail with the acquisition error',
    actual: await failure(daemon(1, baseMetadata).owner),
    expected:
      'Launch image base acquisition failed; check pinned upstream availability',
  });
  assert({
    given: 'a pulled image whose identity is not the pinned one',
    should: 'refuse it',
    actual: await failure(
      daemon(0, { ...baseMetadata, Id: sha('foreign') }).owner,
    ),
    expected: 'Launch image upstream native identity or config mismatch',
  });
});
