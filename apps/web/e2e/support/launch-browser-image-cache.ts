import { createId } from '@paralleldrive/cuid2';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
import { validatedLaunchImage } from './launch-browser-image-build';
import type { LaunchImage } from './launch-browser-image-policy';
import type { createLaunchPreparationProcess } from './launch-browser-image-process';

type Owner = ReturnType<typeof createLaunchPreparationProcess>;

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
    return await validatedLaunchImage(owner, image, image.tag, id);
  } catch {
    return null;
  }
}

/**
 * The one producer: save, recognize exactly, project if needed, verify, then
 * publish. Refusal is a result: nothing is published and the caller decides.
 */
export async function saveLaunchImageArchive(
  owner: Owner,
  image: LaunchImage,
  id: string,
  directory: string,
): Promise<
  { readonly saved: true } | { readonly saved: false; readonly reason: string }
> {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `image-${createId()}`);
  const paths = {
    raw: `${temporary}.raw`,
    closed: `${temporary}.closed`,
    receipt: `${temporary}.json`,
  };
  const refuse = (reason: string) => ({ saved: false as const, reason });
  try {
    if (
      (await owner.run(['image', 'save', '--output', paths.raw, image.tag]))
        .code !== 0
    )
      return refuse('docker-save');
    const rawEntries = await readLaunchArchiveInventory(
      paths.raw,
      owner.checkpoint,
    );
    const raw = rawEntries && readLaunchArchiveGraph(rawEntries, image);
    if (!raw) return refuse('inventory');
    if (!raw.ok) return refuse(raw.reason);
    const projection = launchArchiveProjection(raw, image, id);
    if (!projection.ok) return refuse(projection.reason);
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
      return refuse('closed-format');
    await Bun.write(
      paths.receipt,
      JSON.stringify(launchArchiveReceipt(closed, image)),
    );
    await rename(archive, join(directory, 'image.tar'));
    await rename(paths.receipt, join(directory, 'receipt.json'));
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.archive.saved', store: image.store, omitted: projection.omitted, image: id, inputs: image.key })}\n`,
    );
    return { saved: true };
  } finally {
    await Promise.all(
      Object.values(paths).map((path) => rm(path, { force: true })),
    );
  }
}

/** The cache is an optimization: a valid image is never lost to its refusal. */
export async function cacheLaunchImage(
  owner: Owner,
  image: LaunchImage,
  id: string,
  directory: string,
) {
  const save = await saveLaunchImageArchive(owner, image, id, directory);
  if (!save.saved)
    process.stdout.write(
      `${JSON.stringify({ event: 'browser.image.archive.refused', reason: save.reason, store: image.store, inputs: image.key })}\n`,
    );
  return save;
}
