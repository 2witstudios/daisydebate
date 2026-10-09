import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { PrivateObjectStore } from './ports';
/** Private isolated local storage for real-service proofs; no web/static mount. */
export function createLocalPrivateObjectStore(
  directory: string,
): PrivateObjectStore {
  const path = (key: string) => {
    if (!idSchema.safeParse(key).success) throw createAppError('VALIDATION');
    return join(directory, key);
  };
  return {
    async put(key, bytes) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const objectPath = path(key);
      let handle;
      try {
        handle = await open(objectPath, 'wx', 0o600);
      } catch {
        throw createAppError('INFRASTRUCTURE');
      }
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    },
    async read(key, maxBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw createAppError('VALIDATION');
      const handle = await open(path(key), 'r');
      try {
        if ((await handle.stat()).size > maxBytes)
          throw createAppError('PAYLOAD_TOO_LARGE');
        return new Uint8Array(await readFile(handle));
      } finally {
        await handle.close();
      }
    },
    async remove(key) {
      try {
        await unlink(path(key));
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw createAppError('INFRASTRUCTURE');
      }
    },
  };
}
