import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import {
  launchArchiveMaxDocumentBytes,
  launchArchiveMaxEntries,
  readLaunchTarHeader,
  type LaunchArchiveEntry,
  type LaunchArchiveLayer,
} from './launch-browser-image-archive-policy';

const BLOCK = 512;
const CHUNK = 1048576;
/** Bounds a decompression bomb far above the real 3.5GB image. */
const MAX_INFLATED_LAYER_BYTES = 34359738368;
const paddedSize = (size: number) => Math.ceil(size / BLOCK) * BLOCK;

/** Injected by the preparation owner: throws once its deadline or interrupt passes. */
type Checkpoint = () => void;

async function* rangeChunks(
  file: FileHandle,
  start: number,
  length: number,
  checkpoint: Checkpoint,
) {
  let done = 0;
  while (done < length) {
    checkpoint();
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK, length - done));
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.length,
      start + done,
    );
    if (bytesRead === 0) throw new Error('Launch archive ended unexpectedly');
    yield buffer.subarray(0, bytesRead);
    done += bytesRead;
  }
}

/**
 * Headers and bounded documents only, seeking over large payloads. Null for
 * anything that is not one well-formed ustar stream with a zero-only tail.
 */
export async function readLaunchArchiveInventory(
  path: string,
  checkpoint: Checkpoint,
): Promise<readonly LaunchArchiveEntry[] | null> {
  const file = await open(path, 'r');
  try {
    const { size: total } = await file.stat();
    const entries: LaunchArchiveEntry[] = [];
    const block = Buffer.alloc(BLOCK);
    let offset = 0;
    while (offset + BLOCK <= total) {
      checkpoint();
      await file.read(block, 0, BLOCK, offset);
      if (block.every((byte) => byte === 0))
        return (await zeroTail(file, offset, total)) ? entries : null;
      const header = readLaunchTarHeader(block);
      if (!header || entries.length === launchArchiveMaxEntries) return null;
      const end = offset + BLOCK + paddedSize(header.size);
      if (end > total) return null;
      let bytes: Uint8Array | undefined;
      if (
        header.kind === 'file' &&
        header.size <= launchArchiveMaxDocumentBytes
      ) {
        bytes = Buffer.alloc(header.size);
        await file.read(bytes, 0, header.size, offset + BLOCK);
      }
      entries.push({ ...header, offset, ...(bytes ? { bytes } : {}) });
      offset = end;
    }
    return null;
  } finally {
    await file.close();
  }
}
async function zeroTail(file: FileHandle, offset: number, total: number) {
  if (total - offset > CHUNK) return false;
  const tail = Buffer.alloc(total - offset);
  await file.read(tail, 0, tail.length, offset);
  return tail.every((byte) => byte === 0);
}

/** Stream each layer once: exact size, content digest and uncompressed DiffID. */
export async function launchArchiveLayersMatch(
  path: string,
  layers: readonly LaunchArchiveLayer[],
  checkpoint: Checkpoint,
): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    for (const layer of layers)
      if (!(await layerMatches(file, layer, checkpoint))) return false;
    return true;
  } finally {
    await file.close();
  }
}
async function layerMatches(
  file: FileHandle,
  layer: LaunchArchiveLayer,
  checkpoint: Checkpoint,
) {
  const content = createHash('sha256');
  const uncompressed = createHash('sha256');
  const chunks = rangeChunks(
    file,
    layer.entry.offset + BLOCK,
    layer.entry.size,
    checkpoint,
  );
  if (!layer.gzip) {
    for await (const chunk of chunks) {
      content.update(chunk);
      uncompressed.update(chunk);
    }
  } else {
    let inflated = 0;
    const counted = async function* () {
      for await (const chunk of chunks) {
        content.update(chunk);
        yield chunk;
      }
    };
    try {
      await pipeline(counted, createGunzip(), async (source) => {
        for await (const chunk of source as AsyncIterable<Buffer>) {
          inflated += chunk.length;
          if (inflated > MAX_INFLATED_LAYER_BYTES)
            throw new Error('Launch archive layer exceeds its bound');
          uncompressed.update(chunk);
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('Z_')) return false;
      if (inflated > MAX_INFLATED_LAYER_BYTES) return false;
      throw error;
    }
  }
  return (
    `sha256:${content.digest('hex')}` === layer.digest &&
    `sha256:${uncompressed.digest('hex')}` === layer.diffId
  );
}

/** Copy whole retained entries verbatim (header and bytes); no layer is transcoded. */
export async function writeClosedLaunchArchive(
  source: string,
  target: string,
  retained: readonly LaunchArchiveEntry[],
  checkpoint: Checkpoint,
) {
  const input = await open(source, 'r');
  const output = await open(target, 'wx', 0o600);
  try {
    for (const entry of retained)
      for await (const chunk of rangeChunks(
        input,
        entry.offset,
        BLOCK + paddedSize(entry.size),
        checkpoint,
      ))
        await output.write(chunk);
    await output.write(Buffer.alloc(BLOCK * 2));
  } finally {
    await Promise.all([input.close(), output.close()]);
  }
}
