import { resolve } from 'node:path';
import {
  launchDependencyRevision,
  launchDaemonImageContract,
  launchImageIdentity,
  type LaunchImageStore,
} from './launch-browser-image-policy';
import {
  announceLaunchImage,
  createPreparedLaunchImage,
  validatedLaunchImage,
} from './launch-browser-image-build';
import {
  cacheLaunchImage,
  restoreLaunchImageArchive,
} from './launch-browser-image-cache';
import { createLaunchPreparationProcess } from './launch-browser-image-process';

type Owner = ReturnType<typeof createLaunchPreparationProcess>;

export async function readLaunchDockerContract(owner: Owner) {
  const [result, info] = await Promise.all([
    owner.run([
      'version',
      '--format',
      '{{.Client.Version}}/{{.Server.Version}}',
    ]),
    owner.run([
      'info',
      '--format',
      '{"OSType":{{json .OSType}},"Architecture":{{json .Architecture}},"Driver":{{json .Driver}},"DriverStatus":{{json .DriverStatus}}}',
    ]),
  ]);
  const version = result.stdout.trim();
  if (
    result.code !== 0 ||
    !/^[0-9][a-zA-Z0-9.+-]*\/[0-9][a-zA-Z0-9.+-]*$/.test(version)
  )
    throw new Error(
      'Launch image preparation requires a reachable Docker daemon',
    );
  let contract: ReturnType<typeof launchDaemonImageContract> = null;
  try {
    if (info.code === 0)
      contract = launchDaemonImageContract(JSON.parse(info.stdout));
  } catch {
    /* Refuse unsupported daemon metadata. */
  }
  if (!contract)
    throw new Error(
      'Launch preparation requires a supported native overlay2 or containerd overlayfs image store',
    );
  return { ...contract, engine: version };
}
export async function readLaunchImageInputs(
  checkout: string,
  platform: string,
  engine: string,
  store: LaunchImageStore,
) {
  const manifest = await Bun.file(
    resolve(checkout, 'apps/web/package.json'),
  ).json();
  const files = [
    'launch-browser-image-recipe.sh',
    'launch-browser-image-policy.ts',
    'launch-browser-image.ts',
    'launch-browser-image-process.ts',
    'launch-browser-image-archive-policy.ts',
    'launch-browser-image-export-policy.ts',
    'launch-browser-image-archive.ts',
    'launch-browser-image-build.ts',
    'launch-browser-image-cache.ts',
    'launch-browser-image-validation.ts',
    'launch-browser-image-values.ts',
    // A cache hit vouches for the proofs that ran before its save.
    'launch-browser-preparation-proof.ts',
    'launch-browser-archive-proof.ts',
  ];
  const [recipe, ...implementation] = await Promise.all(
    files.map((name) => Bun.file(resolve(import.meta.dir, name)).text()),
  );
  const bun = await Bun.file(resolve(checkout, '.bun-version')).text();
  const image = launchImageIdentity({
    version: manifest.devDependencies['@playwright/test'],
    coreVersion: manifest.devDependencies['playwright-core'],
    platform,
    store,
    recipe: recipe!,
    toolchain: JSON.stringify([implementation, bun, engine]),
    refresh: launchDependencyRevision,
  });
  return { image, recipe: recipe! };
}
/** One eight-minute owner covers acquisition, execution, commit, cache and cleanup. */
export async function prepareLaunchBrowserImage(input: {
  readonly checkout: string;
  readonly archiveDirectory?: string;
}) {
  const owner = createLaunchPreparationProcess();
  try {
    const { platform, engine, store } = await readLaunchDockerContract(owner);
    const { image, recipe } = await readLaunchImageInputs(
      input.checkout,
      platform,
      engine,
      store,
    );
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.toolchain', docker: engine, store })}\n`,
    );
    let id = await validatedLaunchImage(owner, image, image.tag);
    let source = 'local';
    if (!id && input.archiveDirectory) {
      id = await restoreLaunchImageArchive(
        owner,
        image,
        input.archiveDirectory,
      );
      source = 'archive';
      if (!id) announceLaunchImage('cache-rejected-or-missing', image);
    }
    if (!id) {
      source = 'prepare';
      announceLaunchImage(source, image);
      id = await createPreparedLaunchImage(owner, image, recipe);
    }
    if (input.archiveDirectory && source !== 'archive')
      await cacheLaunchImage(owner, image, id, input.archiveDirectory);
    announceLaunchImage(source, image, id);
    return { id, image };
  } finally {
    owner.close();
  }
}
if (import.meta.main) {
  const checkout = resolve(import.meta.dir, '../../../..');
  if (Bun.argv[2] === '--key') {
    const owner = createLaunchPreparationProcess();
    try {
      const { platform, engine, store } = await readLaunchDockerContract(owner);
      process.stdout.write(
        `${(await readLaunchImageInputs(checkout, platform, engine, store)).image.key}\n`,
      );
    } finally {
      owner.close();
    }
  } else if (Bun.argv[2]?.startsWith('-'))
    throw new Error(
      'Usage: launch-browser-image.ts [--key | <archive directory>]',
    );
  else
    await prepareLaunchBrowserImage({
      checkout,
      ...(Bun.argv[2] ? { archiveDirectory: resolve(Bun.argv[2]) } : {}),
    });
}
