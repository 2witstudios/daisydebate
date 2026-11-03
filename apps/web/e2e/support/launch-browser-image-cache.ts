import { createId } from '@paralleldrive/cuid2';
import { createHash } from 'node:crypto';
import { open, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validatedLaunchImage } from './launch-browser-image-build';
import {
  launchArchiveFormat,
  type LaunchImage,
} from './launch-browser-image-policy';
import type { createLaunchPreparationProcess } from './launch-browser-image-process';
import {
  dockerFailureSummary,
  sha256Digest,
} from './launch-browser-image-values';

type Owner = ReturnType<typeof createLaunchPreparationProcess>;

/**
 * The archive is the `docker save` output, unchanged. The cache sits inside the
 * repository trust boundary and is never authority: the receipt detects
 * corruption, and every restored image goes through full image validation.
 */
const CHUNK = 1048576;
const MAX_RECEIPT_BYTES = 1024;

async function fileDigest(path: string, owner: Owner) {
  const file = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      owner.checkpoint();
      const { bytesRead } = await file.read(buffer, 0, CHUNK);
      if (bytesRead === 0) return sha256Digest(hash);
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
}

const receiptOf = (image: LaunchImage, id: string, archive: string) => ({
  format: launchArchiveFormat,
  key: image.key,
  store: image.store,
  id,
  archive,
});

async function readReceipt(path: string) {
  if ((await stat(path)).size > MAX_RECEIPT_BYTES) return null;
  return JSON.parse(await Bun.file(path).text()) as unknown;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A missing entry is ordinary; everything else names why it was not used. */
export async function restoreLaunchImageArchive(
  owner: Owner,
  image: LaunchImage,
  directory: string,
): Promise<
  | { readonly status: 'restored'; readonly id: string }
  | { readonly status: 'missing' }
  | { readonly status: 'rejected'; readonly reason: string }
> {
  const rejected = (reason: string) => ({
    status: 'rejected' as const,
    reason,
  });
  const archive = join(directory, 'image.tar');
  const receiptPath = join(directory, 'receipt.json');
  const [hasArchive, hasReceipt] = await Promise.all([
    exists(archive),
    exists(receiptPath),
  ]);
  if (!hasArchive && !hasReceipt) return { status: 'missing' };
  if (!hasArchive || !hasReceipt) return rejected('incomplete');
  const receipt = await readReceipt(receiptPath).catch(() => null);
  const id = (receipt as { id?: unknown } | null)?.id;
  const digest = (receipt as { archive?: unknown } | null)?.archive;
  if (
    typeof id !== 'string' ||
    typeof digest !== 'string' ||
    JSON.stringify(receipt) !== JSON.stringify(receiptOf(image, id, digest))
  )
    return rejected('receipt');
  if ((await fileDigest(archive, owner)) !== digest) return rejected('digest');
  if ((await owner.run(['image', 'load', '--input', archive])).code !== 0)
    return rejected('load');
  const restored = await validatedLaunchImage(owner, image, image.tag, id);
  return restored ? { status: 'restored', id: restored } : rejected('identity');
}

/** Publish the archive and its receipt together, or nothing at all. */
export async function saveLaunchImageArchive(
  owner: Owner,
  image: LaunchImage,
  id: string,
  directory: string,
): Promise<
  | { readonly saved: true }
  | {
      readonly saved: false;
      readonly reason: string;
      readonly detail?: string;
    }
> {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `image-${createId()}`);
  const paths = { archive: `${temporary}.tar`, receipt: `${temporary}.json` };
  try {
    const save = await owner.run([
      'image',
      'save',
      '--output',
      paths.archive,
      image.tag,
    ]);
    if (save.code !== 0)
      return {
        saved: false,
        reason: 'docker-save',
        detail: dockerFailureSummary(save.code, save.stderr),
      };
    if (
      !(await exists(paths.archive)) ||
      (await stat(paths.archive)).size === 0
    )
      return { saved: false, reason: 'empty-archive' };
    await Bun.write(
      paths.receipt,
      JSON.stringify(
        receiptOf(image, id, await fileDigest(paths.archive, owner)),
      ),
    );
    await rename(paths.archive, join(directory, 'image.tar'));
    await rename(paths.receipt, join(directory, 'receipt.json'));
    return { saved: true };
  } finally {
    await Promise.all(
      Object.values(paths).map((path) => rm(path, { force: true })),
    );
  }
}

/** Visible on the run page; a plain cache miss stays quiet. */
function warnLaunchCache(event: string, image: LaunchImage, reason: string) {
  process.stdout.write(
    `::warning title=Launch browser image cache::${event}: ${reason}\n${JSON.stringify({ event: `browser.image.${event}`, reason, store: image.store, inputs: image.key })}\n`,
  );
}

/** A rejected entry cannot block a run: the caller rebuilds from pinned digests. */
export async function restoreLaunchImageCache(
  owner: Owner,
  image: LaunchImage,
  directory: string,
  onRejected: (reason: string) => void = (reason) =>
    warnLaunchCache('cache-rejected', image, reason),
) {
  const restore = await restoreLaunchImageArchive(owner, image, directory);
  if (restore.status === 'rejected') onRejected(restore.reason);
  return restore.status === 'restored' ? restore.id : null;
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
    warnLaunchCache(
      'cache-refused',
      image,
      save.detail ? `${save.reason} (${save.detail})` : save.reason,
    );
  return save;
}
