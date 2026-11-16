import { S3Client } from 'bun';
import { createAppError } from '@daisy/errors';
import type { ProfilePhotoObjects } from './ports';

export type ProfilePhotoBucketConfig = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
};

/** Objects one prefix may hold: a photo has two renditions. */
const PREFIX_LIST_LIMIT = 16;

/**
 * The private profile photo bucket over S3 (Tigris on Fly). No public access
 * and no signed URLs: the image route streams a published photo through the
 * application, so removing a photo takes effect at the next read.
 */
export const createProfilePhotoBucket = (
  config: ProfilePhotoBucketConfig,
): ProfilePhotoObjects => {
  const client = new S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  });
  return {
    put: async (key, bytes) => {
      await client.write(key, bytes, { type: 'image/webp' });
    },
    read: async (key, maxBytes) => {
      const file = client.file(key);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw createAppError('INFRASTRUCTURE');
      return bytes;
    },
    removePrefix: async (prefix) => {
      const listed = await client.list({
        prefix: `${prefix}/`,
        maxKeys: PREFIX_LIST_LIMIT,
      });
      await Promise.all(
        (listed.contents ?? []).map((entry) => client.delete(entry.key)),
      );
    },
  };
};

/** The bucket's settings from the environment, or null when any is missing. */
export const readProfilePhotoBucket = (
  env: Readonly<Record<string, string | undefined>>,
): ProfilePhotoBucketConfig | null => {
  const endpoint = env['PROFILE_PHOTO_BUCKET_ENDPOINT'];
  const bucket = env['PROFILE_PHOTO_BUCKET_NAME'];
  const accessKeyId = env['PROFILE_PHOTO_BUCKET_ACCESS_KEY_ID'];
  const secretAccessKey = env['PROFILE_PHOTO_BUCKET_SECRET_ACCESS_KEY'];
  return endpoint && bucket && accessKeyId && secretAccessKey
    ? {
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        region: env['PROFILE_PHOTO_BUCKET_REGION'] ?? 'auto',
      }
    : null;
};

/** The deployment's photo store, or null: then uploads refuse as unavailable. */
export const profilePhotoObjects = (
  env: Readonly<Record<string, string | undefined>>,
): ProfilePhotoObjects | null => {
  const config = readProfilePhotoBucket(env);
  return config ? createProfilePhotoBucket(config) : null;
};
