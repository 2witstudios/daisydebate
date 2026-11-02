import { copyFile, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  prepareLaunchBrowserImage,
  readLaunchImageInputs,
} from './launch-browser-image';
import { launchBaseIsPresent } from './launch-browser-image-build';
import {
  restoreLaunchImageArchive,
  saveLaunchImageArchive,
} from './launch-browser-image-cache';
import { createLaunchPreparationProcess } from './launch-browser-image-process';

/**
 * Real positive: save, remove, restore and inspect on this daemon's store.
 * Each negative is refused for its named reason. Only the wrong-identity case
 * reaches Docker, because the hash cannot know which image an archive holds.
 */
const checkout = resolve(import.meta.dir, '../../../..');
const prepared = await prepareLaunchBrowserImage({ checkout });
const directory = await mkdtemp(join(tmpdir(), 'daisy-launch-archive-'));
const owner = createLaunchPreparationProcess();
let loads = 0;
const observed = {
  ...owner,
  run: ((args, options) => {
    if (args[0] === 'image' && args[1] === 'load') loads += 1;
    return owner.run(args, options);
  }) as typeof owner.run,
};
const started = performance.now();
const { image, id } = prepared;
const log = (fields: object) =>
  process.stdout.write(
    `${JSON.stringify({ event: 'browser.image.archive.proof', store: image.store, platform: image.platform, inputs: image.key, ...fields })}\n`,
  );
try {
  const saved = join(directory, 'valid');
  const archive = join(saved, 'image.tar');
  const receiptPath = join(saved, 'receipt.json');
  const saveStarted = performance.now();
  const save = await saveLaunchImageArchive(owner, image, id, saved);
  if (!save.saved)
    throw new Error(`Launch archive save refused: ${save.reason}`);
  const saveMs = Math.round(performance.now() - saveStarted);
  const { size: bytes } = await stat(archive);
  const receiptText = await Bun.file(receiptPath).text();
  const receipt = JSON.parse(receiptText);

  if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
    throw new Error('Archive proof could not release its owned reference');
  if ((await owner.run(['image', 'inspect', id])).code === 0)
    throw new Error('Archive proof requires the image to be really absent');
  const loadStarted = performance.now();
  const restored = await restoreLaunchImageArchive(observed, image, saved);
  if (restored.status !== 'restored' || restored.id !== id || loads !== 1)
    throw new Error('Exact Launch archive restoration failed');
  log({
    case: 'exact-roundtrip',
    image: id,
    bytes,
    saveMs,
    loadMs: Math.round(performance.now() - loadStarted),
  });

  const refused = async (
    name: string,
    reason: string,
    expected = image,
    from = saved,
  ) => {
    const before = loads,
      began = performance.now();
    const result = await restoreLaunchImageArchive(observed, expected, from);
    if (
      result.status !== 'rejected' ||
      result.reason !== reason ||
      loads !== before
    )
      throw new Error(`Launch archive ${name} boundary failed`);
    log({
      case: name,
      outcome: 'rejected',
      reason,
      loadAttempts: 0,
      elapsedMs: Math.round(performance.now() - began),
    });
  };
  const withReceipt = async (name: string, value: object) => {
    await Bun.write(receiptPath, JSON.stringify(value));
    await refused(name, 'receipt');
    await Bun.write(receiptPath, receiptText);
  };
  await withReceipt('receipt-format', { ...receipt, format: 0 });
  await withReceipt('receipt-key', { ...receipt, key: 'foreign-key' });
  await withReceipt('receipt-store', {
    ...receipt,
    store: image.store === 'overlay2' ? 'containerd-overlayfs' : 'overlay2',
  });
  await withReceipt('receipt-extra', { ...receipt, extra: true });

  // Real bytes flipped in place, then repaired, so no second archive is needed.
  const file = await open(archive, 'r+');
  const original = Buffer.alloc(1);
  await file.read(original, 0, 1, bytes - 2048);
  await file.write(Buffer.from([original[0]! ^ 1]), 0, 1, bytes - 2048);
  await file.close();
  await refused('substituted-byte', 'digest');
  const repair = await open(archive, 'r+');
  await repair.write(original, 0, 1, bytes - 2048);
  await repair.close();

  const engine = (
    await owner.run([
      'version',
      '--format',
      '{{.Client.Version}}/{{.Server.Version}}',
    ])
  ).stdout.trim();
  const opposite = (
    await readLaunchImageInputs(
      checkout,
      image.platform === 'linux/arm64' ? 'linux/amd64' : 'linux/arm64',
      engine,
      image.store,
    )
  ).image;
  await refused('wrong-platform', 'receipt', opposite);

  const corrupt = join(directory, 'corrupt');
  await mkdir(corrupt);
  await copyFile(receiptPath, join(corrupt, 'receipt.json'));
  await Bun.write(join(corrupt, 'image.tar'), 'not an image archive');
  await refused('corrupt', 'digest', image, corrupt);

  // A consistent receipt naming another image loads, then fails its identity.
  await Bun.write(
    receiptPath,
    JSON.stringify({ ...receipt, id: `sha256:${'0'.repeat(64)}` }),
  );
  const before = loads;
  const foreign = await restoreLaunchImageArchive(observed, image, saved);
  if (
    foreign.status !== 'rejected' ||
    foreign.reason !== 'identity' ||
    loads !== before + 1
  )
    throw new Error('Launch archive identity boundary failed');
  log({ case: 'receipt-identity', outcome: 'rejected', reason: 'identity' });
  await Bun.write(receiptPath, receiptText);

  // The shared outer owner: a corrupt archive directory warns and causes one
  // fresh preparation. A real CI hit stays offline; its key covers this proof
  // and its entry saved only after the proof passed on these exact inputs.
  if (
    process.env.LAUNCH_IMAGE_CACHE_HIT === 'true' &&
    !(await launchBaseIsPresent(owner, image))
  )
    log({
      case: 'corrupt-cache-bounded-rebuild',
      outcome: 'not-run-cache-hit',
    });
  else {
    if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
      throw new Error('Corrupt-cache proof could not release its reference');
    const rebuildStarted = performance.now();
    // Expected here, so it must not post a rejection warning on the run page.
    let controlRejection: string | null = null;
    const rebuilt = await prepareLaunchBrowserImage({
      checkout,
      archiveDirectory: corrupt,
      onCacheRejected: (reason) => {
        controlRejection = reason;
      },
    });
    if (controlRejection !== 'digest')
      throw new Error('Corrupt-cache control was not rejected for its digest');
    if (rebuilt.image.key !== image.key)
      throw new Error('Corrupt-cache rebuild changed its input identity');
    log({
      case: 'corrupt-cache-bounded-rebuild',
      image: rebuilt.id,
      elapsedMs: Math.round(performance.now() - rebuildStarted),
    });
    // Cold rebuilds are not byte-identical, so later proofs and the suite get
    // the exact cached bytes rather than this control's rebuild.
    if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
      throw new Error('Could not release the rebuilt control image');
    const cached = await restoreLaunchImageArchive(observed, image, saved);
    if (cached.status !== 'restored' || cached.id !== id)
      throw new Error('Could not restore the exact cached image');
    log({ case: 'cached-image-restored', image: id });
  }
  if (performance.now() - started > 480000)
    throw new Error('Archive proof exceeded the preparation budget');
} finally {
  owner.close();
  await rm(directory, { recursive: true, force: true });
}
