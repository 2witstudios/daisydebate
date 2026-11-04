import { S3Client } from 'bun';

/** A stalled store must not hold every later publish: passes run each second. */
const PUBLIC_OBJECT_TIMEOUT_MS = 5_000;

/** The public bucket alone: this app holds no key to the hold (ADR 0099, ADR 0112). */
export const createPublicObjects = (config: {
  readonly endpoint: string;
  readonly bucket: string;
  readonly key: string;
  readonly secret: string;
  readonly timeoutMs?: number;
}) => {
  const timeoutMs = config.timeoutMs ?? PUBLIC_OBJECT_TIMEOUT_MS;
  const bucket = new S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.key,
    secretAccessKey: config.secret,
    region: 'auto',
  });
  return {
    putState: async (
      key: string,
      body: string,
      headers: Readonly<Record<string, string>>,
    ) => {
      const response = await fetch(
        bucket.presign(key, { method: 'PUT', expiresIn: 60 }),
        {
          method: 'PUT',
          body,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok) throw new Error(`public put ${response.status}`);
    },
    readState: async (key: string) => {
      const response = await fetch(
        bucket.presign(key, { method: 'GET', expiresIn: 60 }),
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`public get ${response.status}`);
      return response.text();
    },
    deletePublic: async (key: string) => {
      const response = await fetch(
        bucket.presign(key, { method: 'DELETE', expiresIn: 60 }),
        { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) throw new Error(`public delete ${response.status}`);
    },
  };
};
