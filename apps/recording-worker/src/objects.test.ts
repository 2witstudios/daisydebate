import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createObjects } from './objects';

setupRitewayBun();

/** The S3 wire protocol's list and delete, enough to exercise the real client. */
const s3Double = (keys: readonly string[], maxPage: number) => {
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
      const prefix = url.searchParams.get('prefix') ?? '';
      const found = [...objects]
        .filter((name) => name.startsWith(prefix))
        .slice(0, maxPage);
      return new Response(
        `<?xml version="1.0"?><ListBucketResult><Name>hold</Name><KeyCount>${found.length}</KeyCount><IsTruncated>false</IsTruncated>${found
          .map(
            (name) => `<Contents><Key>${name}</Key><Size>1</Size></Contents>`,
          )
          .join('')}</ListBucketResult>`,
        { headers: { 'content-type': 'application/xml' } },
      );
    },
  });
  return { server, objects };
};

const bucket = (port: number | undefined) => ({
  endpoint: `http://127.0.0.1:${port}`,
  bucket: 'hold',
  key: 'k',
  secret: 's',
  region: 'auto',
});

describe('discardPage', () => {
  test('deletes one page under the prefix, and says when none is left', async () => {
    const { server, objects } = s3Double(
      [
        'recording-hold/rec/1/p.m3u8',
        'recording-hold/rec/1/s0.ts',
        'recording-hold/rec/2/s0.ts',
        'recording-hold/other/1/keep.ts',
      ],
      2,
    );
    try {
      const { discardPage } = createObjects({
        hold: bucket(server.port),
        recordings: bucket(server.port),
      });
      const prefix = 'recording-hold/rec/';
      const pages = [
        await discardPage(prefix),
        await discardPage(prefix),
        await discardPage(prefix),
      ];
      assert({
        given: 'three objects under the prefix, listed two to a page',
        should: 'report each page, then zero, the worker’s signal to settle',
        actual: pages,
        expected: [2, 1, 0],
      });
      assert({
        given: 'another Recording in the same bucket',
        should: 'leave its objects alone',
        actual: [...objects],
        expected: ['recording-hold/other/1/keep.ts'],
      });
    } finally {
      await server.stop(true);
    }
  });
});
