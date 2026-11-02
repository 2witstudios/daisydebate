import { afterAll } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createLaunchPreparationProcess,
  restoreLaunchImageArchive,
  saveLaunchImageArchive,
} from '../e2e/support/launch-browser-image';
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
      'Launch image archive refused: unknown-object',
    ],
    [
      'a daemon ID from the wrong descriptor',
      { ...closed, ...legacy },
      manifest,
      'Launch image archive refused: daemon-identity',
    ],
    [
      'a foreign root object',
      { ...closed, payload: 'x' },
      config,
      'Launch image archive refused: inventory',
    ],
  ];
  for (const [given, entries, id, message] of attempts) {
    const directory = await scratch();
    const { owner } = fakeDocker(tarOf(entries));
    const failure = await saveLaunchImageArchive(
      owner,
      image,
      id,
      directory,
    ).then(
      () => 'saved',
      (error: Error) => error.message,
    );
    assert({
      given,
      should: 'refuse explicitly with no published or temporary file',
      actual: [failure, await readdir(directory)],
      expected: [message, []],
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
