import { createId } from '@paralleldrive/cuid2';
import {
  launchImageFilesystemArgs,
  launchImagePrepareArgs,
  launchImageCommitArgs,
  readLaunchPackages,
  type LaunchImage,
} from './launch-browser-image-policy';
import {
  launchImageContractChecks,
  validateLaunchBase,
  validateLaunchImage,
  validateLaunchPreparation,
} from './launch-browser-image-validation';
import type { createLaunchPreparationProcess } from './launch-browser-image-process';

type Owner = ReturnType<typeof createLaunchPreparationProcess>;

async function inspect(
  owner: Owner,
  kind: 'image' | 'container',
  name: string,
): Promise<unknown> {
  const result = await owner.run([kind, 'inspect', name]);
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout)[0];
  } catch {
    return null;
  }
}
export function announceLaunchImage(
  stage: string,
  image: LaunchImage,
  id?: string,
) {
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.preparation', stage, inputs: image.key, platform: image.platform, ...(id ? { image: id } : {}) })}\n`,
  );
}

/** Stop/remove only the preparation this operation created, including partial creation. */
export async function closeLaunchPreparation(owner: Owner, name: string) {
  if (!/^daisy-image-[a-z0-9]+$/.test(name))
    throw new Error('Invalid owned image preparation name');
  await owner.run(['container', 'rm', '--force', '--volumes', name], {
    cleanup: true,
    limitMs: 8000,
  });
  const [container, daemon] = await Promise.all([
    owner.run(['container', 'inspect', name], { cleanup: true, limitMs: 2000 }),
    owner.run(['info', '--format', '{{.OSType}}'], {
      cleanup: true,
      limitMs: 2000,
    }),
  ]);
  if (container.code === 0 || daemon.code !== 0)
    throw new Error('Launch image owned preparation cleanup failed');
}
async function verifyFilesystem(
  owner: Owner,
  image: LaunchImage,
  id: string,
  expectedPackages: string,
) {
  const name = `daisy-image-${createId()}`;
  let valid = false;
  let failure: unknown = null;
  try {
    const result = await owner.run(launchImageFilesystemArgs(image, name, id));
    valid =
      result.code === 0 &&
      readLaunchPackages(result.stdout) === expectedPackages;
  } catch (error) {
    failure = error;
  }
  await closeLaunchPreparation(owner, name);
  if (failure) throw failure;
  return valid;
}
export async function validatedLaunchImage(
  owner: Owner,
  image: LaunchImage,
  name: string,
  receiptId?: string,
) {
  const raw = await inspect(owner, 'image', name);
  const id = validateLaunchImage(raw, image, receiptId);
  if (!id) {
    if (raw !== null)
      process.stdout.write(
        `${JSON.stringify({ event: 'browser.image.refused', checks: launchImageContractChecks(raw, image, receiptId) })}\n`,
      );
    return null;
  }
  const packages = (raw as { Config: { Labels: Record<string, string> } })
    .Config.Labels['io.daisy.launch.packages']!;
  if (await verifyFilesystem(owner, image, id, packages)) return id;
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.refused', checks: { filesystemInventory: false } })}\n`,
  );
  return null;
}

export const launchBaseIsPresent = async (owner: Owner, image: LaunchImage) =>
  validateLaunchBase(await inspect(owner, 'image', image.base), image) !== null;

/** Admit the pinned upstream base only after verifying it, pulling at most once. */
export async function acquireLaunchBase(owner: Owner, image: LaunchImage) {
  let baseId = validateLaunchBase(
    await inspect(owner, 'image', image.base),
    image,
  );
  if (!baseId) {
    announceLaunchImage('acquire-base', image);
    const pulled = await owner.run([
      'pull',
      '--platform',
      image.platform,
      image.base,
    ]);
    if (pulled.code !== 0)
      throw new Error(
        'Launch image base acquisition failed; check pinned upstream availability',
      );
    baseId = validateLaunchBase(
      await inspect(owner, 'image', image.base),
      image,
    );
  }
  if (!baseId)
    throw new Error('Launch image upstream native identity or config mismatch');
  return baseId;
}

/** The recipe executes before certificates exist, without a checkout, mounts or inherited credentials. */
export async function createPreparedLaunchImage(
  owner: Owner,
  image: LaunchImage,
  recipe: string,
  name = `daisy-image-${createId()}`,
) {
  const baseId = await acquireLaunchBase(owner, image);
  const temporaryTag = `daisy-launch-preparing:${createId()}`;
  let id: string | null = null;
  let failure: unknown = null;
  try {
    const created = await owner.run(
      launchImagePrepareArgs(image, name, baseId),
    );
    if (
      created.code !== 0 ||
      !validateLaunchPreparation(
        await inspect(owner, 'container', name),
        image,
        baseId,
      )
    )
      throw new Error(
        'Launch preparation configuration refused before execution',
      );
    const executed = await owner.run(
      ['container', 'start', '--attach', '--interactive', name],
      { stdin: recipe },
    );
    const packages = readLaunchPackages(executed.stdout);
    if (
      executed.code !== 0 ||
      !packages ||
      !validateLaunchPreparation(
        await inspect(owner, 'container', name),
        image,
        baseId,
        true,
      )
    )
      throw new Error(
        'Launch NSS preparation or pre-commit provenance validation failed',
      );
    const committed = await owner.run(
      launchImageCommitArgs(name, temporaryTag, packages),
    );
    if (committed.code !== 0)
      throw new Error('Launch prepared image commit failed');
    id = await validatedLaunchImage(owner, image, temporaryTag);
    if (!id)
      throw new Error(
        'Launch prepared image config, packages or native provenance mismatch',
      );
    if ((await owner.run(['image', 'tag', id, image.tag])).code !== 0)
      throw new Error('Launch prepared image local tag failed');
  } catch (error) {
    failure = error;
  }
  const cleanupFailure = await closeLaunchPreparation(owner, name).then(
    () => null,
    (error: unknown) => error,
  );
  await owner.run(['image', 'rm', temporaryTag], {
    cleanup: true,
    limitMs: 5000,
  });
  if (
    (
      await owner.run(['image', 'inspect', temporaryTag], {
        cleanup: true,
        limitMs: 2000,
      })
    ).code === 0
  )
    throw new Error('Launch temporary image cleanup failed');
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
  if (!id) throw new Error('Launch prepared image unavailable');
  announceLaunchImage('container-cleaned', image, id);
  return id;
}
