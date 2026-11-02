import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLaunchImageInputs } from '../e2e/support/launch-browser-image';
import { acquireLaunchBase } from '../e2e/support/launch-browser-image-build';
import {
  cacheLaunchImage,
  restoreLaunchImageArchive,
  restoreLaunchImageCache,
  saveLaunchImageArchive,
} from '../e2e/support/launch-browser-image-cache';
import {
  launchImageIdentity,
  launchArchiveFormat,
} from '../e2e/support/launch-browser-image-policy';
import { createLaunchPreparationProcess } from '../e2e/support/launch-browser-image-process';
import {
  createScratch,
  launchBaseMetadata,
  sha,
} from './launch-browser-image-archive.fixture';

setupRitewayBun();
const scratch = createScratch();
const image = launchImageIdentity({
  version: '1.63.0',
  coreVersion: '1.63.0',
  platform: 'linux/arm64',
  store: 'overlay2',
  recipe: 'recipe',
  toolchain: 'adapter',
  refresh: 'refresh',
});
const id = sha('image config');
const bytes = 'docker save output bytes';

/** Real producer and restore; only the Docker CLI boundary is replaced. */
function fakeDocker(saved: string | null = bytes) {
  const calls: string[][] = [];
  const process = createLaunchPreparationProcess();
  process.close();
  const owner: typeof process = {
    ...process,
    run: async (args) => {
      calls.push([...args]);
      if (args[1] === 'save') {
        if (saved !== null) await Bun.write(args[3]!, saved);
        return { code: 0, stdout: '' };
      }
      return { code: args[1] === 'load' ? 0 : 1, stdout: '' };
    },
  };
  return { owner, calls };
}
const captureStdout = async <T>(run: () => Promise<T>) => {
  const written: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string) => {
    written.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await run(), output: written.join('') };
  } finally {
    process.stdout.write = write;
  }
};
const loads = (calls: readonly string[][]) =>
  calls.filter((args) => args[1] === 'load').length;
const saved = async () => {
  const directory = await scratch();
  const docker = fakeDocker();
  await saveLaunchImageArchive(docker.owner, image, id, directory);
  return { directory, ...docker };
};

test('save publishes the unchanged export and an exact receipt, with no temp file', async () => {
  const { directory } = await saved();
  assert({
    given: 'a docker save output',
    should: 'keep its bytes and bind them in the receipt',
    actual: {
      files: (await readdir(directory)).sort(),
      archive: await Bun.file(join(directory, 'image.tar')).text(),
      receipt: await Bun.file(join(directory, 'receipt.json')).json(),
    },
    expected: {
      files: ['image.tar', 'receipt.json'],
      archive: bytes,
      receipt: {
        format: launchArchiveFormat,
        key: image.key,
        store: 'overlay2',
        id,
        archive: sha(bytes),
      },
    },
  });
});

test('a refused or empty save publishes nothing, so it cannot poison the key', async () => {
  for (const [given, output, reason] of [
    ['docker save writing nothing', null, 'empty-archive'],
    ['docker save writing zero bytes', '', 'empty-archive'],
  ] as const) {
    const directory = await scratch();
    const { owner } = fakeDocker(output);
    assert({
      given,
      should: 'report the refusal and leave no file to cache',
      actual: [
        await saveLaunchImageArchive(owner, image, id, directory),
        await readdir(directory),
      ],
      expected: [{ saved: false, reason }, []],
    });
  }
  const directory = await scratch();
  const failing = fakeDocker();
  const owner = {
    ...failing.owner,
    run: async () => ({ code: 1, stdout: '' }),
  };
  const refused = await captureStdout(() =>
    cacheLaunchImage(owner, image, id, directory),
  );
  assert({
    given: 'docker save failing',
    should: 'keep the valid image, annotate the refusal and publish nothing',
    actual: [
      refused.result,
      refused.output.startsWith(
        '::warning title=Launch browser image cache::cache-refused: docker-save',
      ),
      await readdir(directory),
    ],
    expected: [{ saved: false, reason: 'docker-save' }, true, []],
  });
});

test('restore verifies receipt and hash before Docker, then image identity', async () => {
  const good = await saved();
  assert({
    given: 'an exact archive whose loaded image fails validation',
    should: 'load once and reject on identity, not accept it',
    actual: [
      await restoreLaunchImageArchive(good.owner, image, good.directory),
      loads(good.calls),
    ],
    expected: [{ status: 'rejected', reason: 'identity' }, 1],
  });
  const receipt = await Bun.file(join(good.directory, 'receipt.json')).json();
  for (const [given, value] of [
    ['an older format', { ...receipt, format: launchArchiveFormat + 1 }],
    ['a foreign input key', { ...receipt, key: 'foreign' }],
    ['another store family', { ...receipt, store: 'containerd-overlayfs' }],
    ['an extra field', { ...receipt, extra: true }],
    ['a missing hash', { ...receipt, archive: undefined }],
    ['an unbounded receipt', { padding: 'x'.repeat(2048) }],
  ] as const) {
    const { directory, owner, calls } = await saved();
    await Bun.write(join(directory, 'receipt.json'), JSON.stringify(value));
    const before = loads(calls);
    assert({
      given,
      should: 'reject the receipt with no Docker load',
      actual: [
        await restoreLaunchImageArchive(owner, image, directory),
        loads(calls) - before,
      ],
      expected: [{ status: 'rejected', reason: 'receipt' }, 0],
    });
  }
  const padded = await saved();
  await Bun.write(
    join(padded.directory, 'receipt.json'),
    `${JSON.stringify(receipt)}${' '.repeat(2048)}`,
  );
  assert({
    given: 'a correct receipt past the read bound',
    should: 'refuse without parsing it',
    actual: await restoreLaunchImageArchive(
      padded.owner,
      image,
      padded.directory,
    ),
    expected: { status: 'rejected', reason: 'receipt' },
  });
  const changed = await saved();
  await Bun.write(join(changed.directory, 'image.tar'), `${bytes}x`);
  assert({
    given: 'changed archive bytes under a valid receipt',
    should: 'reject the digest with no Docker load',
    actual: [
      await restoreLaunchImageArchive(changed.owner, image, changed.directory),
      loads(changed.calls),
    ],
    expected: [{ status: 'rejected', reason: 'digest' }, 0],
  });
});

test('a miss is quiet, a rejection warns, and neither blocks the run', async () => {
  const empty = await scratch();
  const miss = fakeDocker();
  const partial = await saved();
  await Bun.write(join(partial.directory, 'receipt.json'), 'not json');
  const { result: results, output } = await captureStdout(async () => [
    await restoreLaunchImageCache(miss.owner, image, empty),
    await restoreLaunchImageCache(partial.owner, image, partial.directory),
  ]);
  assert({
    given: 'an absent entry, then an unusable one',
    should: 'return no image and annotate only the rejection, with its reason',
    actual: {
      results,
      warnings: output.split('::warning').length - 1,
      reason: output.includes('cache-rejected: receipt'),
    },
    expected: { results: [null, null], warnings: 1, reason: true },
  });
});

test('the preparation deadline still stops archive work', async () => {
  const { directory, owner } = await saved();
  const expired = {
    ...owner,
    checkpoint: () => {
      throw new Error('deadline');
    },
  };
  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => 'continued',
      (error: Error) => error.message,
    );
  assert({
    given: 'the deadline passing while hashing a save or a restore',
    should: 'fail preparation instead of hiding it as a cache outcome',
    actual: [
      await outcome(cacheLaunchImage(expired, image, id, await scratch())),
      await outcome(restoreLaunchImageArchive(expired, image, directory)),
    ],
    expected: ['deadline', 'deadline'],
  });
});

test('a proof file change invalidates the cache a hit relies on', async () => {
  const keyWith = async (changed?: string) =>
    (
      await readLaunchImageInputs(
        process.cwd().endsWith('apps/web') ? '../..' : '.',
        'linux/arm64',
        'engine',
        'overlay2',
        async (name) => (name === changed ? 'changed' : name),
      )
    ).image.key;
  const original = await keyWith();
  const names = [
    'launch-browser-preparation-proof.ts',
    'launch-browser-archive-proof.ts',
    'launch-browser-image-cache.ts',
  ];
  assert({
    given: 'the real input list read through its source reader',
    should: 'change the key whenever a skipped proof or the cache code changes',
    actual: await Promise.all(
      names.map(async (name) => (await keyWith(name)) !== original),
    ),
    expected: [true, true, true],
  });
});

test('the miss path acquires its base through one verified step', async () => {
  const baseMetadata = launchBaseMetadata(image, image.native.config);
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
    given: 'a daemon without the base',
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
