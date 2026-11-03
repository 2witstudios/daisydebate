import { SEGMENT_CACHE_CONTROL } from './hold-manifest';
import { S3Client } from 'bun';
import { mkdir } from 'node:fs/promises';

const DISCARD_PAGE = 1000;

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
  const putPublic = async (
    key: string,
    body: string | Blob,
    headers: Readonly<Record<string, string>>,
  ) => {
    const response = await fetch(
      pub.presign(key, { method: 'PUT', expiresIn: 60 }),
      { method: 'PUT', body, headers },
    );
    if (!response.ok) throw new Error(`public put ${response.status}`);
  };
  return {
    /** A Round's published state: the public key's only write outside a release. */
    putState: (
      key: string,
      body: string,
      headers: Readonly<Record<string, string>>,
    ) => putPublic(key, body, headers),
    /** Empty until Egress writes its first playlist: nothing is due yet. */
    readHoldText: async (key: string) => {
      const file = hold.file(key);
      return (await file.exists()) ? file.text() : '';
    },
    /** A private clip reads nothing from the hold, so nothing else has made its folder. */
    ensureDir: async (path: string) => {
      await mkdir(path, { recursive: true });
    },
    /** One page of a discard: repeat until the prefix lists empty. */
    discardHoldPage: async (prefix: string) => {
      const page = await hold.list({ prefix, maxKeys: DISCARD_PAGE });
      const keys = (page.contents ?? []).map((entry) => entry.key);
      await Promise.all(keys.map((key) => hold.delete(key)));
      return keys.length;
    },
    holdExists: (key: string) => hold.file(key).exists(),
    copyHoldToFile: async (key: string, path: string) => {
      await Bun.write(path, hold.file(key));
    },
    deletePublic: (key: string) => pub.delete(key),
    /**
     * Presigned PUTs, because Bun's write drops Cache-Control. An uncached header
     * keeps a rewritten manifest fresh (BCAST-1) and lets a delete reach every
     * reader of a segment.
     */
    putSegment: async (key: string, path: string) => {
      await putPublic(key, Bun.file(path), {
        'cache-control': SEGMENT_CACHE_CONTROL,
        'content-type': 'video/mp2t',
      });
    },
    putManifest: async (key: string, body: string) => {
      await putPublic(key, body, {
        'cache-control': 'no-cache',
        'content-type': 'application/vnd.apple.mpegurl',
      });
    },
  };
};
