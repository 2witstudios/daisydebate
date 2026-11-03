import { S3Client } from 'bun';

type BucketConfig = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly key: string;
  readonly secret: string;
  readonly region: string;
};

const clientOf = (config: BucketConfig) =>
  new S3Client({
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.key,
    secretAccessKey: config.secret,
    region: config.region,
  });

const LIST_PAGE = 1000;

/** Every key and size under a prefix, across as many pages as it takes. */
const listAll = async (client: S3Client, prefix: string) => {
  const found = new Map<string, number>();
  let startAfter: string | undefined;
  for (;;) {
    const page = await client.list({
      prefix,
      maxKeys: LIST_PAGE,
      ...(startAfter ? { startAfter } : {}),
    });
    const contents = page.contents ?? [];
    for (const entry of contents) found.set(entry.key, entry.size ?? 0);
    if (!page.isTruncated || contents.length === 0) return found;
    startAfter = contents.at(-1)?.key;
  }
};

const contentType = (key: string) => {
  if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (key.endsWith('.ts')) return 'video/mp2t';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  return 'video/mp4';
};

/** The Egress hold, read then cleared, and the private Recording bucket. */
export const createObjects = (config: {
  readonly hold: BucketConfig;
  readonly recordings: BucketConfig;
}) => {
  const hold = clientOf(config.hold);
  const recordings = clientOf(config.recordings);
  return {
    hold: {
      /** Empty when an attempt wrote no playlist: nothing of it can be placed. */
      readText: async (key: string) => {
        const file = hold.file(key);
        return (await file.exists()) ? file.text() : '';
      },
      /** The names directly under an attempt's prefix. */
      listNames: async (prefix: string) =>
        [...(await listAll(hold, prefix)).keys()].map((key) =>
          key.slice(prefix.length),
        ),
      download: async (key: string, path: string) => {
        await Bun.write(path, hold.file(key));
      },
    },
    recordings: {
      upload: async (key: string, path: string) => {
        await recordings.file(key).write(Bun.file(path), {
          type: contentType(key),
        });
      },
      sizes: (prefix: string) => listAll(recordings, prefix),
    },
    /** One page of a discard: the worker repeats until the prefix lists empty. */
    discardPage: async (prefix: string) => {
      const page = await hold.list({ prefix, maxKeys: LIST_PAGE });
      const keys = (page.contents ?? []).map((entry) => entry.key);
      await Promise.all(keys.map((key) => hold.delete(key)));
      return keys.length;
    },
  };
};
