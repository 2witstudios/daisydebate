import { S3Client } from 'bun';

/** The hold key reads the private bucket; only the release key writes public (ADR 0099). */
export const createObjects = (config: {
  readonly endpoint: string;
  readonly hold: {
    readonly bucket: string;
    readonly key: string;
    readonly secret: string;
  };
  readonly public: {
    readonly bucket: string;
    readonly key: string;
    readonly secret: string;
  };
}) => {
  const client = (b: typeof config.hold) =>
    new S3Client({
      endpoint: config.endpoint,
      bucket: b.bucket,
      accessKeyId: b.key,
      secretAccessKey: b.secret,
      region: 'auto',
    });
  const hold = client(config.hold);
  const pub = client(config.public);
  return {
    readHoldText: (key: string) => hold.file(key).text(),
    copyHoldToFile: async (key: string, path: string) => {
      await Bun.write(path, hold.file(key));
    },
    putSegment: async (key: string, path: string) => {
      await pub.write(key, Bun.file(path), { type: 'video/mp2t' });
    },
    /**
     * A presigned PUT, because Bun's write drops Cache-Control and an uncached
     * header is the only thing that keeps a rewritten manifest fresh (BCAST-1).
     */
    putManifest: async (key: string, body: string) => {
      const response = await fetch(
        pub.presign(key, { method: 'PUT', expiresIn: 60 }),
        {
          method: 'PUT',
          body,
          headers: {
            'cache-control': 'no-cache',
            'content-type': 'application/vnd.apple.mpegurl',
          },
        },
      );
      if (!response.ok) throw new Error(`manifest put ${response.status}`);
    },
  };
};
