import { S3Client } from 'bun';
import type { RecordingObjectStore } from './ports';

export type RecordingBucketConfig = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
};

/**
 * The private Tigris bucket, over S3. The bucket has no public access: the only
 * way to its objects is a signed read this feature issued after authorizing.
 */
export const createTigrisObjectStore = (
  config: RecordingBucketConfig,
): RecordingObjectStore => {
  const client = new S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  });
  return {
    signedRead: (key, { expiresInSeconds, attachmentName }) =>
      client.presign(key, {
        method: 'GET',
        expiresIn: expiresInSeconds,
        ...(attachmentName
          ? {
              contentDisposition: `attachment; filename="${attachmentName}"`,
            }
          : {}),
      }),
    readText: (key) => client.file(key).text(),
    listKeys: async (prefix, limit) => {
      const listed = await client.list({ prefix, maxKeys: limit });
      return (listed.contents ?? []).map((entry) => entry.key);
    },
    removeKeys: async (keys) => {
      await Promise.all(keys.map((key) => client.delete(key)));
    },
  };
};

/** A deployment without the bucket has no object to read or delete. */
const absentObjectStore: RecordingObjectStore = {
  signedRead: () => {
    throw new Error('Recording storage is not configured');
  },
  readText: async () => {
    throw new Error('Recording storage is not configured');
  },
  listKeys: async () => {
    throw new Error('Recording storage is not configured');
  },
  removeKeys: async () => {
    throw new Error('Recording storage is not configured');
  },
};

/** The bucket's settings from the environment, or null when any is missing. */
export const readRecordingBucket = (
  env: Readonly<Record<string, string | undefined>>,
): RecordingBucketConfig | null => {
  const endpoint = env['RECORDING_BUCKET_ENDPOINT'];
  const bucket = env['RECORDING_BUCKET_NAME'];
  const accessKeyId = env['RECORDING_BUCKET_ACCESS_KEY_ID'];
  const secretAccessKey = env['RECORDING_BUCKET_SECRET_ACCESS_KEY'];
  return endpoint && bucket && accessKeyId && secretAccessKey
    ? {
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        region: env['RECORDING_BUCKET_REGION'] ?? 'auto',
      }
    : null;
};

export const recordingObjectStore = (
  env: Readonly<Record<string, string | undefined>>,
): RecordingObjectStore => {
  const bucket = readRecordingBucket(env);
  return bucket ? createTigrisObjectStore(bucket) : absentObjectStore;
};
