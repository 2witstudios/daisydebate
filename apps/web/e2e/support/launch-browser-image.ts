import { createId } from '@paralleldrive/cuid2';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  launchDependencyRevision,
  launchDaemonImageContract,
  launchImageIdentity,
  launchImagePrepareArgs,
  launchImageCommitArgs,
  validateLaunchBase,
  validateLaunchPreparation,
  validateLaunchImage,
  launchImageContractChecks,
  readLaunchPackages,
  type LaunchImage,
  type LaunchImageStore,
} from './launch-browser-image-policy';
import { launchArchiveProjection } from './launch-browser-image-export-policy';
import {
  launchArchiveReceipt,
  launchArchiveReceiptMatches,
  readLaunchArchiveGraph,
} from './launch-browser-image-archive-policy';
import {
  launchArchiveLayersMatch,
  readLaunchArchiveInventory,
  writeClosedLaunchArchive,
} from './launch-browser-image-archive';
import { createLaunchPreparationProcess } from './launch-browser-image-process';
export { createLaunchPreparationProcess } from './launch-browser-image-process';
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
  ];
  const [recipe, ...implementation] = await Promise.all(
    files.map((name) => Bun.file(resolve(import.meta.dir, name)).text()),
  );
  const [lock, bun] = await Promise.all([
    Bun.file(resolve(checkout, 'bun.lock')).text(),
    Bun.file(resolve(checkout, '.bun-version')).text(),
  ]);
  const image = launchImageIdentity({
    version: manifest.devDependencies['@playwright/test'],
    coreVersion: manifest.devDependencies['playwright-core'],
    platform,
    store,
    recipe: recipe!,
    toolchain: JSON.stringify([implementation, bun, engine]),
    lock,
    refresh: launchDependencyRevision,
  });
  return { image, recipe: recipe! };
}
function announce(stage: string, image: LaunchImage, id?: string) {
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
    const result = await owner.run([
      'run',
      '--rm',
      '--name',
      name,
      '--pull=never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      ...image.environment.flatMap((value) => ['--env', value]),
      '--entrypoint',
      'sh',
      id,
      '-ec',
      'test ! -e /fixture/ca.crt; test ! -e /usr/local/share/ca-certificates/daisy-isolated-proof.crt; test ! -e /home/pwuser/.local/share/pki/nssdb; test ! -e /home/pwuser/.pki/nssdb; command -v certutil >/dev/null; test -f /usr/local/share/daisy-launch-packages.txt; test ! -L /usr/local/share/daisy-launch-packages.txt; test "$(wc -c < /usr/local/share/daisy-launch-packages.txt)" -le 262144; printf daisy-image-inventory:; base64 -w0 /usr/local/share/daisy-launch-packages.txt; printf "\\n"',
    ]);
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
async function validatedImage(
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

/** The recipe executes before certificates exist, without a checkout, mounts or inherited credentials. */
export async function createPreparedLaunchImage(
  owner: Owner,
  image: LaunchImage,
  recipe: string,
  name = `daisy-image-${createId()}`,
) {
  let baseId = validateLaunchBase(
    await inspect(owner, 'image', image.base),
    image,
  );
  if (!baseId) {
    announce('acquire-base', image);
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
    id = await validatedImage(owner, image, temporaryTag);
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
  announce('container-cleaned', image, id);
  return id;
}

/** The one restore: a closed format-2 archive, fully verified before Docker sees it. */
export async function restoreLaunchImageArchive(
  owner: Owner,
  image: LaunchImage,
  directory: string,
) {
  try {
    const archive = join(directory, 'image.tar');
    const entries = await readLaunchArchiveInventory(archive, owner.checkpoint);
    const graph = entries && readLaunchArchiveGraph(entries, image);
    if (
      !graph?.ok ||
      graph.extras.length > 0 ||
      !launchArchiveReceiptMatches(
        await Bun.file(join(directory, 'receipt.json')).json(),
        graph,
        image,
      ) ||
      !(await launchArchiveLayersMatch(archive, graph.layers, owner.checkpoint))
    )
      return null;
    const { id } = launchArchiveReceipt(graph, image);
    if ((await owner.run(['image', 'load', '--input', archive])).code !== 0)
      return null;
    return await validatedImage(owner, image, image.tag, id);
  } catch {
    return null;
  }
}

/** The one producer: save, recognize exactly, project if needed, verify, then publish. */
export async function saveLaunchImageArchive(
  owner: Owner,
  image: LaunchImage,
  id: string,
  directory: string,
) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `image-${createId()}`);
  const paths = {
    raw: `${temporary}.raw`,
    closed: `${temporary}.closed`,
    receipt: `${temporary}.json`,
  };
  const refuse = (reason: string) =>
    new Error(`Launch image archive refused: ${reason}`);
  try {
    if (
      (await owner.run(['image', 'save', '--output', paths.raw, image.tag]))
        .code !== 0
    )
      throw new Error('Launch image archive save failed');
    const rawEntries = await readLaunchArchiveInventory(
      paths.raw,
      owner.checkpoint,
    );
    const raw = rawEntries && readLaunchArchiveGraph(rawEntries, image);
    if (!raw) throw refuse('inventory');
    if (!raw.ok) throw refuse(raw.reason);
    const projection = launchArchiveProjection(raw, image, id);
    if (!projection.ok) throw refuse(projection.reason);
    const archive = projection.omitted === 0 ? paths.raw : paths.closed;
    if (projection.omitted > 0)
      await writeClosedLaunchArchive(
        paths.raw,
        paths.closed,
        raw.retained,
        owner.checkpoint,
      );
    const closedEntries = await readLaunchArchiveInventory(
      archive,
      owner.checkpoint,
    );
    const closed =
      closedEntries && readLaunchArchiveGraph(closedEntries, image);
    if (
      !closed?.ok ||
      closed.extras.length > 0 ||
      closed.config !== raw.config ||
      closed.manifest !== raw.manifest ||
      !(await launchArchiveLayersMatch(
        archive,
        closed.layers,
        owner.checkpoint,
      ))
    )
      throw refuse('closed-format');
    await Bun.write(
      paths.receipt,
      JSON.stringify(launchArchiveReceipt(closed, image)),
    );
    await rename(archive, join(directory, 'image.tar'));
    await rename(paths.receipt, join(directory, 'receipt.json'));
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.archive.saved', store: image.store, omitted: projection.omitted, image: id, inputs: image.key })}\n`,
    );
  } finally {
    await Promise.all(
      Object.values(paths).map((path) => rm(path, { force: true })),
    );
  }
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
    let id = await validatedImage(owner, image, image.tag);
    let source = 'local';
    if (!id && input.archiveDirectory) {
      id = await restoreLaunchImageArchive(
        owner,
        image,
        input.archiveDirectory,
      );
      source = 'archive';
      if (!id) announce('cache-rejected-or-missing', image);
    }
    if (!id) {
      source = 'prepare';
      announce(source, image);
      id = await createPreparedLaunchImage(owner, image, recipe);
    }
    if (input.archiveDirectory && source !== 'archive')
      await saveLaunchImageArchive(owner, image, id, input.archiveDirectory);
    announce(source, image, id);
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
  } else
    await prepareLaunchBrowserImage({
      checkout,
      ...(Bun.argv[2] ? { archiveDirectory: resolve(Bun.argv[2]) } : {}),
    });
}
