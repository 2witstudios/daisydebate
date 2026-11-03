import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTigrisObjectStore,
  readRecordingBucket,
} from './tigris-object-store';

setupRitewayBun();

const config = {
  endpoint: 'https://fly.storage.tigris.dev',
  bucket: 'private-recordings',
  accessKeyId: 'tid_example',
  secretAccessKey: 'tsec_example',
  region: 'auto',
};

describe('signedRead', () => {
  const store = createTigrisObjectStore(config);
  const url = new URL(
    store.signedRead('recordings/rec/video.mp4', {
      expiresInSeconds: 60,
      attachmentName: 'daisy-recording-rec.mp4',
    }),
  );
  test('signs one short-lived read of one key', () => {
    assert({
      given: 'a download link',
      should: 'name the key, last 60 seconds and be signed',
      actual: [
        url.pathname.endsWith('/recordings/rec/video.mp4'),
        url.searchParams.get('X-Amz-Expires'),
        url.searchParams.has('X-Amz-Signature'),
      ],
      expected: [true, '60', true],
    });
    assert({
      given: 'a download link',
      should: 'never carry the secret',
      actual: url.toString().includes(config.secretAccessKey),
      expected: false,
    });
  });
});

describe('readRecordingBucket', () => {
  test('needs every setting', () => {
    assert({
      given: 'a partial environment',
      should: 'stay inert',
      actual: readRecordingBucket({ RECORDING_BUCKET_NAME: 'x' }),
      expected: null,
    });
    assert({
      given: 'a whole environment',
      should: 'default the region',
      actual: readRecordingBucket({
        RECORDING_BUCKET_ENDPOINT: 'https://e',
        RECORDING_BUCKET_NAME: 'b',
        RECORDING_BUCKET_ACCESS_KEY_ID: 'a',
        RECORDING_BUCKET_SECRET_ACCESS_KEY: 's',
      })?.region,
      expected: 'auto',
    });
  });
});

/** The S3 wire protocol's list, read and delete, enough to exercise the real client. */
const s3Double = (keys: readonly string[]) => {
  const objects = new Set(keys);
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const url = new URL(request.url);
      const key = decodeURIComponent(
        url.pathname.split('/').slice(2).join('/'),
      );
      if (request.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      if (key === '') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const limit = Number(url.searchParams.get('max-keys') ?? 1000);
        const found = [...objects]
          .filter((name) => name.startsWith(prefix))
          .slice(0, limit);
        return new Response(
          `<?xml version="1.0"?><ListBucketResult><Name>b</Name><KeyCount>${found.length}</KeyCount><IsTruncated>false</IsTruncated>${found
            .map(
              (name) => `<Contents><Key>${name}</Key><Size>1</Size></Contents>`,
            )
            .join('')}</ListBucketResult>`,
          { headers: { 'content-type': 'application/xml' } },
        );
      }
      return objects.has(key)
        ? new Response('#EXTM3U')
        : new Response(null, { status: 404 });
    },
  });
  return { server, objects };
};

describe('the object store over the S3 protocol', () => {
  test('lists, reads and really deletes only what it was told to', async () => {
    const { server, objects } = s3Double([
      'recordings/rec/a.ts',
      'recordings/rec/b.m3u8',
      'recordings/other/keep.ts',
    ]);
    try {
      const store = createTigrisObjectStore({
        ...config,
        endpoint: `http://127.0.0.1:${server.port}`,
      });
      const listed = await store.listKeys('recordings/rec/', 500);
      assert({
        given: 'a prefix',
        should: 'list only the keys under it',
        actual: [...listed].sort(),
        expected: ['recordings/rec/a.ts', 'recordings/rec/b.m3u8'],
      });
      assert({
        given: 'a limit',
        should: 'stay within it',
        actual: (await store.listKeys('recordings/rec/', 1)).length,
        expected: 1,
      });
      assert({
        given: 'a playlist',
        should: 'read its text',
        actual: await store.readText('recordings/rec/b.m3u8'),
        expected: '#EXTM3U',
      });
      await store.removeKeys(listed);
      await store.removeKeys(listed);
      assert({
        given: 'a removal, repeated',
        should: 'succeed and leave only the other Recording',
        actual: [...objects],
        expected: ['recordings/other/keep.ts'],
      });
    } finally {
      await server.stop(true);
    }
  });
});
