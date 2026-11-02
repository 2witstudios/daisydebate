import { createId } from '@paralleldrive/cuid2';
import { resolve } from 'node:path';
import {
  readLaunchImageInputs,
  readLaunchDockerContract,
} from './launch-browser-image';
import {
  acquireLaunchBase,
  launchBaseIsPresent,
  closeLaunchPreparation,
  createPreparedLaunchImage,
} from './launch-browser-image-build';
import { createLaunchPreparationProcess } from './launch-browser-image-process';
import { launchImagePrepareArgs } from './launch-browser-image-policy';

const checkout = resolve(import.meta.dir, '../../../..');
const prerequisite = createLaunchPreparationProcess();
const { engine, platform, store } =
  await readLaunchDockerContract(prerequisite);
const { image } = await readLaunchImageInputs(
  checkout,
  platform,
  engine,
  store,
);
// A cache hit restores only the prepared image and must not need the network.
// Its key covers this proof and the cache saves after it, so it already passed
// on these exact inputs. Any changed input is a miss, which has the base.
if (!(await launchBaseIsPresent(prerequisite, image))) {
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.preparation.proof', outcome: 'not-run-cache-hit', inputs: image.key, platform })}\n`,
  );
  prerequisite.close();
  process.exit(0);
}
const baseId = await acquireLaunchBase(prerequisite, image);
prerequisite.close();

for (const mode of [
  'deadline',
  'partial-create',
  'credential-config',
  'commit-failure',
] as const) {
  const budgetMs =
    mode === 'deadline' && Bun.argv.includes('--full-budget') ? 480000 : 40000;
  const owner = createLaunchPreparationProcess(budgetMs);
  const name = `daisy-image-${createId()}`;
  let entered = false;
  let starts = 0;
  const run: typeof owner.run = async (args, options) => {
    let actual = args;
    if (
      args[0] === 'container' &&
      args[1] === 'create' &&
      mode === 'credential-config'
    )
      actual = args.map((arg) =>
        arg === 'HTTP_PROXY='
          ? 'HTTP_PROXY=http://synthetic:credential@proxy.invalid'
          : arg,
      );
    if (args[0] === 'container' && args[1] === 'start') {
      entered = true;
      starts += 1;
    }
    if (
      args[0] === 'container' &&
      args[1] === 'commit' &&
      mode === 'commit-failure'
    )
      actual = [...args.slice(0, -1), 'INVALID/UPPERCASE'];
    return owner.run(actual, options);
  };
  const started = performance.now();
  try {
    if (mode === 'partial-create') {
      const created = await owner.run(
        launchImagePrepareArgs(image, name, baseId),
      );
      if (created.code !== 0) throw new Error('Partial-create fixture failed');
    }
    // Synthetic recipe output reaches a real failed commit without installing
    // packages. It is never accepted as a prepared image or package proof.
    const inventory = Buffer.from('libnss3-tools\t2:3.98-1build1\n').toString(
      'base64',
    );
    const recipe =
      mode === 'deadline'
        ? 'printf "daisy-image-stage:artifact-download\\n"\nsleep 600\n'
        : `printf 'daisy-image-inventory:${inventory}\\n'\n`;
    const outcome = await createPreparedLaunchImage(
      { ...owner, run },
      image,
      recipe,
      name,
    ).then(
      () => 'unexpected-success',
      (error) => String(error),
    );
    const expected = {
      deadline: 'deadline exceeded',
      'partial-create': 'configuration refused',
      'credential-config': 'configuration refused',
      'commit-failure': 'commit failed',
    }[mode];
    if (mode === 'deadline' && !outcome.includes('stage: artifact-download'))
      throw new Error('Held preparation recipe did not actually enter');
    if (!outcome.includes(expected))
      throw new Error(
        `Preparation ${mode} proof reached an unexpected outcome`,
      );
    if ((mode === 'deadline' || mode === 'commit-failure') && !entered)
      throw new Error('Preparation operation did not actually start');
    if (mode === 'credential-config' && starts !== 0)
      throw new Error('Credential-bearing configuration executed');
    const remaining = await owner.run(
      [
        'container',
        'ls',
        '--all',
        '--filter',
        `name=^/${name}$`,
        '--format',
        '{{.ID}}',
      ],
      { cleanup: true },
    );
    if (
      remaining.code !== 0 ||
      remaining.stdout.trim() ||
      performance.now() - started > budgetMs
    )
      throw new Error('Preparation resource cleanup or total deadline failed');
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.preparation.proof', mode, outcome: 'refused-and-cleaned', budgetMs, elapsedMs: Math.round(performance.now() - started), platform, inputs: image.key })}\n`,
    );
  } finally {
    await closeLaunchPreparation(owner, name);
    owner.close();
  }
}
