import { createId } from '@paralleldrive/cuid2';
import { copyFile, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  prepareLaunchBrowserImage,
  readLaunchImageInputs,
} from './launch-browser-image';
import {
  restoreLaunchImageArchive,
  saveLaunchImageArchive,
} from './launch-browser-image-cache';
import { createLaunchPreparationProcess } from './launch-browser-image-process';
import { readLaunchArchiveGraph } from './launch-browser-image-archive-policy';
import { launchArchiveProjection } from './launch-browser-image-export-policy';
import { readLaunchArchiveInventory } from './launch-browser-image-archive';

/**
 * Real positive: exact save, remove, verified restore and inspect on this
 * daemon's actual store family. Negatives mutate that real archive in place
 * and undo it, so each one proves refusal with zero Docker loads.
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
  const bytes = (await stat(archive)).size;
  const receiptText = await Bun.file(receiptPath).text();
  const receipt = JSON.parse(receiptText);
  const inventory = (await readLaunchArchiveInventory(
    archive,
    owner.checkpoint,
  ))!;
  const graph = readLaunchArchiveGraph(inventory, image);
  if (!graph.ok || graph.extras.length > 0)
    throw new Error('Saved Launch archive is not the closed format');
  const expectedId = image.store === 'overlay2' ? graph.config : graph.manifest;
  if (id !== expectedId || receipt.id !== id)
    throw new Error('Saved Launch receipt is not bound to its store family');

  if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
    throw new Error('Archive proof could not release its owned reference');
  if ((await owner.run(['image', 'inspect', id])).code === 0)
    throw new Error('Archive proof requires the image to be really absent');
  const loadStarted = performance.now();
  const restored = await restoreLaunchImageArchive(observed, image, saved);
  if (restored !== id || loads !== 1)
    throw new Error('Exact Launch archive restoration failed');
  log({
    case: 'exact-roundtrip',
    image: id,
    bytes,
    entries: inventory.length,
    saveMs,
    loadMs: Math.round(performance.now() - loadStarted),
  });

  const foreign = `daisy-launch-foreign-negative:${createId()}`;
  if ((await owner.run(['image', 'inspect', foreign])).code === 0)
    throw new Error('Foreign reference proof requires absence');
  const refused = async (name: string, expected = image, from = saved) => {
    const before = loads,
      began = performance.now();
    const result = await restoreLaunchImageArchive(observed, expected, from);
    if (result !== null || loads !== before)
      throw new Error(
        `Launch archive ${name} boundary failed (accepted: ${result !== null}, load attempts: ${loads - before})`,
      );
    if ((await owner.run(['image', 'inspect', foreign])).code === 0)
      throw new Error('Archive restore introduced a foreign reference');
    log({
      case: name,
      outcome: 'rejected',
      loadAttempts: 0,
      elapsedMs: Math.round(performance.now() - began),
    });
  };
  const withReceipt = async (name: string, value: object) => {
    await Bun.write(receiptPath, JSON.stringify(value));
    await refused(name);
    await Bun.write(receiptPath, receiptText);
  };
  await withReceipt('receipt-format', { ...receipt, format: 1 });
  await withReceipt('receipt-key', { ...receipt, key: 'foreign-key' });
  await withReceipt('receipt-store', {
    ...receipt,
    store: image.store === 'overlay2' ? 'containerd-overlayfs' : 'overlay2',
  });
  await withReceipt('receipt-either-id', {
    ...receipt,
    id: image.store === 'overlay2' ? graph.manifest : graph.config,
  });

  /** Overwrite same-length payload bytes in the real archive, then restore them. */
  const overwritten = async (
    name: string,
    entryName: string,
    change: (body: Buffer) => void,
  ) => {
    const entry = inventory.find((candidate) => candidate.name === entryName)!;
    const file = await open(archive, 'r+');
    const length = Math.min(entry.size, 4096);
    const original = Buffer.alloc(length);
    await file.read(original, 0, length, entry.offset + 512);
    const body = Buffer.from(original);
    change(body);
    if (body.equals(original))
      throw new Error(`Negative ${name} did not change the archive`);
    await file.write(body, 0, length, entry.offset + 512);
    await file.close();
    try {
      await refused(name);
    } finally {
      const repair = await open(archive, 'r+');
      await repair.write(original, 0, length, entry.offset + 512);
      await repair.close();
    }
  };
  const retag = (body: Buffer) => {
    const text = body.toString('latin1');
    body.write(
      text.replaceAll(
        image.key,
        image.key.replace(/^./, (c) => (c === '0' ? '1' : '0')),
      ),
      'latin1',
    );
  };
  await overwritten('foreign-docker-tag', 'manifest.json', retag);
  await overwritten('foreign-oci-ref', 'index.json', retag);
  await overwritten(
    'substituted-config',
    graph.config.replace('sha256:', 'blobs/sha256/'),
    (body) => {
      body[0] = body[0]! ^ 1;
    },
  );
  await overwritten(
    'substituted-layer',
    graph.layers.at(-1)!.entry.name,
    (body) => {
      body[0] = body[0]! ^ 1;
    },
  );

  /** Append through the system tar writer, then truncate back to the real archive. */
  const appended = async (
    target: string,
    name: string,
    body: string,
    check: () => Promise<void>,
  ) => {
    const source = join(directory, `append-${createId()}`);
    await Bun.write(join(source, name), body);
    const { size } = await stat(target);
    const tail = await open(target, 'r+');
    let end = size;
    const block = Buffer.alloc(512);
    while (end >= 512) {
      await tail.read(block, 0, 512, end - 512);
      if (!block.every((byte) => byte === 0)) break;
      end -= 512;
    }
    const result = Bun.spawnSync(
      ['tar', '--format=ustar', '-rf', target, '-C', source, name],
      { stdout: 'ignore', stderr: 'ignore', timeout: 60000 },
    );
    if (result.exitCode !== 0)
      throw new Error('Owned negative archive construction failed');
    try {
      await check();
    } finally {
      // Tar wrote over the zero tail, so clear it back to zeros before regrowing.
      await tail.truncate(end);
      await tail.truncate(size);
      await tail.close();
      await rm(source, { recursive: true, force: true });
    }
  };
  const aux = `blobs/sha256/${'a'.repeat(64)}`;
  await appended(archive, aux, '{"id":"injected"}', () =>
    refused('restore-injected-object'),
  );
  await appended(archive, 'escape.bin', 'foreign', () =>
    refused('restore-foreign-path'),
  );

  // Producer negatives need this daemon's actual unprojected export.
  const raw = join(directory, 'raw');
  await mkdir(raw);
  const rawArchive = join(raw, 'image.tar');
  if (
    (await owner.run(['image', 'save', '--output', rawArchive, image.tag]))
      .code !== 0
  )
    throw new Error('Raw export for producer negatives failed');
  await Bun.write(join(raw, 'receipt.json'), receiptText);
  const rawEntries = (await readLaunchArchiveInventory(
    rawArchive,
    owner.checkpoint,
  ))!;
  const rawGraph = readLaunchArchiveGraph(rawEntries, image);
  if (!rawGraph.ok)
    throw new Error(`Raw export graph refused: ${rawGraph.reason}`);
  const projection = launchArchiveProjection(rawGraph, image, id);
  if (!projection.ok)
    throw new Error(`Raw export projection refused: ${projection.reason}`);
  log({
    case: 'exact-export-recognition',
    entries: rawEntries.length,
    omitted: projection.omitted,
  });
  if (projection.omitted > 0) await refused('restore-raw-export', image, raw);
  await appended(rawArchive, aux, '{"id":"injected"}', async () => {
    const entries = (await readLaunchArchiveInventory(
      rawArchive,
      owner.checkpoint,
    ))!;
    const injected = readLaunchArchiveGraph(entries, image);
    const decision = injected.ok
      ? launchArchiveProjection(injected, image, id)
      : injected;
    if (decision.ok || decision.reason !== 'unknown-object')
      throw new Error('Producer did not refuse an injected object');
    log({ case: 'producer-injected-object', outcome: 'rejected' });
  });
  await rm(raw, { recursive: true, force: true });

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
  await refused('wrong-platform', opposite);

  const truncated = join(directory, 'truncated');
  await mkdir(truncated);
  await copyFile(receiptPath, join(truncated, 'receipt.json'));
  await copyFile(archive, join(truncated, 'image.tar'));
  const shortened = await open(join(truncated, 'image.tar'), 'r+');
  await shortened.truncate(bytes - 1048576);
  await shortened.close();
  await refused('truncated', image, truncated);
  await rm(truncated, { recursive: true, force: true });

  const corrupt = join(directory, 'corrupt');
  await mkdir(corrupt);
  await copyFile(receiptPath, join(corrupt, 'receipt.json'));
  await Bun.write(join(corrupt, 'image.tar'), 'not an image archive');
  await refused('corrupt', image, corrupt);

  if ((await restoreLaunchImageArchive(observed, image, saved)) !== id)
    throw new Error('Undone negatives left the archive unusable');

  // The shared outer owner: a corrupt archive directory causes one fresh
  // preparation, never acceptance of stale data. A CI cache entry itself is
  // immutable under its key; see round-browser-proof.md for recovery.
  if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
    throw new Error(
      'Corrupt-cache proof could not release its owned reference',
    );
  const rebuildStarted = performance.now();
  const rebuilt = await prepareLaunchBrowserImage({
    checkout,
    archiveDirectory: corrupt,
  });
  if (rebuilt.image.key !== image.key)
    throw new Error(
      'Corrupt-cache rebuild changed its expected input identity',
    );
  log({
    case: 'corrupt-cache-bounded-rebuild',
    image: rebuilt.id,
    elapsedMs: Math.round(performance.now() - rebuildStarted),
  });

  // Cold rebuilds are not byte-identical, so leave the exact cached bytes for
  // the later proofs and browser suite instead of this control's rebuild.
  if ((await owner.run(['image', 'rm', image.tag])).code !== 0)
    throw new Error('Could not release the rebuilt control image');
  if ((await restoreLaunchImageArchive(observed, image, saved)) !== id)
    throw new Error('Could not restore the exact cached image');
  log({ case: 'cached-image-restored', image: id });
  if (performance.now() - started > 480000)
    throw new Error('Archive proof exceeded the preparation budget');
} finally {
  owner.close();
  await rm(directory, { recursive: true, force: true });
}
