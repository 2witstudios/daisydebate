import { S3Client } from 'bun';
import { createAppError, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { PrivateObjectStore } from './ports';
/** Explicit deployment inputs only; bucket must be private and unversioned before activation. */
export function createPrivateS3ObjectStore(options: {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly versioning: 'disabled';
}): PrivateObjectStore {
  if (
    [
      options.endpoint,
      options.region,
      options.bucket,
      options.accessKeyId,
      options.secretAccessKey,
    ].some((value) => !value) ||
    options.versioning !== 'disabled'
  )
    throw createAppError('INFRASTRUCTURE');
  const client = new S3Client({ ...options, acl: 'private' });
  const file = (key: string) => {
    if (!idSchema.safeParse(key).success) throw createAppError('VALIDATION');
    return client.file(key);
  };
  return {
    async put(key, bytes) {
      try {
        const object = file(key);
        if (await object.exists()) throw createAppError('CONFLICT');
        await object.write(bytes, {
          type: 'application/octet-stream',
          acl: 'private',
        });
      } catch (error) {
        throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
      }
    },
    async read(key, maxBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw createAppError('VALIDATION');
      try {
        const object = file(key);
        const info = await object.stat();
        if (info.size > maxBytes) throw createAppError('PAYLOAD_TOO_LARGE');
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (bytes.length > maxBytes) throw createAppError('PAYLOAD_TOO_LARGE');
        return bytes;
      } catch (error) {
        throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
      }
    },
    async remove(key) {
      try {
        const object = file(key);
        await object.delete();
        if (await object.exists()) throw createAppError('INFRASTRUCTURE');
      } catch (error) {
        throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
      }
    },
  };
}
