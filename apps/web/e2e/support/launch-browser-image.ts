import { createId } from '@paralleldrive/cuid2';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  launchBuildkitImage,
  launchDependencyRevision,
  launchImageIdentity,
  launchImageBuildArgs,
  validateLaunchImage,
  readLaunchArchiveReceipt,
  type LaunchImage,
} from './launch-browser-image-policy';

import { createLaunchPreparationProcess } from './launch-browser-image-process';
export { createLaunchPreparationProcess } from './launch-browser-image-process';

export async function readLaunchImageInputs(
  checkout: string,
  platform: string,
) {
  const at = (name: string) => resolve(import.meta.dir, name);
  const manifest = await Bun.file(
    resolve(checkout, 'apps/web/package.json'),
  ).json();
  const [dockerfile, policy, adapter, processAdapter, lock, bun] =
    await Promise.all(
      [
        'launch-browser-image.Dockerfile',
        'launch-browser-image-policy.ts',
        'launch-browser-image.ts',
        'launch-browser-image-process.ts',
      ]
        .map((name) => Bun.file(at(name)).text())
        .concat([
          Bun.file(resolve(checkout, 'bun.lock')).text(),
          Bun.file(resolve(checkout, '.bun-version')).text(),
        ]),
    );
  const image = launchImageIdentity({
    version: manifest.devDependencies['@playwright/test'],
    coreVersion: manifest.devDependencies['playwright-core'],
    platform,
    dockerfile: dockerfile!,
    toolchain: JSON.stringify([policy, adapter, processAdapter, bun]),
    lock: lock!,
    refresh: launchDependencyRevision,
  });
  return { image, dockerfile: dockerfile! };
}

/** Cold image builds have a disposable backend; warm images need no builder. */
export async function buildLaunchImage(
  process: ReturnType<typeof createLaunchPreparationProcess>,
  image: LaunchImage,
  dockerfile: string,
  builder = `daisy-launch-${createId()}`,
) {
  if (!/^daisy-launch-[a-z0-9]+$/.test(builder))
    throw new Error('Invalid owned Launch builder name');
  const container = `buildx_buildkit_${builder}0`;
  let failure: unknown = null;
  try {
    const created = await process.run([
      'buildx',
      'create',
      '--name',
      builder,
      '--driver',
      'docker-container',
      '--driver-opt',
      `image=${launchBuildkitImage}`,
      '--driver-opt',
      'restart-policy=no',
      ...(globalThis.process.platform === 'linux'
        ? ['--driver-opt', 'network=host']
        : []),
    ]);
    if (created.code !== 0)
      throw new Error(
        'Launch image builder creation failed; check Docker buildx',
      );
    const built = await process.run(launchImageBuildArgs(image, builder), {
      stdin: dockerfile,
    });
    if (built.code !== 0)
      throw new Error(
        'Launch image build failed; check pinned upstream image and Noble NSS package availability',
      );
  } catch (error) {
    failure = error;
  }
  // Kill the owned backend before removing its buildx metadata/state, including
  // a partial create/bootstrap. This also terminates its nested executors.
  await process.run(['container', 'rm', '--force', container], {
    cleanup: true,
    limitMs: 8000,
  });
  await process.run(['buildx', 'rm', '--force', builder], {
    cleanup: true,
    limitMs: 8000,
  });
  const volume = `${container}_state`;
  await process.run(['volume', 'rm', '--force', volume], {
    cleanup: true,
    limitMs: 5000,
  });
  const checks = await Promise.all([
    process.run(['container', 'inspect', container], {
      cleanup: true,
      limitMs: 2000,
    }),
    process.run(['volume', 'inspect', volume], {
      cleanup: true,
      limitMs: 2000,
    }),
    process.run(['buildx', 'inspect', builder], {
      cleanup: true,
      limitMs: 2000,
    }),
    process.run(['info', '--format', '{{.OSType}}'], {
      cleanup: true,
      limitMs: 2000,
    }),
  ]);
  if (
    checks.slice(0, 3).some((result) => result.code === 0) ||
    checks[3]?.code !== 0
  )
    throw new Error('Launch image owned builder cleanup failed');
  processMessage('builder-cleaned', image);
  if (failure) throw failure;
}

/** Cache is optional and untrusted for consistency; one rejected archive gets one bounded rebuild. */
export async function prepareLaunchBrowserImage(input: {
  readonly checkout: string;
  readonly archiveDirectory?: string;
}) {
  const process = createLaunchPreparationProcess();
  const inspect = async (image: LaunchImage, receiptId?: string) => {
    const result = await process.run(['image', 'inspect', image.tag]);
    if (result.code !== 0) return null;
    try {
      return validateLaunchImage(
        JSON.parse(result.stdout)[0],
        image,
        receiptId,
      );
    } catch {
      return null;
    }
  };
  const directory = input.archiveDirectory;
  const archive = directory ? join(directory, 'image.tar') : null;
  const receipt = directory ? join(directory, 'receipt.json') : null;
  const temporary = directory
    ? join(directory, `image-${createId()}.tmp`)
    : null;
  try {
    const info = await process.run([
      'info',
      '--format',
      '{{.OSType}}/{{.Architecture}}',
    ]);
    if (info.code !== 0)
      throw new Error(
        'Launch image preparation requires a reachable Docker daemon',
      );
    const platform = info.stdout
      .trim()
      .replace('/aarch64', '/arm64')
      .replace('/x86_64', '/amd64');
    const { image, dockerfile } = await readLaunchImageInputs(
      input.checkout,
      platform,
    );
    let id = await inspect(image);
    let source = 'local';
    if (!id && archive && receipt && (await Bun.file(archive).exists())) {
      source = 'archive';
      try {
        const recorded: unknown = await Bun.file(receipt).json();
        const receiptId = readLaunchArchiveReceipt(recorded, image.key);
        if (!receiptId) throw new Error('Invalid archive receipt');
        const loaded = await process.run(['image', 'load', '--input', archive]);
        if (loaded.code === 0) id = await inspect(image, receiptId);
      } catch {
        /* Rejected cache is never runtime authority. Rebuild below. */
      }
      if (!id) processMessage('cache-rejected', image);
    }
    if (!id) {
      source = 'build';
      processMessage('build', image);
      await buildLaunchImage(process, image, dockerfile);
      id = await inspect(image);
      if (!id)
        throw new Error(
          'Launch prepared image metadata does not match expected inputs',
        );
    }
    if (directory && archive && receipt && temporary && source !== 'archive') {
      await mkdir(directory, { recursive: true });
      const saved = await process.run([
        'image',
        'save',
        '--output',
        temporary,
        image.tag,
      ]);
      if (saved.code !== 0) throw new Error('Launch image archive save failed');
      await Bun.write(
        `${temporary}.json`,
        JSON.stringify({ key: image.key, id }),
      );
      await rename(temporary, archive);
      await rename(`${temporary}.json`, receipt);
    }
    processMessage(source, image, id);
    return { id, image };
  } finally {
    if (temporary) {
      await rm(temporary, { force: true });
      await rm(`${temporary}.json`, { force: true });
    }
    process.close();
  }
}
function processMessage(stage: string, image: LaunchImage, id?: string) {
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.preparation', stage, inputs: image.key, platform: image.platform, ...(id ? { image: id } : {}) })}\n`,
  );
}

if (import.meta.main) {
  const checkout = resolve(import.meta.dir, '../../../..');
  if (Bun.argv[2] === '--key') {
    const platform = Bun.argv[3];
    if (!platform)
      throw new Error(
        'Launch image cache key requires its explicit Linux platform',
      );
    process.stdout.write(
      `${(await readLaunchImageInputs(checkout, platform)).image.key}\n`,
    );
  } else {
    await prepareLaunchBrowserImage({
      checkout,
      ...(Bun.argv[2] ? { archiveDirectory: resolve(Bun.argv[2]) } : {}),
    });
  }
}
