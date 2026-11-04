import { S3Client } from 'bun';

/** The public bucket alone: this app holds no key to the hold (ADR 0099, ADR 0112). */
export const createPublicObjects = (config: {
  readonly endpoint: string;
  readonly bucket: string;
  readonly key: string;
  readonly secret: string;
}) => {
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
        { method: 'PUT', body, headers },
      );
      if (!response.ok) throw new Error(`public put ${response.status}`);
    },
    deletePublic: (key: string) => bucket.delete(key),
  };
};
